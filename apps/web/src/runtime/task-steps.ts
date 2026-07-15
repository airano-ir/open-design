import {
  deriveTaskSteps,
  taskStepComputerContentKind,
  type PersistedAgentEvent,
  type TaskStep,
  type TaskStepComputerContentKind,
  type TaskStepKind,
} from '@open-design/contracts';
import type { Dict } from '../i18n/types';

export type { TaskStep, TaskStepKind };
export { deriveTaskSteps };

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type TaskRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | null;

export interface TaskRound {
  assistantMessageId: string;
  runId: string;
  /** False only while the optimistic assistant message is waiting for its daemon run id. */
  runAttached: boolean;
  events: PersistedAgentEvent[];
  steps: TaskStep[];
  status: TaskRunStatus;
  live: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface RoundSourceMessage {
  id: string;
  role: string;
  events?: PersistedAgentEvent[];
  runId?: string;
  runStatus?: TaskRunStatus;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
}

export function deriveTaskRound(
  message: RoundSourceMessage,
  options?: { streaming?: boolean },
): TaskRound | null {
  if (message.role !== 'assistant') return null;
  const events = message.events ?? [];
  const steps = deriveTaskSteps({
    events,
    startedAt: message.startedAt,
    createdAt: message.createdAt,
    endedAt: message.endedAt,
  });
  const status = message.runStatus ?? (message.endedAt != null ? 'succeeded' : null);
  const live = status === 'running' || status === 'queued' || Boolean(options?.streaming && status == null);
  return {
    assistantMessageId: message.id,
    runId: message.runId ?? message.id,
    runAttached: Boolean(message.runId),
    events,
    steps,
    status,
    live,
    ...(message.startedAt == null ? {} : { startedAt: message.startedAt }),
    ...(message.endedAt == null ? {} : { endedAt: message.endedAt }),
  };
}

export function deriveTaskRounds(messages: ReadonlyArray<RoundSourceMessage> | undefined): TaskRound[] {
  if (!messages) return [];
  return messages
    .map((message) => deriveTaskRound(message))
    .filter((round): round is TaskRound => round !== null);
}

export function deriveCurrentRound(
  messages: ReadonlyArray<RoundSourceMessage> | undefined,
  options?: { streaming?: boolean },
): TaskRound | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    return deriveTaskRound(message, options);
  }
  return null;
}

export function findTaskRound(
  messages: ReadonlyArray<RoundSourceMessage> | undefined,
  runId: string,
  options?: { streamingRunId?: string | null },
): TaskRound | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if ((message.runId ?? message.id) !== runId) continue;
    return deriveTaskRound(message, { streaming: options?.streamingRunId === runId });
  }
  return null;
}

function clip(value: string, max: number): string {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function taskStepTargetLabel(step: TaskStep, t: TranslateFn): string {
  return clip(step.title || step.target || step.tool || t('task.step.untitled'), 72);
}

export function taskStepBrief(step: TaskStep, t: TranslateFn): string {
  const target = taskStepTargetLabel(step, t);
  switch (step.kind) {
    case 'search': return t('task.step.search', { target });
    case 'search-drilldown': return t('task.step.searchDrilldown', { target });
    case 'read': return t('task.step.read', { target });
    case 'write': return t('task.step.write', { target });
    case 'edit': return t('task.step.edit', { target });
    case 'list': return t('task.step.list', { target });
    case 'command': return t('task.step.command', { target });
    case 'plan': return t('task.step.plan');
    case 'outline': return t('task.step.outline', { target });
    case 'inspiration': return t('task.step.inspiration', { target });
    case 'generate': return t('task.step.generate', { target });
    case 'thinking': return t('task.step.thinking');
    default: return t('task.step.tool', { tool: step.tool ?? target });
  }
}

const STEP_GLYPH: Record<TaskStepKind, string> = {
  plan: '◇', outline: '◇', search: '⌕', 'search-drilldown': '↳', read: '▤',
  write: '✎', edit: '✎', list: '≣', command: '›_', inspiration: '✦',
  generate: '◆', thinking: '✽', tool: '•',
};

export function taskStepGlyph(kind: TaskStepKind): string {
  return STEP_GLYPH[kind] ?? '•';
}

export interface ComputerStep {
  step: TaskStep;
  contentKind: TaskStepComputerContentKind;
  use?: NonNullable<TaskStep['toolUse']>;
  result?: NonNullable<TaskStep['toolResult']>;
}

/**
 * Computer is a presentation surface, not an event log. Only content that is
 * useful to watch or revisit belongs in its timeline; operational state stays
 * in the pinned Task progress card and in telemetry.
 */
export function computerStepsFromRound(round: TaskRound | null | undefined): ComputerStep[] {
  if (!round) return [];
  return computerSteps(round.steps);
}

/** Backwards-compatible helper for isolated tests/renderers with only events. */
export function computerStepsFromEvents(events: readonly PersistedAgentEvent[] | undefined): ComputerStep[] {
  if (!events) return [];
  return computerSteps(deriveTaskSteps(events));
}

function computerSteps(steps: readonly TaskStep[]): ComputerStep[] {
  return steps.flatMap((step) => {
    const contentKind = taskStepComputerContentKind(step);
    if (!contentKind) return [];
    return [{
      step,
      contentKind,
      ...(step.toolUse ? { use: step.toolUse } : {}),
      ...(step.toolResult ? { result: step.toolResult } : {}),
    }];
  });
}
