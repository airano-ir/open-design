// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolCard } from '../../src/components/ToolCard';
import { I18nProvider } from '../../src/i18n';
import type { AgentEvent } from '../../src/types';

type ToolUse = Extract<AgentEvent, { kind: 'tool_use' }>;
type ToolResult = Extract<AgentEvent, { kind: 'tool_result' }>;

function renderTool(use: ToolUse, result?: ToolResult) {
  return render(
    <I18nProvider initial="en">
      <ToolCard use={use} result={result} runStreaming={false} runSucceeded />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('ToolCard secondary result disclosures', () => {
  it('keeps grep output behind a second disclosure click', () => {
    const { container } = renderTool(
      { kind: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'TODO', path: 'src' } },
      { kind: 'tool_result', toolUseId: 'grep-1', content: 'src/app.ts:12: TODO', isError: false },
    );

    const head = container.querySelector<HTMLButtonElement>('.op-search .op-card-head');
    const disclosure = container.querySelector('.op-search .accordion-collapsible');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.classList.contains('open')).toBe(false);

    fireEvent.click(head as HTMLButtonElement);
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure?.classList.contains('open')).toBe(true);
    expect(container.textContent).toContain('src/app.ts:12: TODO');
  });

  it('keeps read contents hidden until the read row opens', () => {
    const { container } = renderTool(
      { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/source.ts' } },
      { kind: 'tool_result', toolUseId: 'read-1', content: 'export const answer = 42;', isError: false },
    );

    const head = container.querySelector<HTMLButtonElement>('.op-file .op-card-head');
    const disclosure = container.querySelector('.op-file .accordion-collapsible');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.classList.contains('open')).toBe(false);

    fireEvent.click(head as HTMLButtonElement);
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure?.classList.contains('open')).toBe(true);
    expect(container.textContent).toContain('export const answer = 42;');
  });

  it('keeps command and output behind the bash row disclosure', () => {
    const { container } = renderTool(
      { kind: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pnpm typecheck', description: 'Check types' } },
      { kind: 'tool_result', toolUseId: 'bash-1', content: 'Done', isError: false },
    );

    const head = container.querySelector<HTMLButtonElement>('.op-bash .op-card-head');
    const disclosure = container.querySelector('.op-bash .accordion-collapsible');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.classList.contains('open')).toBe(false);

    fireEvent.click(head as HTMLButtonElement);
    expect(disclosure?.classList.contains('open')).toBe(true);
    expect(container.textContent).toContain('pnpm typecheck');
    expect(container.textContent).toContain('Done');
  });
});
