// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';

import { OdComputerOverlay } from '../../src/components/OdComputerOverlay';
import { deriveTaskRound } from '../../src/runtime/task-steps';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const events: PersistedAgentEvent[] = [
  { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'brief.md' } },
  { kind: 'tool_result', toolUseId: 't1', content: 'brief', isError: false },
];

describe('OdComputerOverlay', () => {
  it('plays the modal exit before docking the replay back into the right workspace', () => {
    vi.useFakeTimers();
    const onDock = vi.fn();
    render(
      <OdComputerOverlay
        open
        onClose={vi.fn()}
        round={deriveTaskRound({
          id: 'a1',
          role: 'assistant',
          runId: 'run-1',
          runStatus: 'succeeded',
          events,
        })}
        onDock={onDock}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Side view' }));

    expect(screen.getByRole('dialog', { name: 'Computer' }).getAttribute('data-state')).toBe('closing');
    expect(onDock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(140));

    expect(onDock).toHaveBeenCalledWith('run-1', undefined);
  });
});
