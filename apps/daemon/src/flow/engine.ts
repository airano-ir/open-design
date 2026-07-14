/**
 * Staged-flow engine (specs/current/staged-flow-north-star.zh-CN.md §5.2).
 *
 * One tracker per run advances the conversation's `FlowSnapshot` through two
 * channels:
 *
 *   1. Marker channel (primary) — the agent narrates transitions with inline
 *      `<od-flow stage="…" state="…"/>` markers in its streamed text.
 *   2. Heuristic channel (fallback) — deterministic signals the daemon can
 *      observe regardless of whether the model emitted markers: a streamed
 *      `<question-form` (clarify), a research CLI invocation (research), a
 *      plan-artifact write (plan), a shape-compatible artifact write (generate), the
 *      `[form answers …]` echo in the next user message (clarify complete),
 *      and a clean run end while generating (generate complete → deliver).
 *
 * Both channels funnel through `applyFlowMarker`, whose invariant is monotonic
 * forward progress, so a late or duplicated signal can never move the ladder
 * backwards.
 */

import {
  applyFlowMarker,
  createFlowSnapshot,
  FLOW_SHAPES,
  flowShapeFromRequestText,
  parseOdFlowMarkers,
  type FlowResearchMode,
  type FlowShapeId,
  type FlowSnapshot,
  type OdFlowMarker,
} from '@open-design/contracts';

/** Longest prefix of a marker/tag we may need to hold across chunk splits. */
const TAG_CARRY = 96;
const QUESTION_FORM_TAG = '<question-form';
const PLAN_CONFIRM_FORM_RE =
  /<question-form\b[^>]*\bid\s*=\s*(?:"plan-confirm"|'plan-confirm')/iu;
const PLAN_CONFIRM_ANSWER = '[form answers — plan-confirm]';
const PLAN_CONFIRM_ANSWER_ASCII = '[form answers - plan-confirm]';

