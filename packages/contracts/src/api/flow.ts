/**
 * North-star staged flow (specs/current/staged-flow-north-star.zh-CN.md).
 *
 * Every generation conversation walks the same fixed stage ladder —
 * clarify → research → plan → inspire → generate → deliver — regardless of
 * output shape (deck, landing page, mobile prototype, document, …). Shape
 * differences (which stages exist, what the plan artifact is called, how
 * progress is counted, which delivery CTAs appear) are declared once in the
 * `FLOW_SHAPES` registry so web, daemon, and CLI cannot drift.
 *
 * The daemon owns the `FlowSnapshot` for a conversation. It advances stages
 * through two channels: `<od-flow …/>` markers the agent emits inline in its
 * streamed text (primary), and deterministic heuristics on observable run
 * events (fallback). Both channels funnel through `applyFlowMarker`, whose
 * invariant is monotonic forward progress — a stage never moves backwards.
 */

export type FlowStageId =
  | 'clarify'
  | 'research'
  | 'plan'
  | 'inspire'
  | 'generate'
  | 'deliver';

export const FLOW_STAGE_ORDER: readonly FlowStageId[] = [
  'clarify',
  'research',
  'plan',
  'inspire',
  'generate',
  'deliver',
];

export type FlowStageState = 'pending' | 'active' | 'complete' | 'skipped' | 'error';

/** States an `<od-flow>` marker may request. `pending` is never requested —
 * it is only the initial state a snapshot is created with. */
export type FlowMarkerState = Exclude<FlowStageState, 'pending'>;

export interface FlowStageSnapshot {
  id: FlowStageId;
  state: FlowStageState;
  /** One human line, e.g. "7 个问题已确认" / "Round 1/2 · 9 searches". */
  detail?: string;
  /** Generation-style progress for the stage (rendered as N/M). */
  progress?: { done: number; total: number };
}

export type FlowResearchMode = 'deep' | 'basic' | 'off';

export interface FlowInspireChoice {
  templateId: string | null;
  skipped: boolean;
}

export type FlowShapeId =
  | 'deck'
  | 'prototype'
  | 'landing'
  | 'mobile'
  | 'webapp'
  | 'document'
  | 'report'
  | 'media';

export type FlowDeliverAction =
  | 'pptx'
  | 'pdf'
  | 'html'
  | 'zip'
  | 'deploy'
  | 'social'
  | 'preview'
  | 'md';

export interface FlowShapeSpec {
  id: FlowShapeId;
  /** Phrases used when a default-router conversation has no bound template. */
  routingHints: readonly string[];
  /** Stages that exist for this shape, in ladder order. */
  stages: readonly FlowStageId[];
  /** Shape-specific defaults the clarify form should confirm or safely infer. */
  clarifyDefaults: readonly string[];
  /** Plan-stage artifacts the agent must write before asking to confirm. */
  planArtifacts: readonly string[];
  /** Shared editable-plan grammar consumed by prompts and the web plan panel. */
  plan: {
    title: string;
    itemLabel: string;
    itemLabelKey: string;
    pointsLabel: string;
    instructions: string;
    defaultItems: readonly {
      title: string;
      points: readonly string[];
    }[];
  };
  /** Final-artifact file extensions that activate generation heuristics. */
  generateExtensions: readonly string[];
  /** i18n key for the generate-stage progress unit (页/区块/屏幕/章节/素材). */
  progressUnitKey: string;
  /** Inspiration catalogue subset for this shape (design-template od.mode / platform). */
  inspireFilter: {
    modes: readonly string[];
    platform?: string;
    /** Keep entries carrying at least one of these catalogue tags. */
    tags?: readonly string[];
  };
  /** Delivery CTA actions rendered when the deliver stage activates. */
  deliverActions: readonly FlowDeliverAction[];
}

const ALL_STAGES = FLOW_STAGE_ORDER;

