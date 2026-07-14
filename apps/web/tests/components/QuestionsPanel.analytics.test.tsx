// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuestionForm } from '../../src/artifacts/question-form';
import { QuestionsPanel } from '../../src/components/QuestionsPanel';

const track = vi.fn();

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track }),
}));

const form: QuestionForm = {
  id: 'deck-brief',
  title: 'Deck brief',
  questions: [
    {
      id: 'audience',
      label: 'Audience',
      type: 'radio',
      options: [
        { label: 'Executives', value: 'executives' },
        { label: 'Investors', value: 'investors' },
      ],
      defaultValue: 'executives',
    },
  ],
};

afterEach(() => {
  cleanup();
  track.mockReset();
  vi.useRealTimers();
});

describe('QuestionsPanel staged-flow analytics', () => {
  it('reports the one-click recommended-default path once', () => {
    vi.useFakeTimers();
    render(
      <QuestionsPanel
        projectId={'project-1'}
        form={form}
        formKey={'conversation-1:message-1:deck-brief'}
        interactive={true}
        generating={false}
        flowTrackingContext={{
          conversationId: 'conversation-1',
          shape: 'deck',
          researchMode: 'deep',
          activeStage: 'clarify',
          firstInputAt: Date.now() - 1_000,
        }}
        onSubmit={() => undefined}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(280);
    });

    fireEvent.click(screen.getByTestId('questions-recommended-start'));

    expect(track).toHaveBeenCalledWith(
      'flow_defaults_used',
      expect.objectContaining({
        page_name: 'chat_panel',
        area: 'questions_form',
        project_id: 'project-1',
        conversation_id: 'conversation-1',
        flow_shape: 'deck',
        form_id: 'deck_brief',
        used_defaults: true,
        submission_mode: 'recommended',
        answered_count: 1,
        skipped_count: 0,
      }),
      undefined,
    );
  });
});
