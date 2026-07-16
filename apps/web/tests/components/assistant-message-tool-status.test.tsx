// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { AgentEvent, ChatMessage } from '../../src/types';

function messageWithEvents(events: AgentEvent[]): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    events,
    startedAt: 1_000,
    endedAt: 3_000,
    runStatus: 'succeeded',
  };
}

describe('AssistantMessage tool status', () => {
  afterEach(() => cleanup());

  it('shows Done for a completed run tool use that has no tool result', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pnpm guard', description: 'Run guard' },
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity.textContent).toContain('Done');
    expect(activity.getAttribute('data-run-state')).toBe('completed');
    expect(activity.querySelector('.task-activity-status.op-status-ok')).not.toBeNull();
    expect(container.querySelector('[data-tool-category="terminal"]')).not.toBeNull();
    expect(container.querySelector('.op-status-error')).toBeNull();
  });

  it('keeps legacy completed messages without runStatus as Done', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: undefined,
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(screen.getByTestId('task-activity-toggle').textContent).toContain('Done');
    expect(container.querySelector('[data-tool-category="terminal"]')).not.toBeNull();
    expect(container.querySelector('.op-status-error')).toBeNull();
  });

  it('shows Done in a grouped completed run when tool results are missing', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pnpm guard', description: 'Execute guard' },
          },
          {
            kind: 'tool_use',
            id: 'tool-2',
            name: 'Bash',
            input: { command: 'pnpm typecheck', description: 'Execute typecheck' },
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(container.querySelector('.action-card-toggle.running')).toBeNull();
    expect(screen.getByTestId('task-activity-toggle').textContent).toContain('Done');
    expect(container.querySelectorAll('[data-tool-category="terminal"]')).toHaveLength(2);
  });

  it('does not group duplicate tool_use records with the same id', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Write',
            input: { file_path: '/repo/index.html', content: '<main />' },
          },
          {
            kind: 'tool_use',
            id: 'tool-1',
            name: 'Write',
            input: { file_path: '/repo/index.html', content: '<main />' },
          },
          {
            kind: 'tool_result',
            toolUseId: 'tool-1',
            content: 'ok',
            isError: false,
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity).toBeTruthy();
    expect(activity.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(activity);
    expect(activity.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('.op-card.op-file')).toHaveLength(1);
    expect(container.querySelector('[data-testid="file-ops-toggle"]')?.textContent).toContain('Write 1');
    expect(container.textContent).not.toContain('×2');
  });

  it('keeps read-only files in execution history instead of labeling them as output', () => {
    render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(screen.getByTestId('task-activity-toggle')).toBeTruthy();
    expect(screen.queryByTestId('file-ops-summary')).toBeNull();
  });

  it('collapses mixed tool families into one execution record', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
          { kind: 'tool_use', id: 'tool-2', name: 'Write', input: { file_path: '/repo/result.ts', content: 'export {}' } },
          { kind: 'tool_result', toolUseId: 'tool-2', content: 'ok', isError: false },
          { kind: 'tool_use', id: 'tool-3', name: 'Bash', input: { command: 'pnpm typecheck' } },
          { kind: 'tool_result', toolUseId: 'tool-3', content: 'ok', isError: false },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity).toBeTruthy();
    expect(activity.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(activity);
    expect(activity.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('.op-card')).toHaveLength(3);
    expect(container.querySelector('[data-tool-category="eye"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-category="file-code"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-category="terminal"]')).not.toBeNull();
  });

  it('does not show Done when a failed run is missing a tool result', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: 'failed',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity.textContent).toContain('error');
    expect(activity.getAttribute('data-run-state')).toBe('error');
    expect(activity.querySelector('.task-activity-status.op-status-error')).not.toBeNull();
    expect(container.querySelector('.op-status-error')).not.toBeNull();
    expect(container.querySelector('.op-status-ok')).toBeNull();
  });

  it('does not show Done when a canceled run is missing a tool result', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Execute guard' },
            },
          ]),
          runStatus: 'canceled',
        }}
        streaming={false}
        projectId="project-1"
      />,
    );

    expect(screen.getByTestId('task-activity-toggle').textContent).toContain('error');
    expect(container.querySelector('.op-status-error')).not.toBeNull();
    expect(container.querySelector('.op-status-ok')).toBeNull();
  });

  it('keeps Running for a streaming tool use that has no tool result', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={{
          ...messageWithEvents([
            {
              kind: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pnpm guard', description: 'Run guard' },
            },
          ]),
          endedAt: undefined,
          runStatus: 'running',
        }}
        streaming
        projectId="project-1"
      />,
    );

    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity.textContent).toContain('Working');
    expect(activity.getAttribute('data-run-state')).toBe('running');
    expect(activity.querySelector('.task-activity-status.op-status-running')).not.toBeNull();
    expect(container.querySelector('[data-tool-category="terminal"].op-status-running')).not.toBeNull();
    expect(container.querySelector('.op-status-ok')).toBeNull();
  });

  it('keeps the run state above the answer and groups thinking into the timeline', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          { kind: 'thinking', text: 'Reviewing the request.' },
          { kind: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
          { kind: 'tool_result', toolUseId: 'tool-1', content: 'source', isError: false },
          { kind: 'text', text: 'Here is the finished answer.' },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const flow = container.querySelector('.assistant-flow');
    const activity = screen.getByTestId('task-activity-toggle');
    expect(flow?.firstElementChild?.classList.contains('task-activity')).toBe(true);
    expect(activity.textContent).toContain('Done');
    expect(flow?.textContent).toContain('Here is the finished answer.');

    fireEvent.click(activity);
    const activityCard = activity.closest('.task-activity');
    expect(activityCard?.querySelector('.thinking-block')).not.toBeNull();
    expect(activityCard?.querySelector('[data-tool-category="eye"]')).not.toBeNull();
  });

  it('renders URLs in JSON-like status details without trailing structural characters', () => {
    const { container } = render(
      <AssistantMessage
        projectKind="prototype"
        conversationId="conv-1"
        message={messageWithEvents([
          {
            kind: 'status',
            label: 'publish repo',
            detail: '{"url":"https://github.com/nexu-io/example-plugin","nameWithOwner":"nexu-io/example-plugin"}',
          },
        ])}
        streaming={false}
        projectId="project-1"
      />,
    );

    const link = container.querySelector('.status-detail a.md-link');
    expect(link?.getAttribute('href')).toBe('https://github.com/nexu-io/example-plugin');
    expect(link?.textContent).toBe('https://github.com/nexu-io/example-plugin');
    expect(container.querySelector('.status-detail')?.textContent).toContain('"}');
  });
});
