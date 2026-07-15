// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComputerWorkspaceShell } from '../../src/components/ComputerWorkspaceShell';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderShell(overrides: Partial<React.ComponentProps<typeof ComputerWorkspaceShell>> = {}) {
  const onToggleFocus = vi.fn();
  const onClose = vi.fn();
  const shell = (nextOverrides: Partial<React.ComponentProps<typeof ComputerWorkspaceShell>> = {}) => (
    <ComputerWorkspaceShell
      open
      focused={false}
      title="Computer"
      detail="Live · Design files"
      expandLabel="Full screen"
      restoreLabel="Side view"
      closeLabel="Close Computer"
      onToggleFocus={onToggleFocus}
      onClose={onClose}
      {...overrides}
      {...nextOverrides}
    >
      <div data-testid="computer-inner-view">Design files</div>
    </ComputerWorkspaceShell>
  );
  const rendered = render(shell());
  return {
    ...rendered,
    onToggleFocus,
    onClose,
    rerenderShell: (nextOverrides: Partial<React.ComponentProps<typeof ComputerWorkspaceShell>>) => {
      rendered.rerender(shell(nextOverrides));
    },
  };
}

describe('ComputerWorkspaceShell', () => {
  it('owns the complete right-hand workspace and preserves its mounted children when closed', () => {
    renderShell({ open: false });

    const shell = screen.getByTestId('computer-workspace-shell');
    expect(shell.hidden).toBe(true);
    expect(screen.getByTestId('computer-inner-view')).toBeTruthy();
  });

  it('opens the workspace in a modal and keeps its mounted content', () => {
    const { onToggleFocus } = renderShell({ focused: true });

    expect(screen.getByRole('dialog', { name: 'Computer' })).toBeTruthy();
    expect(screen.getByTestId('computer-inner-view')).toBeTruthy();

    fireEvent.click(screen.getByTestId('computer-workspace-backdrop'));

    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });

  it('supports opening the modal and closing back to the conversation', () => {
    const { onToggleFocus, onClose } = renderShell();

    fireEvent.click(screen.getByTestId('computer-workspace-focus-toggle'));
    fireEvent.click(screen.getByTestId('computer-workspace-close'));

    expect(onToggleFocus).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a consistent readable size for Computer header icons', () => {
    renderShell();

    const icons = screen.getByTestId('computer-workspace-shell').querySelectorAll('header svg');
    expect(Array.from(icons, (icon) => icon.getAttribute('width'))).toEqual(['18', '18', '18']);
  });

  it('announces the restore action while the Computer modal is open', () => {
    const { onToggleFocus } = renderShell({ focused: true });

    const toggle = screen.getByTestId('computer-workspace-focus-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Side view');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });

  it('animates the mounted workspace between its side and modal bounds', () => {
    const sideRect = DOMRect.fromRect({ x: 640, y: 0, width: 640, height: 720 });
    const modalRect = DOMRect.fromRect({ x: 96, y: 50, width: 1088, height: 620 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      return this.closest('[data-focused]')?.getAttribute('data-focused') === 'true'
        ? modalRect
        : sideRect;
    });
    const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    const animate = vi.fn(() => animation);
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });

    const { rerenderShell } = renderShell();
    rerenderShell({ focused: true });

    expect(animate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          transform: expect.stringContaining('translate(544px, -50px)'),
        }),
        expect.objectContaining({ transform: 'translate(0, 0) scale(1, 1)' }),
      ]),
      expect.objectContaining({
        duration: 240,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }),
    );
  });

  it('does not transform mounted preview layers when entering the modal', () => {
    const sideRect = DOMRect.fromRect({ x: 640, y: 0, width: 640, height: 720 });
    const modalRect = DOMRect.fromRect({ x: 96, y: 50, width: 1088, height: 620 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      return this.closest('[data-focused]')?.getAttribute('data-focused') === 'true'
        ? modalRect
        : sideRect;
    });
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);

    const props = {
      open: true,
      focused: false,
      title: 'Computer',
      detail: 'Live preview',
      expandLabel: 'Full screen',
      restoreLabel: 'Side view',
      closeLabel: 'Close Computer',
      onToggleFocus: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <ComputerWorkspaceShell {...props}>
        <iframe title="Artifact preview" />
      </ComputerWorkspaceShell>,
    );

    rerender(
      <ComputerWorkspaceShell {...props} focused>
        <iframe title="Artifact preview" />
      </ComputerWorkspaceShell>,
    );

    expect(animate).not.toHaveBeenCalled();
    expect(offsetHeight).toHaveBeenCalled();
    expect(document.body.style.display).toBe('');
    expect(screen.getByTitle('Artifact preview')).toBeTruthy();
  });

  it('keeps the closing side workspace mounted until its exit transition finishes', () => {
    vi.useFakeTimers();
    const { rerenderShell } = renderShell();

    rerenderShell({ open: false });

    const shell = screen.getByTestId('computer-workspace-shell');
    expect(shell.hidden).toBe(false);
    expect(shell.getAttribute('data-open')).toBe('false');

    act(() => vi.advanceTimersByTime(140));

    expect(shell.hidden).toBe(true);
  });
});
