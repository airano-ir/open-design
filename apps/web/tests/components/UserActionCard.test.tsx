// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UserActionCard } from '../../src/components/UserActionCard';

afterEach(cleanup);

describe('UserActionCard', () => {
  it('keeps explanation content collapsed behind a reusable detail disclosure', () => {
    const { container } = render(
      <UserActionCard
        dataKind="test-action"
        icon="info"
        title="Sign in required"
        actions={<button type="button">Sign in</button>}
        detailsLabel="View details"
        details={<p>Authentication expired while the task was running.</p>}
      />,
    );

    expect(container.querySelector('[data-user-action-card="test-action"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'View details' });
    const disclosure = container.querySelector('.accordion-collapsible');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.classList.contains('open')).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure?.classList.contains('open')).toBe(true);
  });
});
