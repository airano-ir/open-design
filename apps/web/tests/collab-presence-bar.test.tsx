// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresenceBar } from '../src/collab/PresenceBar.js';

afterEach(cleanup);

describe('PresenceBar', () => {
  it('renders self first with an online marker plus present teammates', () => {
    render(
      <PresenceBar
        selfMemberId="me"
        selfMember={{ memberId: 'me', name: 'Me' }}
        members={[
          { memberId: 'me', name: 'Me' },
          { memberId: 'm1', name: 'Ma Shu', role: 'member' },
          { memberId: 'm2', name: 'Yuan Xi', role: 'admin' },
        ]}
      />,
    );
    const self = screen.getByText('ME');
    expect(self).toBeTruthy();
    expect(self.getAttribute('data-self')).toBe('true');
    expect(screen.getByText('MS')).toBeTruthy();
    expect(screen.getByText('YX')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toContain('3 collaborators online, including you');

    fireEvent.click(screen.getByRole('button', { name: /3 collaborators online/ }));

    expect(screen.getByRole('dialog', { name: 'Online collaborators' })).toBeTruthy();
    expect(screen.getByText('3 online')).toBeTruthy();
    expect(screen.getByText('Me')).toBeTruthy();
    expect(screen.getByText('Ma Shu')).toBeTruthy();
    expect(screen.getByText('Yuan Xi')).toBeTruthy();
    expect(screen.getByText('Member · You are viewing this project')).toBeTruthy();
    expect(screen.getByText('Admin · Viewing this project')).toBeTruthy();
  });

  it('collapses past the max into a +N overflow chip', () => {
    render(
      <PresenceBar
        max={2}
        members={[
          { memberId: 'a', name: 'Aa' },
          { memberId: 'b', name: 'Bb' },
          { memberId: 'c', name: 'Cc' },
          { memberId: 'd', name: 'Dd' },
        ]}
      />,
    );
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('renders self when no teammates are present yet', () => {
    render(
      <PresenceBar
        selfMemberId="me"
        selfMember={{ memberId: 'me', name: 'Me' }}
        members={[]}
      />,
    );
    expect(screen.getByText('ME')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toContain('1 collaborator online, including you');
  });

  it('falls back to the member id when there is no name', () => {
    render(<PresenceBar members={[{ memberId: 'zx' }]} />);
    expect(screen.getByText('ZX')).toBeTruthy();
  });
});
