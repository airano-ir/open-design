// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TodoCard } from '../../src/components/ToolCard';

describe('TodoCard completion disclosure', () => {
  afterEach(() => cleanup());

  it('keeps a fully completed checklist to one non-expandable summary row', () => {
    const { container } = render(
      <TodoCard
        input={{
          todos: [
            { content: 'Read home.ts', status: 'completed' },
            { content: 'Edit home.ts', status: 'completed' },
            { content: 'Finish', status: 'completed' },
          ],
        }}
        runStreaming
        runSucceeded={false}
      />,
    );

    const summary = container.querySelector('.op-todo-summary');
    expect(summary?.textContent).toContain('3/3');
    expect(container.querySelector('.op-todo')).toHaveClass('op-todo-collapsed');
    expect(container.querySelector('.accordion-collapsible')).toBeNull();
    expect(container.querySelector('.todo-list')).toBeNull();
    expect(container.querySelector('button.op-todo-toggle')).toBeNull();
  });

  it('shows task-by-task progress until every task is complete', () => {
    const { container } = render(
      <TodoCard
        input={{
          todos: [
            { content: 'Read home.ts', status: 'completed' },
            { content: 'Edit home.ts', status: 'in_progress' },
            { content: 'Finish', status: 'pending' },
          ],
        }}
        runStreaming
        runSucceeded={false}
      />,
    );

    const toggle = container.querySelector<HTMLButtonElement>('button.op-todo-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('.todo-item')).toHaveLength(3);

    fireEvent.click(toggle!);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });
});
