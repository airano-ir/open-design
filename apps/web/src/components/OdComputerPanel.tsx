// Replayable "Computer" panel (specs/current/task-progress-and-computer-replay.zh-CN.md §3.4).
//
// A value-replay theater over the CURRENT round. The raw event stream is
// intentionally reduced to resolved plan, search, drilldown, and deliverable
// frames before it reaches this component; operational noise and loading state
// remain available to diagnostics without competing for the user's attention.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TrackingProjectKind } from '@open-design/contracts/analytics';
import { useT } from '../i18n';
import {
  computerStepsFromRound,
  taskStepBrief,
  taskStepTargetLabel,
  type ComputerStep,
  type TaskRound,
  type TaskStep,
} from '../runtime/task-steps';
import type { ProjectFile } from '../types';
import { FileViewer } from './FileViewer';
import { Icon } from './Icon';
import { ToolCard } from './ToolCard';
import styles from './OdComputerPanel.module.css';

export type OdComputerVariant = 'side' | 'modal' | 'workspace';

const COMPUTER_HEADER_ICON_SIZE = 18;

export function OdComputerPanel({
  round,
  variant,
  initialStepId,
  projectId,
  projectKind,
  projectFiles = [],
  filesRefreshKey = 0,
  projectFileNames,
  onRequestOpenFile,
  onToggleView,
  onClose,
}: {
  round: TaskRound | null;
  variant: OdComputerVariant;
  initialStepId?: string;
  projectId?: string | null;
  projectKind?: TrackingProjectKind | null;
  projectFiles?: ProjectFile[];
  filesRefreshKey?: number;
  projectFileNames?: Set<string>;
  onRequestOpenFile?: (name: string) => void;
  /** Toggle between docked side view and the global modal. */
  onToggleView?: (stepId?: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const steps = useMemo(() => computerStepsFromRound(round), [round]);
  const total = steps.length;

  // `null` = follow live. A concrete step id is a durable history lock: new
  // events may append to the round, but they never move the user's selection.
  // Index-based selection used to be reset whenever `steps` changed, which is
  // exactly what made a live run yank the scrubber back to the newest event.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialStepId ?? null);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  useEffect(() => {
    setSelectedStepId(initialStepId ?? null);
  }, [initialStepId, round?.runId]);
  useEffect(() => {
    setProgressCollapsed(false);
  }, [round?.runId]);
  const selectedIndex = selectedStepId
    ? steps.findIndex(({ step }) => step.id === selectedStepId)
    : -1;
  const following = selectedStepId === null || selectedIndex < 0;
  const index = total === 0 ? -1 : following ? total - 1 : selectedIndex;
  const active = index >= 0 ? steps[index] : undefined;
  const previousStepRef = useRef({ runId: round?.runId ?? null, index });
  const stepDirection = previousStepRef.current.runId === (round?.runId ?? null)
    && index < previousStepRef.current.index
    ? 'backward'
    : 'forward';
  useLayoutEffect(() => {
    previousStepRef.current = { runId: round?.runId ?? null, index };
  }, [index, round?.runId]);
  const stepTransitionKey = `${round?.runId ?? 'empty'}:${active?.step.id ?? 'empty'}`;

  const goPrev = () => {
    if (index > 0) setSelectedStepId(steps[index - 1]?.step.id ?? null);
  };
  const goNext = () => {
    if (total === 0 || index >= total - 1) return;
    const next = index + 1;
    setSelectedStepId(next >= total - 1 ? null : (steps[next]?.step.id ?? null));
  };
  const onScrub = (raw: number) => {
    if (raw >= total - 1) setSelectedStepId(null);
    else setSelectedStepId(steps[raw]?.step.id ?? null);
  };

  return (
    <section className={styles.root} data-testid="od-computer-panel" data-variant={variant}>
      {variant === 'workspace' ? null : (
        <header className={styles.header}>
          <span className={styles.badge} aria-hidden>
            <Icon name="present" size={COMPUTER_HEADER_ICON_SIZE} />
          </span>
          <div className={styles.titles}>
            <span className={styles.title}>{t('task.computer.title')}</span>
            <span
              key={stepTransitionKey}
              className={styles.status}
              data-direction={stepDirection}
              data-testid="od-computer-status"
            >
              {active
                ? `${t('brand.appliedToChat', { name: active.step.tool ?? taskStepBrief(active.step, t) })} · ${taskStepTargetLabel(active.step, t)}`
                : t('task.computer.empty')}
            </span>
          </div>
          <div className={styles.headerActions}>
            {onToggleView ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onToggleView(following ? undefined : active?.step.id)}
                aria-label={
                  variant === 'side' ? t('task.computer.expand') : t('task.computer.sideView')
                }
                title={
                  variant === 'side' ? t('task.computer.expand') : t('task.computer.sideView')
                }
              >
                <Icon
                  name={variant === 'side' ? 'maximize' : 'panel-left'}
                  size={COMPUTER_HEADER_ICON_SIZE}
                />
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onClose}
                aria-label={t('task.computer.close')}
                title={t('task.computer.close')}
              >
                <Icon name="close" size={COMPUTER_HEADER_ICON_SIZE} />
              </button>
            ) : null}
          </div>
        </header>
      )}

      <div className={styles.body} data-testid="od-computer-body">
        <div
          key={stepTransitionKey}
          className={styles.stepTransition}
          data-testid="od-computer-step-transition"
          data-direction={stepDirection}
          data-step-id={active?.step.id}
        >
          {active ? (
            <StepBody
              computer={active}
              live={round?.live ?? false}
              projectId={projectId}
              projectKind={projectKind}
              projectFiles={projectFiles}
              filesRefreshKey={filesRefreshKey}
              projectFileNames={projectFileNames}
              onRequestOpenFile={onRequestOpenFile}
            />
          ) : (
            <div className={styles.empty} data-testid="od-computer-value-empty" aria-hidden />
          )}
        </div>
      </div>

      {total > 0 ? (
        <div className={styles.timeline}>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={goPrev}
            disabled={index <= 0}
            aria-label={t('task.computer.prevStep')}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={goNext}
            disabled={index >= total - 1}
            aria-label={t('task.computer.nextStep')}
          >
            <Icon name="chevron-right" size={14} />
          </button>
          <input
            type="range"
            className={styles.scrubber}
            min={0}
            max={total - 1}
            value={index}
            onChange={(event) => onScrub(Number(event.target.value))}
            disabled={total <= 1}
            aria-label={t('task.computer.stepCount', {
              current: index + 1,
              total,
            })}
            data-testid="od-computer-scrubber"
          />
          {following ? (
            round?.live ? (
              <span className={styles.liveState} data-testid="od-computer-live">
                <span className={styles.liveDot} aria-hidden />
                {t('task.computer.live')}
              </span>
            ) : (
              <span className={styles.count}>
                {t('task.computer.stepCount', { current: index + 1, total })}
              </span>
            )
          ) : (
            <button
              type="button"
              className={styles.jumpLive}
              onClick={() => setSelectedStepId(null)}
              data-testid="od-computer-jump-live"
            >
              <span className={styles.liveDot} data-live={round?.live ?? false} aria-hidden />
              {t('task.computer.jumpToLive')}
            </button>
          )}
        </div>
      ) : null}
      {total > 0 ? (
        <div
          className={styles.taskProgress}
          data-testid="od-computer-task-summary"
          data-collapsed={progressCollapsed}
        >
          <button
            type="button"
            className={styles.taskProgressToggle}
            aria-expanded={!progressCollapsed}
            aria-label={progressCollapsed
              ? t('designFiles.expandGroup')
              : t('designFiles.collapseGroup')}
            onClick={() => setProgressCollapsed((collapsed) => !collapsed)}
          >
            <span className={styles.taskProgressTitle}>{t('flow.title')}</span>
            <span className={round?.live ? styles.taskProgressLive : styles.taskProgressStatus}>
              {round?.live ? (
                <>
                  <span className={styles.liveDot} aria-hidden />
                  {t('task.computer.live')}
                </>
              ) : round?.status === 'failed' ? (
                t('task.status.failed')
              ) : round?.status === 'canceled' ? (
                t('task.status.stopped')
              ) : (
                t('task.status.completed')
              )}
            </span>
            <span className={styles.taskProgressCount}>
              {t('flow.stepOf', { current: index + 1, total })}
            </span>
            <span
              className={styles.taskProgressChevron}
              data-collapsed={progressCollapsed}
              aria-hidden
            >
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          <div
            className={`accordion-collapsible ${styles.taskProgressBody}${progressCollapsed ? '' : ' open'}`}
            data-transition-state={progressCollapsed ? 'collapsed' : 'expanded'}
          >
            <div className="accordion-collapsible-inner">
              <ComputerTaskProgress
                steps={steps}
                activeStepId={active?.step.id}
                onSelectStep={(stepId) => {
                  const nextIndex = steps.findIndex(({ step }) => step.id === stepId);
                  setSelectedStepId(nextIndex >= total - 1 ? null : stepId);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ComputerTaskProgress({
  steps,
  activeStepId,
  onSelectStep,
}: {
  steps: ComputerStep[];
  activeStepId?: string;
  onSelectStep: (stepId: string) => void;
}) {
  const t = useT();
  return (
    <ol className={styles.taskProgressList} data-testid="od-computer-task-steps">
      {steps.map(({ step }) => (
        <li key={step.id} data-status={step.status} data-active={step.id === activeStepId}>
          <button type="button" onClick={() => onSelectStep(step.id)}>
            <StepStatusIcon status={step.status} />
            <span>{taskStepBrief(step, t)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function StepBody({
  computer,
  live,
  projectId,
  projectKind,
  projectFiles,
  filesRefreshKey,
  projectFileNames,
  onRequestOpenFile,
}: {
  computer: ComputerStep;
  live: boolean;
  projectId?: string | null;
  projectKind?: TrackingProjectKind | null;
  projectFiles: ProjectFile[];
  filesRefreshKey: number;
  projectFileNames?: Set<string>;
  onRequestOpenFile?: (name: string) => void;
}) {
  const t = useT();
  const { step, use, result } = computer;
  const artifactFile = findArtifactFile(projectFiles, step.artifact?.title ?? step.target);
  if (
    artifactFile
    && projectId
    && projectKind
    && (computer.contentKind === 'artifact' || computer.contentKind === 'plan')
  ) {
    return (
      <div className={styles.artifactViewer} data-testid="od-computer-artifact-viewer">
        <FileViewer
          projectId={projectId}
          projectKind={projectKind}
          file={artifactFile}
          filesRefreshKey={filesRefreshKey}
          isDeck={artifactFile.kind === 'presentation'}
          streaming={live && step.status === 'running'}
        />
      </div>
    );
  }
  if (use) {
    return (
      <div className={styles.toolWrap}>
        <ToolCard
          use={use}
          result={result}
          runStreaming={live && step.status === 'running'}
          runSucceeded={step.status === 'done'}
          projectFileNames={projectFileNames}
          onRequestOpenFile={onRequestOpenFile}
        />
      </div>
    );
  }
  if (step.kind === 'thinking') {
    return <div className={styles.thinking}>{step.target}</div>;
  }
  if (step.kind === 'generate' && step.target) {
    const name = step.target;
    return (
      <button
        type="button"
        className={styles.artifact}
        onClick={() => onRequestOpenFile?.(name)}
        disabled={!onRequestOpenFile}
      >
        <span className={styles.artifactGlyph} aria-hidden>
          <Icon name="file" size={15} />
        </span>
        <span className={styles.artifactName}>{name}</span>
        <span className={styles.artifactOpen}>{t('task.deliverable.open')}</span>
      </button>
    );
  }
  return <div className={styles.generic}>{taskStepBrief(step, t)}</div>;
}

function StepStatusIcon({ status }: { status: TaskStep['status'] }) {
  return (
    <span className={styles.taskProgressMarker} data-status={status} aria-hidden>
      <Icon
        name={status === 'done' ? 'check' : status === 'error' ? 'close' : 'spinner'}
        size={13}
      />
    </span>
  );
}

function findArtifactFile(files: ProjectFile[], raw: string | undefined): ProjectFile | undefined {
  if (!raw) return undefined;
  const target = raw.replace(/^\.\//, '').replace(/\\/g, '/');
  return files.find((file) => {
    const name = (file.path || file.name).replace(/^\.\//, '').replace(/\\/g, '/');
    return name === target || name.endsWith(`/${target}`) || target.endsWith(`/${name}`);
  });
}
