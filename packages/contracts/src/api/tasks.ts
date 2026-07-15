/**
 * Per-round task steps for the replayable Computer.
 *
 * A task is one assistant run. Its steps are a deterministic projection of the
 * already-persisted `messages.events_json`; no task/step table is required.
 * This module deliberately stays pure TypeScript so the daemon route, CLI and
 * web UI all consume the exact same timeline.
 */

import type { ChatRunStatus, PersistedAgentEvent } from './chat.js';

export type TaskStepKind =
  | 'plan'
  | 'outline'
  | 'search'
  | 'search-drilldown'
  | 'read'
  | 'write'
  | 'edit'
  | 'list'
  | 'command'
  | 'inspiration'
  | 'generate'
  | 'thinking'
  | 'tool';

export type TaskStepStatus = 'running' | 'done' | 'error';

export type TaskToolUseEvent = Extract<PersistedAgentEvent, { kind: 'tool_use' }>;
export type TaskToolResultEvent = Extract<PersistedAgentEvent, { kind: 'tool_result' }>;

export interface TaskStepArtifact {
  action: 'created' | 'updated';
  projectId: string;
  artifactId: string;
  title: string;
}

export interface TaskStep {
  /** Tool-use id, or a stable synthetic id for thinking/artifact events. */
  id: string;
  kind: TaskStepKind;
  status: TaskStepStatus;
  /** Compact, durable fallback copy. The web may localize this at render time. */
  brief: string;
  /** Short label used by the Computer header and mini progress list. */
  title: string;
  /** Monotonic timestamp. Legacy events deterministically use runStart + index. */
  ts: number;
  toolUse?: TaskToolUseEvent;
  toolResult?: TaskToolResultEvent;
  artifact?: TaskStepArtifact;
  /** Convenience fields for plain-text CLI/UI rendering. */
  tool?: string;
  target?: string;
  isError?: boolean;
}

/** The four user-value lanes allowed into the visual Computer replay. */
export type TaskStepComputerContentKind =
  | 'plan'
  | 'search-list'
  | 'search-detail'
  | 'artifact';

export interface TaskStepSource {
  events?: readonly PersistedAgentEvent[];
  startedAt?: number;
  createdAt?: number;
  endedAt?: number;
}

/** One round (assistant run) with its complete replay timeline. */
export interface TaskRoundSummary {
  index: number;
  assistantMessageId: string;
  runId: string | null;
  status: ChatRunStatus | null;
  startedAt: number | null;
  endedAt: number | null;
  steps: TaskStep[];
}

/** GET /api/conversations/:id/tasks response. */
export interface TaskRoundsResponse {
  conversationId: string;
  rounds: TaskRoundSummary[];
}

const PLAN_TOOL_NAMES = new Set([
  'TodoWrite', 'todowrite', 'todo_write', 'update_plan',
  'TaskCreate', 'TaskUpdate', 'task_create', 'task_update',
]);
const SEARCH_TOOL_NAMES = new Set(['WebSearch', 'web_search']);
const FETCH_TOOL_NAMES = new Set(['WebFetch', 'web_fetch']);
const READ_TOOL_NAMES = new Set(['Read', 'read_file']);
const WRITE_TOOL_NAMES = new Set(['Write', 'write', 'create_file']);
const EDIT_TOOL_NAMES = new Set(['Edit', 'str_replace_edit', 'MultiEdit', 'multi_edit']);
const LIST_TOOL_NAMES = new Set(['Glob', 'list_files', 'Grep']);
const COMMAND_TOOL_NAMES = new Set(['Bash', 'bash', 'exec_command']);
const MEDIA_GENERATE_TOOL_NAMES = new Set([
  'generate_image',
  'generate_video',
  'generate_speech',
]);
const COMPUTER_DELIVERABLE_PATH_PATTERN = /(?:^|\/)generated\/|(?:^|\/)[^/]+\.(?:mdx?|txt|rtf|csv|html?|pdf|docx?|pptx?|xlsx?|png|jpe?g|gif|webp|svg|mp3|wav|m4a|mp4|mov|webm)$/iu;

const PATH_KEYS = ['file_path', 'filePath', 'path', 'filename', 'target_path', 'targetPath', 'file'];
const QUERY_KEYS = ['query', 'q', 'search', 'prompt'];
const URL_KEYS = ['url', 'uri', 'href'];
const COMMAND_KEYS = ['command', 'cmd', 'script'];

function firstString(input: unknown, keys: readonly string[]): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function baseKindForTool(name: string): TaskStepKind {
  if (PLAN_TOOL_NAMES.has(name)) return 'plan';
  if (SEARCH_TOOL_NAMES.has(name)) return 'search';
  if (FETCH_TOOL_NAMES.has(name)) return 'search-drilldown';
  if (READ_TOOL_NAMES.has(name)) return 'read';
  if (WRITE_TOOL_NAMES.has(name)) return 'write';
  if (EDIT_TOOL_NAMES.has(name)) return 'edit';
  if (LIST_TOOL_NAMES.has(name)) return 'list';
  if (COMMAND_TOOL_NAMES.has(name)) return 'command';
  if (MEDIA_GENERATE_TOOL_NAMES.has(name)) return 'generate';
  return 'tool';
}

