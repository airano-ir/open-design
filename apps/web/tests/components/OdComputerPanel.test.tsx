// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import { OdComputerPanel } from '../../src/components/OdComputerPanel';
import { deriveTaskRound } from '../../src/runtime/task-steps';

afterEach(cleanup);

const threeSteps: PersistedAgentEvent[] = [
  { kind: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'agent replay' } },
  { kind: 'tool_result', toolUseId: 't1', content: 'results', isError: false },
  { kind: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://example.com/notes' } },
  { kind: 'tool_result', toolUseId: 't2', content: 'body', isError: false },
  { kind: 'tool_use', id: 't3', name: 'Write', input: { file_path: 'deck.html' } },
  { kind: 'tool_result', toolUseId: 't3', content: 'ok', isError: false },
];

function round(events: PersistedAgentEvent[], live = false) {
  return deriveTaskRound({
    id: 'a1',
    role: 'assistant',
    runId: 'run-1',
    runStatus: live ? 'running' : 'succeeded',
    events,
  });
}

describe('OdComputerPanel', () => {
  it('keeps the replay canvas quiet when there is no valuable content', () => {
    render(<OdComputerPanel round={round([])} variant="side" />);
    expect(screen.getByTestId('od-computer-body').textContent).toBe('');
    expect(screen.queryByTestId('od-computer-scrubber')).toBeNull();
    expect(screen.queryByTestId('od-computer-task-summary')).toBeNull();
  });

  it('uses one readable size for the Computer panel header icons', () => {
    render(
      <OdComputerPanel
        round={round([])}
        variant="side"
        onToggleView={() => undefined}
        onClose={() => undefined}
      />,
    );

    const icons = screen.getByTestId('od-computer-panel').querySelectorAll('header svg');
    expect(Array.from(icons, (icon) => icon.getAttribute('width'))).toEqual(['18', '18', '18']);
  });

  it('follows live: the newest step is selected and the Live indicator shows', () => {
    render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);
    // Newest step (Write deck.html) drives the header status line.
    expect(screen.getByTestId('od-computer-status').textContent).toContain('deck.html');
    expect(screen.getByTestId('od-computer-live')).toBeTruthy();
  });

  it('scrubs to a past step and offers Jump to live', () => {
    render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);
    const scrubber = screen.getByTestId('od-computer-scrubber') as HTMLInputElement;

    fireEvent.change(scrubber, { target: { value: '0' } });

    // Now inspecting the first step (search) — no longer following live.
    expect(screen.getByTestId('od-computer-status').textContent).toContain('agent replay');
    expect(screen.queryByTestId('od-computer-live')).toBeNull();
    const jump = screen.getByTestId('od-computer-jump-live');

    fireEvent.click(jump);

    // Back to following the newest step.
    expect(screen.getByTestId('od-computer-status').textContent).toContain('deck.html');
    expect(screen.getByTestId('od-computer-live')).toBeTruthy();
  });

  it('steps forward and backward through the timeline', () => {
    render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);
    expect(screen.getByTestId('od-computer-step-transition').getAttribute('data-direction')).toBe('forward');
    // Start following (newest = step 3). Prev → step 2 (opened result).
    fireEvent.click(screen.getByLabelText('Previous step'));
    expect(screen.getByTestId('od-computer-status').textContent).toContain('example.com/notes');
    expect(screen.getByTestId('od-computer-step-transition').getAttribute('data-direction')).toBe('backward');
    // Next → back to newest (Write deck.html), re-following live.
    fireEvent.click(screen.getByLabelText('Next step'));
    expect(screen.getByTestId('od-computer-status').textContent).toContain('deck.html');
    expect(screen.getByTestId('od-computer-step-transition').getAttribute('data-direction')).toBe('forward');
    expect(screen.getByTestId('od-computer-live')).toBeTruthy();
  });

  it('keeps a manually selected history step when new live events append', () => {
    const { rerender } = render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);
    fireEvent.change(screen.getByTestId('od-computer-scrubber'), { target: { value: '0' } });
    expect(screen.getByTestId('od-computer-status').textContent).toContain('agent replay');

    rerender(
      <OdComputerPanel
        round={round([
          ...threeSteps,
          { kind: 'tool_use', id: 't4', name: 'WebSearch', input: { query: 'new inspiration' } },
          { kind: 'tool_result', toolUseId: 't4', content: 'new results', isError: false },
        ], true)}
        variant="side"
      />,
    );

    expect(screen.getByTestId('od-computer-status').textContent).toContain('agent replay');
    expect(screen.getByTestId('od-computer-jump-live')).toBeTruthy();

    fireEvent.click(screen.getByTestId('od-computer-jump-live'));
    expect(screen.getByTestId('od-computer-status').textContent).toContain('new inspiration');
    expect(screen.getByTestId('od-computer-live')).toBeTruthy();
  });

  it('locks a step selected from Task progress until the user returns to live', () => {
    const { rerender } = render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);
    fireEvent.click(screen.getByRole('button', { name: /Searched.*agent replay/i }));
    expect(screen.getByTestId('od-computer-status').textContent).toContain('agent replay');
    expect(screen.getByTestId('od-computer-task-summary').textContent).toContain('Step 1 of 3');

    rerender(
      <OdComputerPanel
        round={round([
          ...threeSteps,
          { kind: 'tool_use', id: 't4', name: 'WebSearch', input: { query: 'appended value' } },
          { kind: 'tool_result', toolUseId: 't4', content: 'new results', isError: false },
        ], true)}
        variant="side"
      />,
    );

    expect(screen.getByTestId('od-computer-status').textContent).toContain('agent replay');
    expect(screen.getByTestId('od-computer-task-summary').textContent).toContain('Step 1 of 4');
    expect(screen.getByTestId('od-computer-jump-live')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Searched.*appended value/i }));
    expect(screen.getByTestId('od-computer-status').textContent).toContain('appended value');
    expect(screen.getByTestId('od-computer-live')).toBeTruthy();
  });

  it('expands and collapses the task progress list below the timeline', () => {
    render(<OdComputerPanel round={round(threeSteps, true)} variant="side" />);

    expect(screen.getByTestId('od-computer-task-steps')).toBeTruthy();
    expect(screen.getByTestId('od-computer-task-summary').querySelector('[data-transition-state="expanded"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.getByTestId('od-computer-task-summary').getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByTestId('od-computer-task-summary').querySelector('[data-transition-state="collapsed"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByTestId('od-computer-task-summary').getAttribute('data-collapsed')).toBe('false');
  });

  it('keeps TodoWrite snapshots out of the Computer timeline and progress list', () => {
    const todoContent = 'Polish the task progress alignment';
    render(
      <OdComputerPanel
        round={round([
          {
            kind: 'tool_use',
            id: 'todo-1',
            name: 'TodoWrite',
            input: { todos: [{ content: todoContent, status: 'in_progress' }] },
          },
          { kind: 'tool_result', toolUseId: 'todo-1', content: 'ok', isError: false },
          { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'DESIGN.md' } },
          { kind: 'tool_result', toolUseId: 'read-1', content: 'tokens', isError: false },
          { kind: 'tool_use', id: 'search-1', name: 'WebSearch', input: { query: 'design system' } },
          { kind: 'tool_result', toolUseId: 'search-1', content: 'results', isError: false },
        ], true)}
        variant="side"
      />,
    );

    expect(screen.getByTestId('od-computer-status').textContent).toContain('design system');
    expect(screen.getByTestId('od-computer-panel').textContent).not.toContain(todoContent);
    expect(screen.getByTestId('od-computer-panel').textContent).not.toContain('DESIGN.md');
    expect(screen.queryByTestId('od-computer-task-todos')).toBeNull();
    expect(screen.getByTestId('od-computer-task-steps').querySelectorAll('li')).toHaveLength(1);
  });

  it('does not turn loading or operational events into replay frames', () => {
    render(
      <OdComputerPanel
        round={round([
          { kind: 'tool_use', id: 'loading-search', name: 'WebSearch', input: { query: 'not ready yet' } },
          { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'DESIGN.md' } },
          { kind: 'tool_result', toolUseId: 'read-1', content: 'tokens', isError: false },
          { kind: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pnpm typecheck' } },
          { kind: 'tool_result', toolUseId: 'bash-1', content: 'done', isError: false },
          { kind: 'thinking', text: 'Working through the implementation' },
        ], true)}
        variant="side"
      />,
    );

    expect(screen.queryByTestId('od-computer-task-steps')).toBeNull();
    expect(screen.getByTestId('od-computer-panel').textContent).not.toContain('not ready yet');
    expect(screen.getByTestId('od-computer-panel').textContent).not.toContain('DESIGN.md');
    expect(screen.getByTestId('od-computer-panel').textContent).not.toContain('pnpm typecheck');
  });
});