export const FLOW_SHAPES: Record<FlowShapeId, FlowShapeSpec> = {
  deck: {
    id: 'deck',
    routingHints: [
      'slide deck',
      'slides',
      'presentation',
      'powerpoint',
      'ppt',
      'pptx',
      'keynote',
      'pitch deck',
      '幻灯片',
      '投影片',
      '演示文稿',
      '簡報',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'slide count',
      'aspect ratio',
      'audience',
      'visual direction',
      'speaker notes',
    ],
    planArtifacts: ['generated/brief.md', 'generated/outline.md'],
    plan: {
      title: 'Deck outline',
      itemLabel: 'Slide',
      itemLabelKey: 'flow.plan.unit.slide',
      pointsLabel: 'Key message and evidence',
      instructions:
        'Use one numbered heading per slide. Each heading is the slide answer; bullets capture evidence, visual intent, and speaker-note intent.',
      defaultItems: [
        { title: 'Opening', points: ['Introduce the topic and intended outcome'] },
        { title: 'Core idea', points: ['Explain the main insight with evidence'] },
        { title: 'Next step', points: ['Close with one clear action'] },
      ],
    },
    generateExtensions: ['.html', '.htm'],
    progressUnitKey: 'flow.unit.slides',
    inspireFilter: { modes: ['deck'] },
    deliverActions: ['pptx', 'pdf', 'social'],
  },
  prototype: {
    id: 'prototype',
    routingHints: [
      'prototype',
      'mockup',
      'wireframe',
      'interactive concept',
      '交互原型',
      '产品原型',
      '线框图',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'target platform',
      'fidelity',
      'primary user flow',
      'view count',
      'interaction depth',
    ],
    planArtifacts: ['generated/prototype-plan.md'],
    plan: {
      title: 'Prototype plan',
      itemLabel: 'View',
      itemLabelKey: 'flow.plan.unit.view',
      pointsLabel: 'Purpose, state, and interaction',
      instructions:
        'Use one numbered heading per prototype view or state. Bullets define the user goal, key content, interaction, and transition.',
      defaultItems: [
        { title: 'Entry state', points: ['Establish context and the primary action'] },
        { title: 'Core interaction', points: ['Show the main state change'] },
        { title: 'Outcome state', points: ['Confirm completion and the next action'] },
      ],
    },
    generateExtensions: ['.html', '.htm'],
    progressUnitKey: 'flow.unit.screens',
    inspireFilter: {
      modes: ['prototype'],
      platform: 'desktop',
      tags: ['prototype-template'],
    },
    deliverActions: ['preview', 'zip', 'social'],
  },
  landing: {
    id: 'landing',
    routingHints: [
      'landing page',
      'marketing page',
      'homepage',
      'waitlist page',
      'pricing page',
      '落地页',
      '营销页',
      '官网首页',
      '定价页',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'conversion goal',
      'section count',
      'audience',
      'brand direction',
      'responsive targets',
    ],
    planArtifacts: ['generated/structure.md'],
    plan: {
      title: 'Landing-page structure',
      itemLabel: 'Section',
      itemLabelKey: 'flow.plan.unit.section',
      pointsLabel: 'Message, proof, and CTA',
      instructions:
        'Use one numbered heading per page section. Bullets define the message, proof, visual role, and conversion action.',
      defaultItems: [
        { title: 'Hero promise', points: ['State the outcome and primary CTA'] },
        { title: 'Proof', points: ['Demonstrate why the promise is credible'] },
        { title: 'Conversion close', points: ['Resolve objections and repeat the CTA'] },
      ],
    },
    generateExtensions: ['.html', '.htm'],
    progressUnitKey: 'flow.unit.sections',
    inspireFilter: {
      modes: ['prototype'],
      platform: 'desktop',
      tags: ['landing-template'],
    },
    deliverActions: ['deploy', 'html', 'zip'],
  },
  mobile: {
    id: 'mobile',
    routingHints: [
      'mobile app',
      'mobile prototype',
      'ios app',
      'android app',
      'phone app',
      '移动应用',
      '移动端',
      '手机应用',
      '手机 app',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'screen count',
      'iOS or Android',
      'core task',
      'navigation model',
      'fidelity',
    ],
    planArtifacts: ['generated/flows.md'],
    plan: {
      title: 'Mobile flow',
      itemLabel: 'Screen',
      itemLabelKey: 'flow.plan.unit.screen',
      pointsLabel: 'Content, action, and transition',
      instructions:
        'Use one numbered heading per screen. Bullets define the user goal, primary action, required states, and next-screen transition.',
      defaultItems: [
        { title: 'Start', points: ['Orient the user and expose the primary action'] },
        { title: 'Complete the task', points: ['Make the core action thumb-friendly'] },
        { title: 'Success', points: ['Confirm the result and offer the next step'] },
      ],
    },
    generateExtensions: ['.html', '.htm'],
    progressUnitKey: 'flow.unit.screens',
    inspireFilter: {
      modes: ['prototype'],
      platform: 'mobile',
      tags: ['mobile-template'],
    },
    deliverActions: ['preview', 'zip', 'social'],
  },
  webapp: {
    id: 'webapp',
    routingHints: [
      'web app',
      'webapp',
      'dashboard',
      'admin panel',
      'portal',
      'desktop app',
      '网页应用',
      '管理后台',
      '数据看板',
      '工作台',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'page count',
      'information architecture',
      'primary workflow',
      'desktop or responsive target',
      'fidelity',
    ],
    planArtifacts: ['generated/plan.md'],
    plan: {
      title: 'Web-app plan',
      itemLabel: 'Page',
      itemLabelKey: 'flow.plan.unit.page',
      pointsLabel: 'Job, content, states, and navigation',
      instructions:
        'Use one numbered heading per page or major workspace. Bullets define the page job, information hierarchy, states, and navigation.',
      defaultItems: [
        { title: 'Overview', points: ['Summarize status and expose the primary task'] },
        { title: 'Core workspace', points: ['Support the main workflow and its states'] },
        { title: 'Detail and follow-up', points: ['Resolve one item and continue work'] },
      ],
    },
    generateExtensions: ['.html', '.htm'],
    progressUnitKey: 'flow.unit.pages',
    inspireFilter: {
      modes: ['prototype'],
      platform: 'desktop',
      tags: ['webapp-template'],
    },
    deliverActions: ['deploy', 'zip'],
  },
  document: {
    id: 'document',
    routingHints: [
      'document',
      'memo',
      'brief',
      'prd',
      'spec',
      'rfc',
      'proposal',
      'guide',
      'whitepaper',
      '文档',
      '备忘录',
      '方案',
      '白皮书',
      '需求文档',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'chapter count',
      'audience',
      'tone',
      'source requirements',
      'Markdown or PDF output',
    ],
    planArtifacts: ['generated/toc.md'],
    plan: {
      title: 'Document table of contents',
      itemLabel: 'Chapter',
      itemLabelKey: 'flow.plan.unit.chapter',
      pointsLabel: 'Argument, evidence, and reader outcome',
      instructions:
        'Use one numbered heading per chapter. Bullets define the chapter argument, required evidence, examples, and reader takeaway.',
      defaultItems: [
        { title: 'Executive context', points: ['State the reader need and core answer'] },
        { title: 'Main argument', points: ['Develop the answer with evidence'] },
        { title: 'Action and appendix', points: ['Close with decisions and source notes'] },
      ],
    },
    generateExtensions: ['.md', '.markdown', '.html', '.htm'],
    progressUnitKey: 'flow.unit.chapters',
    inspireFilter: { modes: ['template'], tags: ['document-template'] },
    deliverActions: ['md', 'pdf', 'social'],
  },
  report: {
    id: 'report',
    routingHints: [
      'report',
      'analysis report',
      'research report',
      'industry report',
      'operating review',
      'business review',
      'qbr',
      'pdf report',
      '报告',
      '研究报告',
      '行业报告',
      '分析报告',
      '经营复盘',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'page or chapter count',
      'decision audience',
      'chart density',
      'source and citation depth',
      'PDF-first output',
    ],
    planArtifacts: ['generated/outline.md'],
    plan: {
      title: 'Report outline',
      itemLabel: 'Chapter',
      itemLabelKey: 'flow.plan.unit.chapter',
      pointsLabel: 'Finding, evidence, chart, and implication',
      instructions:
        'Use one numbered heading per report chapter. Bullets define the finding, evidence, chart or table, implication, and source requirement.',
      defaultItems: [
        { title: 'Executive findings', points: ['Lead with the answer and decision implications'] },
        { title: 'Evidence and analysis', points: ['Show the drivers, comparisons, and charts'] },
        { title: 'Recommendation', points: ['Name actions, risks, owners, and sources'] },
      ],
    },
    generateExtensions: ['.html', '.htm', '.pdf'],
    progressUnitKey: 'flow.unit.chapters',
    inspireFilter: { modes: ['template'], tags: ['report-template'] },
    deliverActions: ['pdf', 'social'],
  },
  media: {
    id: 'media',
    routingHints: [
      'image',
      'video',
      'audio',
      'poster',
      'illustration',
      '图片',
      '图像',
      '视频',
      '音频',
      '海报',
    ],
    stages: ALL_STAGES,
    clarifyDefaults: [
      'media type',
      'quantity',
      'aspect ratio',
      'style',
      'duration when applicable',
    ],
    planArtifacts: ['generated/shots.md'],
    plan: {
      title: 'Media shot plan',
      itemLabel: 'Asset',
      itemLabelKey: 'flow.plan.unit.asset',
      pointsLabel: 'Subject, composition, style, and output',
      instructions:
        'Use one numbered heading per asset or shot. Bullets define subject, composition, movement when applicable, style, and output constraints.',
      defaultItems: [
        { title: 'Primary asset', points: ['Define the subject and visual hierarchy'] },
        { title: 'Supporting variation', points: ['Change one meaningful dimension'] },
        { title: 'Delivery variant', points: ['Adapt for the final channel and format'] },
      ],
    },
    generateExtensions: [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.svg',
      '.mp4',
      '.webm',
      '.mov',
      '.mp3',
      '.wav',
      '.m4a',
    ],
    progressUnitKey: 'flow.unit.assets',
    inspireFilter: { modes: ['image', 'video', 'audio'] },
    deliverActions: ['zip', 'social'],
  },
};

