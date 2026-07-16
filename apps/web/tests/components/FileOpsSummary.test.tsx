// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileOpsSummary } from '../../src/components/FileOpsSummary';
import type { FileOpEntry } from '../../src/runtime/file-ops';

function entry(partial: Partial<FileOpEntry> & { path: string }): FileOpEntry {
  return {
    fullPath: `/repo/${partial.path}`,
    ops: ['read'],
    opCounts: { read: 1, write: 0, edit: 0, delete: 0 },
    total: 1,
    status: 'done',
    ...partial,
  };
}

describe('FileOpsSummary', () => {
  afterEach(() => cleanup());

  it('renders nothing when there are no entries', () => {
    const { container } = render(
      <FileOpsSummary entries={[]} streaming={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows up to four files directly, including while the run is streaming', () => {
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'a.ts', ops: ['read'], opCounts: { read: 2, write: 0, edit: 0, delete: 0 }, total: 2 }),
          entry({ path: 'b.ts', ops: ['write'], opCounts: { read: 0, write: 1, edit: 0, delete: 0 } }),
          entry({ path: 'c.ts', ops: ['edit'], opCounts: { read: 0, write: 0, edit: 3, delete: 0 }, total: 3 }),
          entry({ path: 'gone.ts', ops: ['delete'], opCounts: { read: 0, write: 0, edit: 0, delete: 1 } }),
        ]}
        streaming
      />,
    );

    expect(screen.getByText(/Write 1/)).toBeTruthy();
    expect(screen.getByText(/Edit 3/)).toBeTruthy();
    expect(screen.getByText(/Delete 1/)).toBeTruthy();
    expect(screen.getByText(/Read 2/)).toBeTruthy();
    expect(screen.getByTestId('file-ops-row-a.ts')).toBeTruthy();
    expect(screen.getByTestId('file-ops-row-b.ts')).toBeTruthy();
    const toggle = screen.getByTestId('file-ops-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBeNull();
  });

  it('shows small completed result sets without a disclosure click', () => {
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'a.ts', ops: ['read', 'edit'], opCounts: { read: 1, write: 0, edit: 1, delete: 0 }, total: 2 }),
          entry({ path: 'b.ts', ops: ['write'], opCounts: { read: 0, write: 1, edit: 0, delete: 0 } }),
        ]}
        streaming={false}
      />,
    );

    expect(screen.getByTestId('file-ops-row-a.ts')).toBeTruthy();
    expect(screen.getByTestId('file-ops-row-b.ts')).toBeTruthy();
  });

  it('keeps a small result set visible when a streaming turn finishes', () => {
    const { rerender } = render(
      <FileOpsSummary
        entries={[entry({ path: 'a.ts' })]}
        streaming
      />,
    );
    expect(screen.getByTestId('file-ops-row-a.ts')).toBeTruthy();

    rerender(
      <FileOpsSummary
        entries={[entry({ path: 'a.ts' })]}
        streaming={false}
      />,
    );
    expect(screen.getByTestId('file-ops-row-a.ts')).toBeTruthy();
  });

  it('shows the first four files and collapses only the remaining rows', () => {
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'a.ts' }),
          entry({ path: 'b.ts' }),
          entry({ path: 'c.ts' }),
          entry({ path: 'd.ts' }),
          entry({ path: 'e.ts' }),
        ]}
        streaming={false}
      />,
    );

    const toggle = screen.getByTestId('file-ops-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('file-ops-row-a.ts')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('file-ops-row-d.ts')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('file-ops-row-e.ts')).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('file-ops-row-e.ts')).not.toHaveAttribute('hidden');
  });

  it('shows the open button only for files that are present in the project file set', () => {
    const onRequestOpenFile = vi.fn();
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'a.ts' }),
          entry({ path: 'missing.ts' }),
        ]}
        streaming={false}
        projectFileNames={new Set(['a.ts'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    expect(screen.getByTestId('file-ops-row-open-a.ts')).toBeTruthy();
    expect(screen.queryByTestId('file-ops-row-open-missing.ts')).toBeNull();

    fireEvent.click(screen.getByTestId('file-ops-row-open-a.ts'));
    expect(onRequestOpenFile).toHaveBeenCalledWith('a.ts');
  });

  it('offers one direct result entry point while a large batch is collapsed', () => {
    const onRequestOpenFile = vi.fn();
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'input.ts' }),
          entry({ path: 'result.ts', ops: ['write'], opCounts: { read: 0, write: 1, edit: 0, delete: 0 } }),
          entry({ path: 'third.ts' }),
          entry({ path: 'fourth.ts' }),
          entry({ path: 'fifth.ts' }),
        ]}
        streaming={false}
        projectFileNames={new Set(['input.ts', 'result.ts', 'third.ts', 'fourth.ts', 'fifth.ts'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    fireEvent.click(screen.getByTestId('file-ops-primary-open-result.ts'));
    expect(onRequestOpenFile).toHaveBeenCalledWith('result.ts');
    expect(screen.getByTestId('file-ops-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not show the open button for deleted files', () => {
    const onRequestOpenFile = vi.fn();
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'gone.ts', ops: ['delete'], opCounts: { read: 0, write: 0, edit: 0, delete: 1 } }),
        ]}
        streaming={false}
        projectFileNames={new Set(['gone.ts'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    expect(screen.getByTestId('file-ops-row-gone.ts')).toBeTruthy();
    expect(screen.queryByTestId('file-ops-row-open-gone.ts')).toBeNull();
  });

  it('flags a row as running when its status is running and as error when isError', () => {
    render(
      <FileOpsSummary
        entries={[
          entry({ path: 'pending.ts', status: 'running' }),
          entry({ path: 'broken.ts', status: 'error' }),
        ]}
        streaming
      />,
    );
    const pending = screen.getByTestId('file-ops-row-pending.ts');
    const broken = screen.getByTestId('file-ops-row-broken.ts');
    expect(pending.className).toContain('file-ops-row--running');
    expect(broken.className).toContain('file-ops-row--error');
  });
});
