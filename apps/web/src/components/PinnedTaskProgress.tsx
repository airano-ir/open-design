// Pinned per-round task-progress card (specs/current/task-progress-and-computer-
// replay.zh-CN.md §3.1). Lives ABOVE the composer (sibling of QueuedSendStrip),
// always visible, and shows only the CURRENT round's top-level steps. It is a
// thin wrapper around FlowProgressCard: it owns the collapsible header (Computer
// entry · current step · N/M · Live) and lets the card body render headless.
// During a staged creation round the macro flow is canonical; TodoWrite remains
// available only for a later lightweight edit round whose start post-dates the
// last flow update.
//
// The card is a pure renderer — all advancement lives in the daemon flow tracker
// and reaches here via the conversation FlowSnapshot.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowSnapshot, FlowStageId } from '@open-design/contracts';
import { useT } from '../i18n';
import type { FlowStageArtifactPaths } from '../runtime/flow-artifacts';
import { parseTodoWriteInput, type TodoItem } from '../runtime/todos';
import {
  computerStepsFromRound,
  taskStepBrief,
  type TaskRound,
  type TaskStep,
} from '../runtime/task-steps';
import {
  FlowProgressCard,
  flowProgressSummary,
  flowStageLabelKey,
} from './FlowProgressCard';
import { Icon } from './Icon';
import styles from './PinnedTaskProgress.module.css';

export type PinnedTaskRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | null;

