// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OutlinePanel,
  type OutlinePage,
} from '../../src/components/OutlinePanel';

afterEach(cleanup);

const pages: OutlinePage[] = [
  {
    id: 'opening',
    title: 'Market shift',
    bullets: ['Demand is accelerating', 'Costs are falling'],
  },
  {
    id: 'evidence',
    title: 'Supporting evidence',
    bullets: ['Adoption data'],
  },
];

describe('OutlinePanel', () => {
  it('shows the live planning handoff before the first outline file arrives', () => {
    render(
      <OutlinePanel
        pages={[]}
        onChange={vi.fn()}
        loading
        statusDetail="Writing · generated/outline.md"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Writing · generated/outline.md',
    );
    expect(screen.queryByText('Add a page to start the outline.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add page' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('emits title and key-point edits immediately', () => {
    const onChange = vi.fn();
    render(<OutlinePanel pages={pages} onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Title Page 1' }), {
      target: { value: 'A changing market' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      { ...pages[0], title: 'A changing market' },
      pages[1],
    ]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Key points Page 1' }), {
      target: { value: 'First signal\nSecond signal\nThird signal' },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      {
        ...pages[0],
        bullets: ['First signal', 'Second signal', 'Third signal'],
      },
      pages[1],
    ]);
  });

  it('appends pages and inserts between existing pages', () => {
    const onChange = vi.fn();
    render(<OutlinePanel pages={pages} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    const appended = onChange.mock.lastCall?.[0] as OutlinePage[];
    expect(appended).toHaveLength(3);
    expect(appended[2]).toMatchObject({
      id: 'outline-page-3',
      title: 'Untitled page',
      bullets: [],
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Insert page Page 1' }),
    );
    const inserted = onChange.mock.lastCall?.[0] as OutlinePage[];
    expect(inserted.map((page) => page.id)).toEqual([
      'opening',
      'outline-page-3',
      'evidence',
    ]);
  });

  it('moves and deletes pages while preserving at least one page', () => {
    const onChange = vi.fn();
    const view = render(<OutlinePanel pages={pages} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move down Page 1' }));
    expect(
      (onChange.mock.lastCall?.[0] as OutlinePage[]).map((page) => page.id),
    ).toEqual(['evidence', 'opening']);

    fireEvent.click(screen.getByRole('button', { name: 'Delete page Page 1' }));
    expect(onChange).toHaveBeenLastCalledWith([pages[1]]);

    onChange.mockClear();
    view.rerender(<OutlinePanel pages={[pages[0]!]} onChange={onChange} />);
    const deleteButton = screen.getByRole('button', {
      name: 'Delete page Page 1',
    });
    expect(deleteButton).toHaveProperty('disabled', true);
    fireEvent.click(deleteButton);
    expect(onChange).not.toHaveBeenCalled();
  });
});