function pathKind(kind: TaskStepKind, target: string | undefined): TaskStepKind {
  if (!target) return kind;
  const normalized = target.replace(/\\/gu, '/').toLowerCase();
  if (kind === 'read' && /^https?:\/\//u.test(normalized)) return 'search-drilldown';
  if (kind !== 'write' && kind !== 'edit') return kind;
  if (/(^|\/)generated\/.*(?:outline|plan)\.mdx?$/u.test(normalized)) return 'outline';
  if (/(^|\/)(?:outline|plan)\.mdx?$/u.test(normalized)) return 'outline';
  if (/(^|\/)generated\/inspiration(?:\.|\/)/u.test(normalized)) return 'inspiration';
  if (/(^|\/)inspiration\.(?:json|md|html)$/u.test(normalized)) return 'inspiration';
  if (/(^|\/)generated\//u.test(normalized)) return 'generate';
  if (/\.(?:html?|pptx?|pdf|docx?|xlsx?|png|jpe?g|webp|svg|mp4|mov|webm)$/u.test(normalized)) {
    return 'generate';
  }
  return kind;
}

/** Classify a tool using the same family names consumed by ToolCard. */
export function taskStepKindForTool(name: string, input?: unknown): TaskStepKind {
  const base = baseKindForTool(name);
  return pathKind(base, taskStepTargetForTool(base, input));
}

/** Extract the headline token for a tool step (query / path / URL / command). */
export function taskStepTargetForTool(kind: TaskStepKind, input: unknown): string | undefined {
  switch (kind) {
    case 'search':
      return firstString(input, QUERY_KEYS);
    case 'search-drilldown':
      return firstString(input, URL_KEYS) ?? firstString(input, QUERY_KEYS);
    case 'read':
    case 'write':
    case 'edit':
    case 'outline':
    case 'inspiration':
    case 'generate':
      return firstString(input, PATH_KEYS) ?? firstString(input, URL_KEYS);
    case 'command':
      return firstString(input, COMMAND_KEYS);
    case 'list':
      return firstString(input, ['pattern', ...PATH_KEYS]);
    default:
      return firstString(input, [...PATH_KEYS, ...QUERY_KEYS, ...URL_KEYS]);
  }
}

function clip(value: string, max = 120): string {
  const clean = value.trim().replace(/\s+/gu, ' ');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function basename(path: string): string {
  const clean = path.split(/[?#]/u, 1)[0]?.replace(/[/\\]+$/u, '') ?? path;
  return clean.split(/[/\\]/u).filter(Boolean).pop() ?? clean;
}

function todoHeadline(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as { todos?: unknown; plan?: unknown };
  const items = Array.isArray(record.todos) ? record.todos : Array.isArray(record.plan) ? record.plan : [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.status !== 'in_progress' && item.status !== 'pending') continue;
    return firstString(item, ['activeForm', 'active_form', 'content', 'step', 'description', 'label', 'text']);
  }
  return undefined;
}

function stepTitle(kind: TaskStepKind, target: string | undefined, tool: string, input: unknown): string {
  if (kind === 'plan') return clip(todoHeadline(input) ?? firstString(input, ['subject', 'description', 'title', 'task']) ?? 'Task plan', 80);
  if (kind === 'thinking') return 'Thinking';
  if (kind === 'outline') return target ? basename(target) : 'Outline';
  if (kind === 'inspiration') return target ? basename(target) : 'Inspiration';
  if (target) return clip(['read', 'write', 'edit', 'generate'].includes(kind) ? basename(target) : target, 80);
  return tool || 'Task step';
}

function stepBrief(kind: TaskStepKind, title: string, tool: string): string {
  switch (kind) {
    case 'plan': return `Updated plan · ${title}`;
    case 'outline': return `Prepared outline · ${title}`;
    case 'search': return `Searched · ${title}`;
    case 'search-drilldown': return `Opened result · ${title}`;
    case 'read': return `Read · ${title}`;
    case 'write': return `Created · ${title}`;
    case 'edit': return `Edited · ${title}`;
    case 'list': return `Inspected files · ${title}`;
    case 'command': return `Ran command · ${title}`;
    case 'inspiration': return `Prepared inspiration · ${title}`;
    case 'generate': return `Generated · ${title}`;
    case 'thinking': return title === 'Thinking' ? title : `Thought · ${title}`;
    default: return `Used ${tool || title}`;
  }
}

function sourceParts(source: readonly PersistedAgentEvent[] | TaskStepSource): {
  events: readonly PersistedAgentEvent[];
  baseTs: number;
} {
  if (Array.isArray(source)) return { events: source, baseTs: 0 };
  const typed = source as TaskStepSource;
  return {
    events: typed.events ?? [],
    baseTs: typed.startedAt ?? typed.createdAt ?? 0,
  };
}

function eventTimestamp(event: PersistedAgentEvent, index: number, baseTs: number): number {
  const meta = event as PersistedAgentEvent & { ts?: unknown; timestamp?: unknown };
  const explicit = typeof meta.ts === 'number' ? meta.ts : typeof meta.timestamp === 'number' ? meta.timestamp : null;
  return explicit != null && Number.isFinite(explicit) ? explicit : baseTs + index;
}

/**
 * Derive the ordered replay timeline for one round.
 *
 * Tool calls pair with their result by id; consecutive thinking deltas collapse
 * into one step; live artifacts remain explicit replay points. Event order is
 * preserved exactly and every returned step is self-contained for sharing.
 */
export function deriveTaskSteps(source: readonly PersistedAgentEvent[] | TaskStepSource): TaskStep[] {
  const { events, baseTs } = sourceParts(source);
  const resultByToolId = new Map<string, TaskToolResultEvent>();
  for (const event of events) {
    if (event.kind === 'tool_result') resultByToolId.set(event.toolUseId, event);
  }

  const steps: TaskStep[] = [];
  const seenToolIds = new Set<string>();
  let pendingThinking: { text: string; index: number; ts: number } | null = null;

  const flushThinking = () => {
    if (!pendingThinking) return;
    const text = clip(pendingThinking.text, 240);
    const index = pendingThinking.index;
    const ts = pendingThinking.ts;
    pendingThinking = null;
    if (!text) return;
    steps.push({
      id: `thinking:${index}`,
      kind: 'thinking',
      status: 'done',
      brief: text,
      title: text,
      target: text,
      ts,
    });
  };

  events.forEach((event, index) => {
    if (event.kind === 'thinking') {
      if (pendingThinking) pendingThinking.text += event.text;
      else pendingThinking = { text: event.text, index, ts: eventTimestamp(event, index, baseTs) };
      return;
    }
    flushThinking();

    if (event.kind === 'tool_use') {
      if (seenToolIds.has(event.id)) return;
      seenToolIds.add(event.id);
      const baseKind = baseKindForTool(event.name);
      const initialTarget = taskStepTargetForTool(baseKind, event.input);
      const kind = pathKind(baseKind, initialTarget);
      const target = taskStepTargetForTool(kind, event.input) ?? initialTarget;
      const result = resultByToolId.get(event.id);
      const title = stepTitle(kind, target, event.name, event.input);
      const step: TaskStep = {
        id: event.id,
        kind,
        status: result ? (result.isError ? 'error' : 'done') : 'running',
        brief: stepBrief(kind, title, event.name),
        title,
        ts: eventTimestamp(event, index, baseTs),
        tool: event.name,
        toolUse: event,
      };
      if (target) step.target = target;
      if (result) step.toolResult = result;
      if (result?.isError) step.isError = true;
      steps.push(step);
      return;
    }

    if (event.kind === 'live_artifact' && event.action !== 'deleted') {
      const title = clip(event.title || event.artifactId, 80);
      steps.push({
        id: `artifact:${event.artifactId}:${index}`,
        kind: 'generate',
        status: 'done',
        brief: stepBrief('generate', title, 'live_artifact'),
        title,
        target: event.title,
        ts: eventTimestamp(event, index, baseTs),
        artifact: {
          action: event.action,
          projectId: event.projectId,
          artifactId: event.artifactId,
          title: event.title,
        },
      });
    }
  });
  flushThinking();
  let previousTs = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    if (step.ts <= previousTs) step.ts = previousTs + 1;
    previousTs = step.ts;
  }
  return steps;
}

function isResolvedComputerValue(step: TaskStep): boolean {
  return step.status === 'done' && !step.isError && Boolean(step.toolResult || step.artifact);
}

/**
 * Project a raw persisted step onto the user-facing Computer content policy.
 * Returning null keeps the event available to diagnostics/CLI without turning
 * operational noise or loading state into a visual replay frame.
 */
export function taskStepComputerContentKind(
  step: TaskStep,
): TaskStepComputerContentKind | null {
  if (step.tool && PLAN_TOOL_NAMES.has(step.tool)) return null;

  if (step.kind === 'search') {
    return isResolvedComputerValue(step) ? 'search-list' : null;
  }
  if (step.kind === 'search-drilldown') {
    return isResolvedComputerValue(step) ? 'search-detail' : null;
  }
  if (step.kind === 'outline' || step.kind === 'inspiration') {
    return isResolvedComputerValue(step) ? 'plan' : null;
  }
  if (step.kind === 'generate' || step.artifact) {
    return isResolvedComputerValue(step) ? 'artifact' : null;
  }
  if (
    (step.kind === 'write' || step.kind === 'edit')
    && step.target
    && COMPUTER_DELIVERABLE_PATH_PATTERN.test(step.target.replace(/\\/gu, '/'))
  ) {
    return isResolvedComputerValue(step) ? 'artifact' : null;
  }

  return null;
}
