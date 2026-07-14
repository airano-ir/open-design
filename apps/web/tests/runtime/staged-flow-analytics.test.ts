import { applyFlowMarker, createFlowSnapshot } from '@open-design/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildFlowStageTransitions,
  firstUserInputAt,
  msFromFirstInput,
} from '../../src/runtime/staged-flow-analytics';

describe('staged-flow analytics', () => {
  it('finds the first persisted user input and clamps elapsed time', () => {
    expect(
      firstUserInputAt([
        { id: 'assistant', role: 'assistant', content: '', createdAt: 10 },
        { id: 'user-1', role: 'user', content: 'Build a deck', createdAt: 20 },
        { id: 'user-2', role: 'user', content: 'Continue', createdAt: 30 },
      ]),
    ).toBe(20);
    expect(msFromFirstInput(20, 15)).toBe(0);
  });

  it('emits only changed non-pending stages with funnel dimensions', () => {
    const previous = applyFlowMarker(
      createFlowSnapshot('deck', {
        researchMode: 'deep',
        now: 100,
      }),
      { stage: 'clarify', state: 'active' },
      100,
    );
    let next = applyFlowMarker(
      previous,
      { stage: 'clarify', state: 'complete' },
      200,
    );
    next = applyFlowMarker(
      next,
      { stage: 'research', state: 'active', done: 1, total: 2 },
      200,
    );

    expect(
      buildFlowStageTransitions({
        previous,
        next,
        context: {
          projectId: 'project-1',
          conversationId: 'conversation-1',
          firstInputAt: 50,
        },
        now: 250,
      }),
    ).toEqual([
      expect.objectContaining({
        stage: 'clarify',
        state: 'complete',
        previous_state: 'active',
        stage_index: 1,
        stage_count: 6,
        ms_from_first_input: 200,
      }),
      expect.objectContaining({
        stage: 'research',
        state: 'active',
        previous_state: 'pending',
        progress_done: 1,
        progress_total: 2,
      }),
    ]);
  });

  it('does not report progress-only updates as stage transitions', () => {
    const previous = applyFlowMarker(
      createFlowSnapshot('deck', { now: 1 }),
      { stage: 'generate', state: 'active', done: 1, total: 10 },
      2,
    );
    const next = applyFlowMarker(
      previous,
      { stage: 'generate', state: 'active', done: 2, total: 10 },
      3,
    );

    expect(
      buildFlowStageTransitions({
        previous,
        next,
        context: {
          projectId: 'project-1',
          conversationId: 'conversation-1',
          firstInputAt: 1,
        },
        now: 3,
      }),
    ).toEqual([]);
  });
});