export interface FlowSnapshot {
  version: 1;
  shape: FlowShapeId;
  stages: FlowStageSnapshot[];
  activeStage: FlowStageId | null;
  researchMode: FlowResearchMode;
  inspireChoice?: FlowInspireChoice;
  updatedAt: number;
}

/** `GET /api/conversations/:id/flow` response. `flow` is null for
 * conversations that never entered the staged flow (plain chat, tune). */
export interface FlowStatusResponse {
  conversationId: string;
  flow: FlowSnapshot | null;
}

/** `PATCH /api/conversations/:id/flow` request. */
export interface UpdateFlowResearchModeRequest {
  researchMode: FlowResearchMode;
}

/** `POST /api/conversations/:id/flow/plan-confirm` request. */
export interface ConfirmFlowPlanRequest {
  /** The formatted `[form answers — plan-confirm]` message persisted to chat. */
  message: string;
}

/** Map a design-template / plugin `od.mode` (+ platform) to a flow shape.
 * Returns null when the mode has no staged-flow shape (e.g. unknown modes). */
export function flowShapeFromModePlatform(
  mode: string | null | undefined,
  platform?: string | null,
): FlowShapeId | null {
  switch (mode) {
    case 'deck':
      return 'deck';
    case 'prototype':
      if (platform === 'mobile') return 'mobile';
      if (platform === 'desktop' || platform === 'web') return 'webapp';
      return 'prototype';
    case 'image':
    case 'video':
    case 'audio':
      return 'media';
    case 'template':
      return 'document';
    default:
      return null;
  }
}

