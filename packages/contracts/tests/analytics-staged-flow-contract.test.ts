import { describe, expect, it } from 'vitest';
import type { AnalyticsEventPayload } from '../src/analytics/events.js';

describe('staged-flow analytics contract', () => {
  it('accepts the north-star funnel events', () => {
    const events = [
      {
        event: 'flow_stage_transition',
        props: {
          page_name: 'chat_panel',
          area: 'staged_flow',
          project_id: 'project-1',
          conversation_id: 'conversation-1',
          flow_shape: 'deck',
          research_mode: 'deep',
          stage: 'generate',
          state: 'complete',
          previous_state: 'active',
          stage_index: 5,
          stage_count: 6,
          progress_done: 12,
          progress_total: 12,
          ms_from_first_input: 120_000,
        },
      },
      {
        event: 'flow_defaults_used',
        props: {
          page_name: 'chat_panel',
          area: 'questions_form',
          project_id: 'project-1',
          conversation_id: 'conversation-1',
          flow_shape: 'deck',
          research_mode: 'deep',
          form_id: 'task_type',
          used_defaults: true,
          submission_mode: 'recommended',
          answered_count: 5,
          skipped_count: 0,
          ms_from_first_input: 10_000,
        },
      },
      {
        event: 'inspire_choice',
        props: {
          page_name: 'chat_panel',
          area: 'inspiration',
          project_id: 'project-1',
          conversation_id: 'conversation-1',
          flow_shape: 'deck',
          research_mode: 'deep',
          picked_template_id: 'template-1',
          rank: 1,
          skipped: false,
          result: 'success',
          ms_from_first_input: 40_000,
        },
      },
      {
        event: 'hard_delivery',
        props: {
          page_name: 'artifact',
          area: 'staged_flow_delivery',
          project_id: 'project-1',
          conversation_id: 'conversation-1',
          flow_shape: 'deck',
          research_mode: 'deep',
          kind: 'pptx',
          artifact_id: 'artifact-1',
          artifact_kind: 'html',
          source: 'artifact_export',
          ms_from_first_input: 180_000,
        },
      },
    ] satisfies AnalyticsEventPayload[];

    expect(events.map((event) => event.event)).toEqual([
      'flow_stage_transition',
      'flow_defaults_used',
      'inspire_choice',
      'hard_delivery',
    ]);
  });
});
