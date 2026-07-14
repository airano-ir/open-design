/**
 * @module analytics/events/staged-flow
 * North-star staged-flow funnel and hard-delivery event contracts.
 */
import type {
  FlowDeliverAction,
  FlowResearchMode,
  FlowShapeId,
  FlowStageId,
  FlowStageState,
} from '../../api/flow.js';
import type { TrackingArtifactKind, TrackingResult } from './shared-enums.js';

interface StagedFlowContext {
  project_id: string;
  conversation_id: string;
  flow_shape: FlowShapeId;
  research_mode: FlowResearchMode;
  ms_from_first_input?: number;
}

export interface FlowStageTransitionProps extends StagedFlowContext {
  page_name: 'chat_panel';
  area: 'staged_flow';
  stage: FlowStageId;
  state: Exclude<FlowStageState, 'pending'>;
  previous_state: FlowStageState;
  stage_index: number;
  stage_count: number;
  progress_done?: number;
  progress_total?: number;
}

export interface FlowDefaultsUsedProps extends StagedFlowContext {
  page_name: 'chat_panel';
  area: 'questions_form';
  form_id: string;
  used_defaults: boolean;
  submission_mode: 'recommended' | 'adjusted' | 'skipped' | 'countdown';
  answered_count: number;
  skipped_count: number;
}

export interface InspireChoiceProps extends StagedFlowContext {
  page_name: 'chat_panel';
  area: 'inspiration';
  picked_template_id: string | null;
  rank: number | null;
  skipped: boolean;
  result: TrackingResult;
  error_code?: string;
}

export interface HardDeliveryProps extends StagedFlowContext {
  page_name: 'artifact';
  area: 'staged_flow_delivery';
  kind: FlowDeliverAction;
  artifact_id: string;
  artifact_kind: TrackingArtifactKind;
  source: 'artifact_export' | 'artifact_deploy' | 'social_share';
}
