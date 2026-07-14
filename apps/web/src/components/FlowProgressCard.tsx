// Staged-flow progress card (specs/current/staged-flow-north-star.zh-CN.md
// §5.3). Renders a conversation's FlowSnapshot as the fixed stage ladder —
// clarify → research → plan → inspire → generate → deliver — with one line of
// detail per step. Pending steps always carry a "when does this start" hint so
// the whole journey is legible before it happens (problem P1 in the spec).
// The card is a pure renderer: all advancement lives in the daemon tracker.

import type { FlowSnapshot, FlowStageId, FlowStageState } from '@open-design/contracts';
import { FLOW_SHAPES } from '@open-design/contracts';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import type { FlowStageArtifactPaths } from '../runtime/flow-artifacts';
import styles from './FlowProgressCard.module.css';

const STAGE_LABEL_KEY: Record<FlowStageId, keyof Dict> = {
  clarify: 'flow.stage.clarify',
  research: 'flow.stage.research',
  plan: 'flow.stage.plan',
  inspire: 'flow.stage.inspire',
  generate: 'flow.stage.generate',
  deliver: 'flow.stage.deliver',
};

/** i18n key for a stage label — shared with the pinned task-progress card so
 * the collapsed row can name the current step without re-deriving the map. */
export function flowStageLabelKey(id: FlowStageId): keyof Dict {
  return STAGE_LABEL_KEY[id];
}

export interface FlowProgressSummary {
  current: number;
  total: number;
  activeStage: { id: FlowStageId; labelKey: keyof Dict } | null;
}

/** The `Step N of M` counts + the active stage, computed the same way the card
 * renders them. Lets the pinned wrapper own the header while the card body
 * stays a pure renderer (`hideHead`). */
export function flowProgressSummary(flow: FlowSnapshot): FlowProgressSummary {
  const visibleStages = visibleFlowStages(flow);
  const total = visibleStages.length;
  const activeIndex = flow.activeStage
    ? visibleStages.findIndex((s) => s.id === flow.activeStage)
    : -1;
  const terminalCount = visibleStages.filter(
    (stage) => stage.state !== 'pending' && stage.state !== 'active',
  ).length;
  const current =
    activeIndex >= 0 ? activeIndex + 1 : Math.max(1, Math.min(terminalCount, total));
  const active = activeIndex >= 0 ? visibleStages[activeIndex] : null;
  return {
    current,
    total,
    activeStage: active ? { id: active.id, labelKey: STAGE_LABEL_KEY[active.id] } : null,
  };
}

function visibleFlowStages(flow: FlowSnapshot) {
  return flow.stages.filter(
    (stage) =>
      stage.id !== 'research' ||
      flow.researchMode === 'deep' ||
      stage.state !== 'pending',
  );
}

const STAGE_HINT_KEY: Record<FlowStageId, keyof Dict> = {
  clarify: 'flow.hint.clarify',
  research: 'flow.hint.research',
  plan: 'flow.hint.plan',
  inspire: 'flow.hint.inspire',
  generate: 'flow.hint.generate',
  deliver: 'flow.hint.deliver',
};

const STATE_KEY: Record<Exclude<FlowStageState, 'pending'>, keyof Dict> = {
  active: 'flow.state.active',
  complete: 'flow.state.complete',
  skipped: 'flow.state.skipped',
  error: 'flow.state.error',
};

const STAGE_GLYPH: Record<FlowStageState, string> = {
  pending: '○',
  active: '◔',
  complete: '✓',
  skipped: '⊘',
  error: '✕',
};

function localizedCanonicalDetail(
  detail: string,
  t: ReturnType<typeof useT>,
): string {
  if (detail === 'Waiting for outline changes') return t('flow.state.active');
  if (detail === 'Outline confirmed') return t('flow.state.complete');
  if (detail === 'Skipped · Using the default style') {
    return `${t('flow.state.skipped')} · ${t('common.default')}`;
  }
  const template = /^Using template (.+)$/u.exec(detail)?.[1];
  if (template) return `${t('common.selected')} · ${template}`;
  return detail;
}

export function FlowProgressCard({
  flow,
  stageArtifactPaths,
  stageActions,
  onOpenArtifact,
  hideHead = false,
}: {
  flow: FlowSnapshot;
  stageArtifactPaths?: FlowStageArtifactPaths;
  stageActions?: Partial<Record<FlowStageId, () => void>>;
  onOpenArtifact?: (path: string) => void;
  /** When the pinned task-progress wrapper renders its own header, hide the
   * card's own `Task progress · Step N of M` head to avoid duplication. */
  hideHead?: boolean;
}) {
  const t = useT();
  const visibleStages = visibleFlowStages(flow);
  const { current, total } = flowProgressSummary(flow);
  const unit = t(FLOW_SHAPES[flow.shape].progressUnitKey as keyof Dict);

  return (
    <div className={styles.root} data-testid="flow-progress-card">
      {hideHead ? null : (
        <div className={styles.head}>
          <span className={styles.title}>{t('flow.title')}</span>
          <span className={styles.stepOf}>{t('flow.stepOf', { current, total })}</span>
        </div>
      )}
      <ol className={styles.steps}>
        {visibleStages.map((stage) => {
          const detail =
            (stage.detail ? localizedCanonicalDetail(stage.detail, t) : undefined) ??
            (stage.state === 'pending'
              ? t(STAGE_HINT_KEY[stage.id])
              : t(STATE_KEY[stage.state]));
          const label = t(STAGE_LABEL_KEY[stage.id]);
          const stageAction = stageActions?.[stage.id];
          const artifactPaths = stageArtifactPaths?.[stage.id] ?? [];
          const artifactPath = artifactPaths[0];
          const actionable = Boolean(stageAction || (artifactPath && onOpenArtifact));
          const content = (
            <>
              <span className={styles.icon} aria-hidden>
                {STAGE_GLYPH[stage.state]}
              </span>
              <div className={styles.copy}>
                <div className={styles.labelRow}>
                  <span className={styles.label}>{label}</span>
                  {stage.progress && stage.progress.total > 0 ? (
                    <span className={styles.count}>
                      {stage.progress.done} / {stage.progress.total} {unit}
                    </span>
                  ) : null}
                </div>
                <div className={styles.detail}>{detail}</div>
                {artifactPaths.length > 0 ? (
                  <div className={styles.artifacts} aria-label={`${label} outputs`}>
                    {artifactPaths.slice(0, 2).map((path) => (
                      <span key={path} className={styles.artifactPath} title={path}>
                        {path}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {actionable ? (
                <span className={styles.openIcon} aria-hidden>
                  ↗
                </span>
              ) : null}
            </>
          );
          return (
            <li key={stage.id} className={`${styles.step} ${styles[stage.state]}`}>
              {actionable ? (
                <button
                  type="button"
                  className={styles.stepAction}
                  title={stageAction ? label : artifactPath}
                  aria-label={stageAction ? label : `${label}: ${artifactPath}`}
                  onClick={() => {
                    if (stageAction) {
                      stageAction();
                      return;
                    }
                    if (artifactPath) onOpenArtifact?.(artifactPath);
                  }}
                >
                  {content}
                </button>
              ) : (
                <div className={styles.stepContent}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