export function PinnedTaskProgress({
  flow,
  round,
  todoInput,
  live,
  status = null,
  stageArtifactPaths,
  stageActions,
  onOpenArtifact,
  onOpenComputer,
}: {
  flow?: FlowSnapshot | null;
  round: TaskRound;
  /** Latest TodoWrite snapshot for lightweight edit rounds. */
  todoInput?: unknown | null;
  /** True while this round's run is still active (drives the green Live pill). */
  live: boolean;
  /** Terminal run status for this round; drives the ended-state badge once the
   * Live pill goes away, giving an unmistakable completion cue (spec §3.3). */
  status?: PinnedTaskRunStatus;
  stageArtifactPaths?: FlowStageArtifactPaths;
  stageActions?: Partial<Record<FlowStageId, () => void>>;
  onOpenArtifact?: (path: string) => void;
  /** Opens the replayable Computer panel. Rendered as a thumbnail entry when
   * provided; omitted (static glyph) until the Computer panel ships (M2). */
  onOpenComputer?: (stepId?: string) => void;
}) {
  const t = useT();
  const terminal = round.status === 'succeeded' || round.status === 'failed' || round.status === 'canceled';
  // The composer copy is intentionally a compact floating summary. The full
  // ladder is one click away and opens above the composer without moving it.
  const [collapsed, setCollapsed] = useState(true);
  const previousTerminalRef = useRef(terminal);
  const previousRunIdRef = useRef(round.runId);
  useEffect(() => {
    if (previousRunIdRef.current !== round.runId) {
      previousRunIdRef.current = round.runId;
      previousTerminalRef.current = terminal;
      setCollapsed(true);
      return;
    }
    if (!previousTerminalRef.current && terminal) setCollapsed(true);
    previousTerminalRef.current = terminal;
  }, [round.runId, terminal]);
  const todos = useMemo(() => parseTodoWriteInput(todoInput), [todoInput]);
  const activeFlow = flow && (round.startedAt == null || flow.updatedAt >= round.startedAt)
    ? flow
    : null;
  const flowSummary = activeFlow ? flowProgressSummary(activeFlow) : null;
  const lastCompletedFlowStage = activeFlow
    ? [...activeFlow.stages]
      .reverse()
      .find((stage) => stage.state === 'complete' || stage.state === 'skipped')
    : null;
  const awaitingInput = !live && status === 'succeeded' && Boolean(flowSummary?.activeStage);
  const stepSummary = taskRoundSummary(round.steps);
  const todoSummary = todoProgressSummary(todos);
  const summary = flowSummary
    ? {
      current: flowSummary.current,
      total: flowSummary.total,
      currentLabel: flowSummary.activeStage
        ? t(flowSummary.activeStage.labelKey)
        : lastCompletedFlowStage
          ? t(flowStageLabelKey(lastCompletedFlowStage.id))
          : t('flow.state.complete'),
      status: flowSummary.activeStage ? ('running' as const) : ('done' as const),
    }
    : todos.length > 0
      ? todoSummary
      : stepSummary;
  const computerSteps = computerStepsFromRound(round);
  const previewStep = computerSteps.find(({ step }) => step.status === 'running')?.step
    ?? computerSteps.at(-1)?.step;
  const previewLabel = previewStep ? taskStepBrief(previewStep, t) : t('task.computer.empty');
  const previewStatusLabel = live
    ? t('task.computer.live')
    : awaitingInput
      ? t('designs.status.awaitingInput')
      : status === 'succeeded'
        ? t('task.status.completed')
        : '';

  return (
    <div
      className={styles.root}
      data-testid="pinned-task-progress"
      data-live={live}
      data-collapsed={collapsed}
    >
      <div className={styles.head}>
        {onOpenComputer ? (
          <button
            type="button"
            className={styles.computer}
            onClick={() => onOpenComputer()}
            aria-label={t('task.computer.open')}
            data-testid="pinned-task-computer-entry"
          >
            <ComputerPreviewThumbnail
              label={previewLabel}
              status={previewStep?.status ?? 'running'}
              live={live}
              statusLabel={previewStatusLabel}
            />
          </button>
        ) : (
          <span className={styles.computer} aria-hidden>
            <ComputerPreviewThumbnail
              label={previewLabel}
              status={previewStep?.status ?? 'running'}
              live={live}
              statusLabel={previewStatusLabel}
            />
          </span>
        )}
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className={styles.title}>
            {collapsed ? (
              <>
                <ProgressStatusIcon status={summary.status} />
                <span className={styles.currentLabel}>{summary.currentLabel}</span>
              </>
            ) : (
              t('flow.title')
            )}
          </span>
          <span className={styles.spacer} />
          {!collapsed && live ? (
            <span className={styles.live} data-testid="pinned-task-live">
              <span className={styles.liveDot} aria-hidden />
              {t('designs.badgeLive')}
            </span>
          ) : !collapsed && awaitingInput ? (
            <span
              className={`${styles.terminal} ${styles.waiting}`}
              data-testid="pinned-task-status"
            >
              <Icon name="comment" size={13} />
              {t('designs.status.awaitingInput')}
            </span>
          ) : !collapsed && status === 'succeeded' ? (
            <span
              className={`${styles.terminal} ${styles.done}`}
              data-testid="pinned-task-status"
            >
              <Icon name="check" size={13} />
              {t('task.status.completed')}
            </span>
          ) : !collapsed && status === 'failed' ? (
            <span
              className={`${styles.terminal} ${styles.failed}`}
              data-testid="pinned-task-status"
            >
              <Icon name="close" size={13} />
              {t('task.status.failed')}
            </span>
          ) : !collapsed && status === 'canceled' ? (
            <span
              className={`${styles.terminal} ${styles.stopped}`}
              data-testid="pinned-task-status"
            >
              <Icon name="stop" size={13} />
              {t('task.status.stopped')}
            </span>
          ) : null}
          <span className={styles.stepOf}>
            {t('flow.stepOf', { current: summary.current, total: summary.total })}
          </span>
          <span
            className={styles.chevron}
            data-collapsed={collapsed}
            aria-hidden
          >
            <Icon name="chevron-down" size={15} />
          </span>
        </button>
      </div>
      <div
        className={`accordion-collapsible ${styles.body}${collapsed ? '' : ' open'}`}
        data-transition-state={collapsed ? 'collapsed' : 'expanded'}
      >
        <div className="accordion-collapsible-inner">
          <div className={styles.bodyInner}>
            {activeFlow ? (
              <FlowProgressCard
                flow={activeFlow}
                hideHead
                stageArtifactPaths={stageArtifactPaths}
                stageActions={stageActions}
                onOpenArtifact={onOpenArtifact}
              />
            ) : todos.length > 0 ? (
              <CompactTodoProgress todos={todos} />
            ) : (
              <CompactStepProgress steps={round.steps} onOpenComputer={onOpenComputer} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function taskRoundSummary(steps: TaskStep[]) {
  const total = Math.max(steps.length, 1);
  const activeIndex = steps.findIndex((step) => step.status === 'running');
  const lastIndex = activeIndex >= 0 ? activeIndex : Math.max(0, steps.length - 1);
  const active = steps[lastIndex];
  return {
    current: Math.min(lastIndex + 1, total),
    total,
    currentLabel: active?.brief ?? 'Task',
    status: active?.status ?? ('running' as const),
  };
}

function todoProgressSummary(todos: TodoItem[]) {
  const total = Math.max(todos.length, 1);
  const activeIndex = todos.findIndex((todo) => todo.status === 'in_progress');
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const index = activeIndex >= 0 ? activeIndex : Math.min(done, total - 1);
  const active = todos[index];
  return {
    current: Math.min(index + 1, total),
    total,
    currentLabel: active?.activeForm ?? active?.content ?? 'Task',
    status: active?.status ?? ('pending' as const),
  };
}

function CompactTodoProgress({ todos }: { todos: TodoItem[] }) {
  return (
    <ol className={styles.compactList} data-testid="pinned-task-todos">
      {todos.map((todo, index) => (
        <li key={`${todo.content}:${index}`} data-status={todo.status}>
          <ProgressStatusIcon status={todo.status} />
          <span>{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span>
        </li>
      ))}
    </ol>
  );
}

function CompactStepProgress({
  steps,
  onOpenComputer,
}: {
  steps: TaskStep[];
  onOpenComputer?: (stepId?: string) => void;
}) {
  const t = useT();
  return (
    <ol className={styles.compactList} data-testid="pinned-task-steps">
      {steps.length > 0 ? steps.map((step) => (
        <li key={step.id} data-status={step.status}>
          <button type="button" onClick={() => onOpenComputer?.(step.id)} disabled={!onOpenComputer}>
            <ProgressStatusIcon status={step.status} />
            <span>{taskStepBrief(step, t)}</span>
          </button>
        </li>
      )) : (
        <li data-status="running"><ProgressStatusIcon status="running" /><span>{t('task.computer.empty')}</span></li>
      )}
    </ol>
  );
}

// This is deliberately a structured miniature of the current Computer step,
// not an iframe or captured bitmap. `memo` plus primitive props means token
// deltas cannot repaint it; it updates only when the actual step/status changes.
const ComputerPreviewThumbnail = memo(function ComputerPreviewThumbnail({
  label,
  status,
  live,
  statusLabel,
}: {
  label: string;
  status: TaskStep['status'];
  live: boolean;
  statusLabel: string;
}) {
  return (
    <span className={styles.preview} data-testid="pinned-task-computer-preview" aria-hidden>
      <span className={styles.previewBar}>
        <span className={styles.previewDot} data-live={live} />
        <span className={styles.previewStatus}>{statusLabel || (status === 'error' ? '!' : '')}</span>
      </span>
      <span className={styles.previewContent}>
        <span className={styles.previewGlyph}><Icon name="present" size={12} /></span>
        <span className={styles.previewLabel}>{label}</span>
      </span>
    </span>
  );
});

type ProgressStatus = TaskStep['status'] | TodoItem['status'] | 'pending';

function ProgressStatusIcon({ status }: { status: ProgressStatus }) {
  const icon = status === 'done' || status === 'completed'
    ? 'check'
    : status === 'error'
      ? 'close'
      : status === 'stopped'
        ? 'stop'
        : status === 'pending'
          ? 'minus'
          : 'spinner';
  return (
    <span className={styles.progressStatusIcon} data-status={status} aria-hidden>
      <Icon name={icon} size={13} />
    </span>
  );
}
