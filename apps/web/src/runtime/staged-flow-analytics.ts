import {
  FLOW_STAGE_ORDER,
  type FlowSnapshot,
  type FlowStageSnapshot,
} from '@open-design/contracts';
import type { FlowStageTransitionProps } from '@open-design/contracts/analytics';

import type { ChatMessage } from '../types';

export interface StagedFlowTrackingContext {
  projectId: string;
  conversationId: string;
  firstInputAt?: number;
}

export function firstUserInputAt(messages: readonly ChatMessage[]): number | undefined {
  return messages.find(
    (message) => message.role === 'user' && typeof message.createdAt === 'number',
  )?.createdAt;
}

export function msFromFirstInput(
  firstInputAt: number | undefined,
  now = Date.now(),
): number | undefined {
  if (firstInputAt === undefined) return undefined;
  return Math.max(0, now - firstInputAt);
}

export function buildFlowStageTransitions({
  previous,
  next,
  context,
  now = Date.now(),
}: {
  previous: FlowSnapshot | null;
  next: FlowSnapshot;
  context: StagedFlowTrackingContext;
  now?: number;
}): FlowStageTransitionProps[] {
  const previousById = new Map(
    previous?.stages.map((stage) => [stage.id, stage]) ?? [],
  );
  const elapsed = msFromFirstInput(context.firstInputAt, now);

  return next.stages.flatMap((stage, index) => {
    if (stage.state === 'pending') return [];
    const previousStage = previousById.get(stage.id);
    if (previousStage?.state === stage.state) return [];
    return [
      {
        page_name: 'chat_panel',
        area: 'staged_flow',
        project_id: context.projectId,
        conversation_id: context.conversationId,
        flow_shape: next.shape,
        research_mode: next.researchMode,
        stage: stage.id,
        state: stage.state,
        previous_state: previousStage?.state ?? 'pending',
        stage_index: index + 1,
        stage_count: FLOW_STAGE_ORDER.length,
        ...(elapsed === undefined ? {} : { ms_from_first_input: elapsed }),
        ...stageProgress(stage),
      },
    ];
  });
}

function stageProgress(
  stage: FlowStageSnapshot,
): Pick<FlowStageTransitionProps, 'progress_done' | 'progress_total'> {
  if (!stage.progress) return {};
  return {
    progress_done: stage.progress.done,
    progress_total: stage.progress.total,
  };
}