function commandFlagValue(command: string, flag: string): string | null {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `(?:^|\\s)${escapedFlag}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|([^\\s]+))`,
    'u',
  ).exec(command);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function commandResearchPath(command: string): string | null {
  return /(?:^|[\s>])((?:research\/)[^\s'";]+\.md)\b/iu.exec(command)?.[1] ?? null;
}

export interface ResolveFlowShapeInput {
  sessionMode?: string | null;
  taskKind?: string | null;
  projectKind?: string | null;
  projectPlatform?: string | null;
  requestText?: string | null;
}

/**
 * Gate + shape resolution for a run. Only design-mode, new-generation work
 * enters the staged flow; everything else (chat, plan, tune-collab, brand,
 * migrations) keeps its current UX and returns null.
 */
export function resolveFlowShape(input: ResolveFlowShapeInput): FlowShapeId | null {
  if ((input.sessionMode ?? 'design') !== 'design') return null;
  if ((input.taskKind ?? 'new-generation') !== 'new-generation') return null;
  const platform = input.projectPlatform ?? '';
  const requestedShape = flowShapeFromRequestText(input.requestText);
  switch (input.projectKind) {
    case 'deck':
      return 'deck';
    case 'prototype':
      if (
        requestedShape &&
        ['prototype', 'landing', 'mobile', 'webapp'].includes(requestedShape)
      ) {
        return requestedShape;
      }
      return platform.startsWith('mobile') ? 'mobile' : 'prototype';
    case 'image':
    case 'video':
    case 'audio':
      return 'media';
    case 'template':
      return requestedShape === 'report' ? 'report' : 'document';
    case 'other':
      return requestedShape;
    default:
      return null;
  }
}

/**
 * A provisional generic shape may become specific when clarify answers arrive.
 * Once any later stage starts, the persisted shape is immutable.
 */
export function selectFlowShape(
  initial: FlowSnapshot | null | undefined,
  inferred: FlowShapeId | null,
): FlowShapeId | null {
  if (!initial) return inferred;
  if (!inferred || inferred === initial.shape) return initial.shape;
  const isRefinement =
    (initial.shape === 'prototype' &&
      (inferred === 'landing' || inferred === 'mobile' || inferred === 'webapp')) ||
    (initial.shape === 'document' && inferred === 'report');
  if (!isRefinement) return initial.shape;
  const clarify = initial.stages.find((stage) => stage.id === 'clarify');
  const laterStageStarted = initial.stages.some(
    (stage) => stage.id !== 'clarify' && stage.state !== 'pending',
  );
  return clarify?.state === 'active' && !laterStageStarted
    ? inferred
    : initial.shape;
}

export interface FlowTracker {
  readonly snapshot: FlowSnapshot;
  /** Feed one streamed agent payload. Returns the snapshot when it advanced. */
  observeAgentEvent(ev: unknown): FlowSnapshot | null;
  /** Feed the user message that started this run (form-answer echoes). */
  noteUserMessage(text: string): FlowSnapshot | null;
  /** Feed the run's terminal status. */
  noteRunEnd(status: string | null | undefined): FlowSnapshot | null;
  /** True when a plan exists but the agent ended without the required form. */
  needsPlanConfirmationFallback(): boolean;
}

export interface CreateFlowTrackerOptions {
  shape: FlowShapeId;
  initial?: FlowSnapshot | null;
  researchMode?: FlowResearchMode;
  now?: () => number;
}

export function createFlowTracker(options: CreateFlowTrackerOptions): FlowTracker {
  const now = options.now ?? Date.now;
  let snapshot: FlowSnapshot;
  if (options.initial && options.initial.version === 1) {
    snapshot =
      options.researchMode && options.initial.researchMode !== options.researchMode
        ? { ...options.initial, researchMode: options.researchMode, updatedAt: now() }
        : options.initial;
  } else {
    // A brand-new flow conversation starts at clarify — the ladder should be
    // visible (step 1 active) from the very first streamed byte.
    snapshot = applyFlowMarker(
      createFlowSnapshot(options.shape, {
        now: now(),
        ...(options.researchMode ? { researchMode: options.researchMode } : {}),
      }),
      { stage: 'clarify', state: 'active' },
      now(),
    );
  }

  /** Unconsumed streamed-text tail, held only while a tag may be incomplete. */
  let markerTail = '';
  /** Rolling window for `<question-form` detection across chunk boundaries. */
  let questionFormWindow = '';
  let questionFormSeen = false;
  let planConfirmFormWindow = '';
  let planConfirmFormSeen = false;
  let planConfirmed =
    snapshot.stages.find((stage) => stage.id === 'plan')?.state === 'complete';
  let inspirationFinalized =
    snapshot.inspireChoice !== undefined ||
    ['complete', 'skipped'].includes(
      snapshot.stages.find((stage) => stage.id === 'inspire')?.state ?? '',
    );

  const planArtifactPaths = FLOW_SHAPES[snapshot.shape].planArtifacts;
  const planArtifactNames = planArtifactPaths.map((p) => {
    const parts = p.split('/');
    return parts[parts.length - 1] ?? p;
  });
  const generateExtensions = FLOW_SHAPES[snapshot.shape].generateExtensions;

  function isGenerateArtifact(value: string): boolean {
    const lower = value.toLowerCase().split(/[?#]/u, 1)[0] ?? '';
    return generateExtensions.some((extension) => lower.endsWith(extension));
  }

  function apply(marker: OdFlowMarker): boolean {
    if (marker.stage === 'plan' && marker.state === 'complete' && !planConfirmed) {
      return false;
    }
    if (
      marker.stage === 'inspire' &&
      (marker.state === 'complete' || marker.state === 'skipped') &&
      !inspirationFinalized
    ) {
      return false;
    }
    if (marker.stage === 'generate') {
      const planState = snapshot.stages.find((stage) => stage.id === 'plan')?.state;
      const inspireState = snapshot.stages.find((stage) => stage.id === 'inspire')?.state;
      if (
        planState !== 'complete' ||
        (inspireState !== 'complete' && inspireState !== 'skipped')
      ) {
        return false;
      }
    }
    if (
      marker.stage === 'deliver' &&
      snapshot.stages.find((stage) => stage.id === 'generate')?.state !== 'complete'
    ) {
      return false;
    }
    const next = applyFlowMarker(snapshot, marker, now());
    if (next === snapshot) return false;
    snapshot = next;
    return true;
  }

  function consumeTextDelta(delta: string): boolean {
    let advanced = false;

    // Marker channel: consume complete `<od-flow …>` tags, carry a partial tail.
    markerTail += delta;
    for (;;) {
      const start = markerTail.indexOf('<od-flow');
      if (start === -1) {
        markerTail = markerTail.slice(-TAG_CARRY);
        break;
      }
      const end = markerTail.indexOf('>', start);
      if (end === -1) {
        markerTail = markerTail.slice(start);
        break;
      }
      for (const marker of parseOdFlowMarkers(markerTail.slice(start, end + 1))) {
        if (apply(marker)) advanced = true;
      }
      markerTail = markerTail.slice(end + 1);
    }

    // Heuristic: a streamed question form means we are clarifying.
    if (!questionFormSeen) {
      questionFormWindow = (questionFormWindow + delta).slice(
        -(QUESTION_FORM_TAG.length + delta.length),
      );
      if (questionFormWindow.includes(QUESTION_FORM_TAG)) {
        questionFormSeen = true;
        if (apply({ stage: 'clarify', state: 'active' })) advanced = true;
      }
      questionFormWindow = questionFormWindow.slice(-QUESTION_FORM_TAG.length);
    }
    if (!planConfirmFormSeen) {
      planConfirmFormWindow = (planConfirmFormWindow + delta).slice(-512);
      if (PLAN_CONFIRM_FORM_RE.test(planConfirmFormWindow)) {
        planConfirmFormSeen = true;
      }
    }
    return advanced;
  }

  function toolWritePath(input: unknown): string | null {
    if (!input || typeof input !== 'object') return null;
    const record = input as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'filename', 'file']) {
      const value = record[key];
      if (typeof value === 'string' && value) return value;
    }
    return null;
  }

  function consumeToolUse(name: string, input: unknown): boolean {
    let advanced = false;
    const command =
      input && typeof input === 'object' && typeof (input as Record<string, unknown>).command === 'string'
        ? String((input as Record<string, unknown>).command)
        : '';
    if (command.includes('research search')) {
      const query = commandFlagValue(command, '--query');
      if (
        apply({
          stage: 'research',
          state: 'active',
          detail: query ? `Searching · ${query}` : 'Searching sources',
        })
      ) {
        advanced = true;
      }
      return advanced;
    }
    const lowerCommand = command.toLowerCase();
    if (lowerCommand.includes('research/') && lowerCommand.includes('.md')) {
      const researchPath = commandResearchPath(command);
      if (
        apply({
          stage: 'research',
          state: 'complete',
          ...(researchPath ? { detail: `Research saved · ${researchPath}` } : {}),
        })
      ) {
        advanced = true;
      }
    }
    const commandPlanPath = planArtifactPaths.find((artifact) =>
      lowerCommand.includes(artifact.toLowerCase()),
    );
    if (commandPlanPath) {
      if (
        apply({
          stage: 'plan',
          state: 'active',
          detail: `Writing · ${commandPlanPath}`,
        })
      ) {
        advanced = true;
      }
    }
    if (
      generateExtensions.some((extension) =>
        lowerCommand.includes(extension.toLowerCase()),
      )
    ) {
      if (apply({ stage: 'generate', state: 'active' })) advanced = true;
    }
    const path = toolWritePath(input);
    if (!path) return advanced;
    const lower = path.toLowerCase();
    if (lower.includes('research/') && lower.endsWith('.md')) {
      if (
        apply({
          stage: 'research',
          state: 'complete',
          detail: `Research saved · ${path}`,
        })
      ) {
        advanced = true;
      }
      return advanced;
    }
    if (planArtifactNames.some((artifact) => lower.endsWith(artifact.toLowerCase()))) {
      if (
        apply({
          stage: 'plan',
          state: 'active',
          detail: `Writing · ${path}`,
        })
      ) {
        advanced = true;
      }
      return advanced;
    }
    if (isGenerateArtifact(lower)) {
      if (apply({ stage: 'generate', state: 'active' })) advanced = true;
    }
    return advanced;
  }

  return {
    get snapshot() {
      return snapshot;
    },

    observeAgentEvent(ev: unknown): FlowSnapshot | null {
      if (!ev || typeof ev !== 'object') return null;
      const payload = ev as Record<string, unknown>;
      const type = payload.type;
      let advanced = false;
      if (type === 'text_delta' && typeof payload.delta === 'string') {
        advanced = consumeTextDelta(payload.delta);
      } else if (type === 'tool_use') {
        advanced = consumeToolUse(
          typeof payload.name === 'string' ? payload.name : '',
          payload.input,
        );
      } else if (type === 'live_artifact' || type === 'artifact') {
        const label =
          typeof payload.title === 'string'
            ? payload.title
            : typeof payload.name === 'string'
              ? payload.name
              : '';
        if (isGenerateArtifact(label)) {
          advanced = apply({ stage: 'generate', state: 'active' });
        }
      }
      return advanced ? snapshot : null;
    },

    noteUserMessage(text: string): FlowSnapshot | null {
      if (typeof text !== 'string' || !text) return null;
      let advanced = false;
      const normalized = text.toLowerCase();
      const isPlanConfirmation =
        normalized.includes(PLAN_CONFIRM_ANSWER) ||
        normalized.includes(PLAN_CONFIRM_ANSWER_ASCII);
      if (text.includes('[form answers') && !isPlanConfirmation) {
        if (apply({ stage: 'clarify', state: 'complete' })) advanced = true;
      }
      if (isPlanConfirmation) {
        const requestsModification =
          /\b(?:modify|change|edit|revise|adjust)\b/u.test(normalized) ||
          /修改|调整|調整|改一下|先改|我要改/u.test(text);
        if (requestsModification) {
          if (
            apply({
              stage: 'plan',
              state: 'active',
              detail: 'Waiting for outline changes',
            })
          ) {
            advanced = true;
          }
        } else {
          planConfirmed = true;
          if (
            apply({
              stage: 'plan',
              state: 'complete',
              detail: 'Outline confirmed',
            })
          ) {
            advanced = true;
          }
          // Plan confirmation is a host checkpoint. Open the host-owned
          // inspiration picker immediately instead of waiting for a model turn
          // to remember a second protocol marker.
          if (apply({ stage: 'inspire', state: 'active' })) advanced = true;
        }
      }
      if (text.includes('[inspiration —') || text.includes('[inspiration -')) {
        inspirationFinalized = true;
        if (apply({ stage: 'inspire', state: 'complete' })) advanced = true;
      }
      return advanced ? snapshot : null;
    },

    noteRunEnd(status: string | null | undefined): FlowSnapshot | null {
      if (status !== 'succeeded') return null;
      const generate = snapshot.stages.find((s) => s.id === 'generate');
      if (!generate || generate.state !== 'active') return null;
      let advanced = apply({ stage: 'generate', state: 'complete' });
      if (apply({ stage: 'deliver', state: 'active' })) advanced = true;
      return advanced ? snapshot : null;
    },

    needsPlanConfirmationFallback(): boolean {
      return (
        !planConfirmed &&
        !planConfirmFormSeen &&
        snapshot.stages.find((stage) => stage.id === 'plan')?.state === 'active'
      );
    },
  };
}