const FLOW_TEXT_ROUTE_ORDER: readonly FlowShapeId[] = [
  'deck',
  'report',
  'document',
  'landing',
  'mobile',
  'webapp',
  'prototype',
  'media',
];

function routeHintMatches(text: string, hint: string): boolean {
  const normalizedHint = hint.toLowerCase();
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(normalizedHint)) {
    return text.includes(normalizedHint);
  }
  const escaped = normalizedHint.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\b${escaped.replace(/\s+/gu, '\\s+')}\\b`, 'u').test(text);
}

/** Resolve an unbound/default-router request into a staged-flow shape. */
export function flowShapeFromRequestText(
  text: string | null | undefined,
): FlowShapeId | null {
  if (!text?.trim()) return null;
  const normalized = text.normalize('NFKC').toLowerCase();
  for (const shape of FLOW_TEXT_ROUTE_ORDER) {
    if (
      FLOW_SHAPES[shape].routingHints.some((hint) =>
        routeHintMatches(normalized, hint),
      )
    ) {
      return shape;
    }
  }
  return null;
}

export function createFlowSnapshot(
  shape: FlowShapeId,
  options?: { researchMode?: FlowResearchMode | undefined; now?: number },
): FlowSnapshot {
  const spec = FLOW_SHAPES[shape];
  return {
    version: 1,
    shape,
    stages: spec.stages.map((id) => ({ id, state: 'pending' as FlowStageState })),
    activeStage: null,
    researchMode: options?.researchMode ?? 'basic',
    updatedAt: options?.now ?? 0,
  };
}

// ---------------------------------------------------------------------------
// `<od-flow …/>` inline markers
//
// The agent narrates stage transitions with a single self-closing tag on its
// own line, e.g.:
//
//   <od-flow stage="plan" state="active" detail="正在写大纲"/>
//   <od-flow stage="generate" state="active" done="3" total="12"/>
//
// Markers are protocol, not content: renderers strip them (see
// `stripOdFlowMarkers`) the same way `<question-form>` blocks are lifted out
// of assistant text.
// ---------------------------------------------------------------------------

export interface OdFlowMarker {
  stage: FlowStageId;
  state: FlowMarkerState;
  detail?: string;
  done?: number;
  total?: number;
}

const OD_FLOW_TAG_RE = /<od-flow\b([^<>]*?)\/?>(?:\s*<\/od-flow>)?/gi;
const OD_FLOW_ATTR_RE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const FLOW_STAGE_ID_SET = new Set<string>(FLOW_STAGE_ORDER);
const FLOW_MARKER_STATES = new Set<string>(['active', 'complete', 'skipped', 'error']);

function decodeMarkerEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseMarkerAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  OD_FLOW_ATTR_RE.lastIndex = 0;
  for (let m = OD_FLOW_ATTR_RE.exec(raw); m; m = OD_FLOW_ATTR_RE.exec(raw)) {
    const key = m[1];
    if (!key) continue;
    attrs[key.toLowerCase()] = decodeMarkerEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/** Parse every complete `<od-flow …/>` marker in `text`, in order. Invalid
 * markers (unknown stage/state) are dropped — the fallback heuristics keep
 * the snapshot honest when the model misfires. */
export function parseOdFlowMarkers(text: string): OdFlowMarker[] {
  const markers: OdFlowMarker[] = [];
  OD_FLOW_TAG_RE.lastIndex = 0;
  for (let m = OD_FLOW_TAG_RE.exec(text); m; m = OD_FLOW_TAG_RE.exec(text)) {
    const attrs = parseMarkerAttributes(m[1] ?? '');
    const stage = attrs.stage;
    const state = attrs.state;
    if (!stage || !FLOW_STAGE_ID_SET.has(stage)) continue;
    if (!state || !FLOW_MARKER_STATES.has(state)) continue;
    const marker: OdFlowMarker = {
      stage: stage as FlowStageId,
      state: state as FlowMarkerState,
    };
    if (attrs.detail) marker.detail = attrs.detail;
    const done = attrs.done !== undefined ? Number(attrs.done) : NaN;
    const total = attrs.total !== undefined ? Number(attrs.total) : NaN;
    if (Number.isFinite(done)) marker.done = done;
    if (Number.isFinite(total)) marker.total = total;
    markers.push(marker);
  }
  return markers;
}

/** Remove complete markers plus any trailing unterminated `<od-flow`
 * fragment (mid-stream chunk boundary), for display surfaces. */
export function stripOdFlowMarkers(text: string): string {
  let out = text.replace(OD_FLOW_TAG_RE, '');
  const tail = out.lastIndexOf('<od-flow');
  if (tail !== -1 && !out.slice(tail).includes('>')) {
    out = out.slice(0, tail);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Monotonic snapshot advancement
// ---------------------------------------------------------------------------

const TERMINAL_STAGE_STATES: ReadonlySet<FlowStageState> = new Set([
  'complete',
  'skipped',
  'error',
]);

function stageIndex(snapshot: FlowSnapshot, id: FlowStageId): number {
  return snapshot.stages.findIndex((s) => s.id === id);
}

/**
 * Apply one marker (from either channel) to a snapshot, returning a new
 * snapshot. Invariant: monotonic forward progress —
 * - a terminal stage never changes state again;
 * - activating a stage completes every earlier still-active stage and marks
 *   earlier never-started stages `skipped`;
 * - a marker for a stage earlier than the current active stage is ignored.
 * Returns the input snapshot unchanged when the marker is a no-op.
 */
export function applyFlowMarker(
  snapshot: FlowSnapshot,
  marker: OdFlowMarker,
  now: number,
): FlowSnapshot {
  const idx = stageIndex(snapshot, marker.stage);
  if (idx === -1) return snapshot;
  const activeIdx = snapshot.activeStage ? stageIndex(snapshot, snapshot.activeStage) : -1;
  const current = snapshot.stages[idx];
  if (!current) return snapshot;

  if (marker.state === 'active') {
    if (TERMINAL_STAGE_STATES.has(current.state)) return snapshot;
    if (activeIdx > idx) return snapshot;
    if (
      current.state === 'active' &&
      marker.detail === undefined &&
      marker.done === undefined &&
      marker.total === undefined
    ) {
      return snapshot;
    }
    const stages = snapshot.stages.map((stage, i) => {
      if (i < idx && !TERMINAL_STAGE_STATES.has(stage.state)) {
        return {
          ...stage,
          state: (stage.state === 'active' ? 'complete' : 'skipped') as FlowStageState,
        };
      }
      if (i === idx) return updatedStage(stage, 'active', marker);
      return stage;
    });
    return { ...snapshot, stages, activeStage: marker.stage, updatedAt: now };
  }

  // Terminal marker (complete / skipped / error).
  if (TERMINAL_STAGE_STATES.has(current.state)) return snapshot;
  if (activeIdx > idx && current.state === 'pending') return snapshot;
  const stages = snapshot.stages.map((stage, i) =>
    i === idx ? updatedStage(stage, marker.state, marker) : stage,
  );
  return { ...snapshot, stages, updatedAt: now };
}

function updatedStage(
  stage: FlowStageSnapshot,
  state: FlowStageState,
  marker: OdFlowMarker,
): FlowStageSnapshot {
  const next: FlowStageSnapshot = { id: stage.id, state };
  const detail = marker.detail ?? stage.detail;
  if (detail !== undefined) next.detail = detail;
  const progress = progressFromMarker(marker, stage.progress);
  if (progress !== undefined) next.progress = progress;
  return next;
}

function progressFromMarker(
  marker: OdFlowMarker,
  previous: { done: number; total: number } | undefined,
): { done: number; total: number } | undefined {
  if (marker.done === undefined && marker.total === undefined) return previous;
  return {
    done: marker.done ?? previous?.done ?? 0,
    total: marker.total ?? previous?.total ?? 0,
  };
}
