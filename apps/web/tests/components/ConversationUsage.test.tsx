// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationUsage,
  summarizeConversationUsage,
} from '../../src/components/ConversationUsage';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

function assistant(
  id: string,
  events: NonNullable<ChatMessage['events']>,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'Done',
    runStatus: 'succeeded',
    events,
    ...overrides,
  };
}

describe('ConversationUsage', () => {
  it('adds the latest usage snapshot from every assistant round', () => {
    const summary = summarizeConversationUsage([
      { id: 'user-1', role: 'user', content: 'Start' },
      assistant('assistant-1', [
        { kind: 'usage', inputTokens: 20, outputTokens: 10, costUsd: 0.01, durationMs: 1_000 },
        { kind: 'usage', inputTokens: 1_000, outputTokens: 500, costUsd: 0.25, durationMs: 60_000 },
      ]),
      assistant('assistant-2', [
        { kind: 'usage', inputTokens: 2_000, outputTokens: 0, costUsd: 1, durationMs: 30_000 },
      ]),
    ]);

    expect(summary).toMatchObject({
      rounds: 2,
      inputTokens: 3_000,
      outputTokens: 500,
      totalTokens: 3_500,
      costUsd: 1.25,
      durationMs: 90_000,
      hasInputTokens: true,
      hasOutputTokens: true,
      hasCost: true,
      hasDuration: true,
    });
  });

  it('falls back to persisted run timestamps when a round has no duration usage event', () => {
    const summary = summarizeConversationUsage([
      assistant('assistant-1', [], { startedAt: 1_000, endedAt: 6_000 }),
    ], 10_000);

    expect(summary.durationMs).toBe(5_000);
    expect(summary.hasDuration).toBe(true);
  });

  it('opens a header popover with the accumulated token, cost, time, and round totals', () => {
    render(
      <ConversationUsage
        streaming={false}
        messages={[
          assistant('assistant-1', [
            { kind: 'usage', inputTokens: 1_000, outputTokens: 500, costUsd: 0.25, durationMs: 60_000 },
          ]),
          assistant('assistant-2', [
            { kind: 'usage', inputTokens: 2_000, outputTokens: 0, costUsd: 1, durationMs: 30_000 },
          ]),
        ]}
      />,
    );

    expect(screen.queryByTestId('conversation-usage-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('conversation-usage-trigger'));

    const popover = screen.getByTestId('conversation-usage-popover');
    expect(popover.textContent).toContain('chat.usage.title');
    expect(popover.textContent).toContain('3,500');
    expect(popover.textContent).toContain('1m 30s');
    expect(popover.textContent).toContain('$1.2500');
    expect(popover.textContent).toContain('2');
  });
});
