// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFlowMarker, createFlowSnapshot } from '@open-design/contracts';
import { PinnedTaskProgress } from '../../src/components/PinnedTaskProgress';
import type { TaskRound } from '../../src/runtime/task-steps';

afterEach(cleanup);

function clarifyActiveDeck() {
  let flow = createFlowSnapshot('deck', { now: 1 });
  flow = applyFlowMarker(flow, { stage: 'clarify', state: 'active' }, 1);
  return flow;
}

function round(status: TaskRound['status'] = 'running', startedAt?: number): TaskRound {
  return {
    assistantMessageId: 'a1',
    runId: 'run-1',
    runAttached: true,
    events: [],
    steps: [{ id: 's1', kind: 'plan', status: status === 'running' ? 'running' : 'done', brief: 'Task plan', title: 'Task plan', ts: 1 }],
    status,
    live: status === 'running',
    ...(startedAt === undefined ? {} : { startedAt }),
  };
}

describe('PinnedTaskProgress', () => {
  it('renders the current-round flow ladder with a Live pill while running', () => {
    render(<PinnedTaskProgress flow={clarifyActiveDeck()} round={round()} live />);

    const pinned = screen.getByTestId('pinned-task-progress');
    // The flow ladder lives inside the pinned card (headless FlowProgressCard).
    expect(pinned.contains(screen.getByTestId('flow-progress-card'))).toBe(true);
    // The composer copy starts as a compact one-line summary.
    expect(screen.getAllByText('Brief & questions')).toHaveLength(2);
    expect(screen.queryByTestId('pinned-task-live')).toBeNull();
    expect(screen.queryByTestId('pinned-task-status')).toBeNull();
  });

  it('shows a terminal status badge once the round has ended', () => {
    let flow = createFlowSnapshot('deck', { now: 1 });
    flow = applyFlowMarker(flow, { stage: 'deliver', state: 'active' }, 1);

    render(<PinnedTaskProgress flow={flow} round={round('succeeded')} live={false} status="succeeded" />);

    expect(screen.queryByTestId('pinned-task-status')).toBeNull();
    expect(screen.queryByTestId('pinned-task-live')).toBeNull();
    expect(within(screen.getByRole('button', { name: 'Expand' })).getByText('Implement')).toBeTruthy();
  });

  it('shows Needs input instead of completed while a staged flow awaits the user', () => {
    render(
      <PinnedTaskProgress
        flow={clarifyActiveDeck()}
        round={round('succeeded')}
        live={false}
        status="succeeded"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByTestId('pinned-task-status').textContent).toContain('Needs input');
    expect(screen.queryByText('Task completed')).toBeNull();
  });

  it('toggles between the expanded ladder and the collapsed single row', () => {
    render(<PinnedTaskProgress flow={clarifyActiveDeck()} round={round()} live />);
    const pinned = screen.getByTestId('pinned-task-progress');

    // Compact by default; details expand upward on demand.
    expect(pinned.querySelector('.accordion-collapsible.open')).toBeNull();
    expect(pinned.querySelector('[data-transition-state="collapsed"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(pinned.querySelector('.accordion-collapsible.open')).toBeTruthy();
    expect(pinned.querySelector('[data-transition-state="expanded"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy();
  });

  it('returns to the compact summary when a new live round starts', () => {
    const { rerender } = render(
      <PinnedTaskProgress flow={clarifyActiveDeck()} round={round('succeeded')} live={false} status="succeeded" />,
    );
    expect(screen.getByTestId('pinned-task-progress').querySelector('.accordion-collapsible.open')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByTestId('pinned-task-progress').querySelector('.accordion-collapsible.open')).toBeTruthy();

    rerender(
      <PinnedTaskProgress
        flow={clarifyActiveDeck()}
        round={{ ...round(), runId: 'run-2' }}
        live
        status="running"
      />,
    );

    expect(screen.getByTestId('pinned-task-progress').querySelector('.accordion-collapsible.open')).toBeNull();
  });

  it('exposes a Computer entry only when a handler is provided', () => {
    const onOpenComputer = vi.fn();
    const { rerender } = render(<PinnedTaskProgress flow={clarifyActiveDeck()} round={round()} live />);
    expect(screen.queryByTestId('pinned-task-computer-entry')).toBeNull();

    rerender(
      <PinnedTaskProgress flow={clarifyActiveDeck()} round={round()} live onOpenComputer={onOpenComputer} />,
    );
    expect(screen.getByTestId('pinned-task-computer-preview')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pinned-task-computer-entry'));
    expect(onOpenComputer).toHaveBeenCalledTimes(1);
  });

  it('keeps the canonical five-stage flow above current-round TodoWrite details', () => {
    const flow = { ...clarifyActiveDeck(), updatedAt: 20 };
    render(
      <PinnedTaskProgress
        flow={flow}
        round={round('running', 10)}
        todoInput={{
          todos: [
            { content: 'Align task progress', status: 'completed' },
            { content: 'Polish Computer controls', status: 'in_progress', activeForm: 'Polishing Computer controls' },
          ],
        }}
        live
      />,
    );

    expect(screen.getByTestId('flow-progress-card')).toBeTruthy();
    expect(screen.getAllByText('Brief & questions')).toHaveLength(2);
    expect(screen.getByText('Research (optional)')).toBeTruthy();
    expect(screen.getByText('Outline')).toBeTruthy();
    expect(screen.getByText('Inspiration')).toBeTruthy();
    expect(screen.getByText('Implement')).toBeTruthy();
    expect(screen.queryByTestId('pinned-task-todos')).toBeNull();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('keeps TodoWrite changes for a later edit round after the staged flow ended', () => {
    const staleFlow = { ...clarifyActiveDeck(), updatedAt: 5 };
    render(
      <PinnedTaskProgress
        flow={staleFlow}
        round={round('running', 10)}
        todoInput={{
          todos: [
            { content: 'Align task progress', status: 'completed' },
            { content: 'Polish Computer controls', status: 'in_progress', activeForm: 'Polishing Computer controls' },
          ],
        }}
        live
      />,
    );

    expect(screen.getByTestId('pinned-task-todos').textContent).toContain('Align task progress');
    expect(screen.getByTestId('pinned-task-todos').textContent).toContain('Polishing Computer controls');
    expect(screen.queryByTestId('flow-progress-card')).toBeNull();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
  });
});
