// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchWorkspacePanel } from '../../src/components/ResearchWorkspacePanel';

afterEach(cleanup);

describe('ResearchWorkspacePanel', () => {
  it('renders the default two-round skeleton and the active detail', () => {
    render(
      <ResearchWorkspacePanel
        activeDetail={'Round 1/2 · 9 searches · 12 sources'}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Round 1 · Explore the topic')).toBeTruthy();
    expect(screen.getByText('Round 2 · Fill evidence gaps')).toBeTruthy();
    expect(screen.getByText('Round 1/2 · 9 searches · 12 sources')).toBeTruthy();
    expect(
      screen.getByText('The report will appear when research finishes.'),
    ).toBeTruthy();
  });

  it('opens the completed report path and accepts host copy', () => {
    const onOpenReport = vi.fn();
    render(
      <ResearchWorkspacePanel
        reportPath={'research/robotics-market.md'}
        reportMarkdown={'# Robotics market\n\nEvidence is arriving continuously.'}
        onOpenReport={onOpenReport}
        copy={{
          title: 'Live evidence',
          openReport: 'Review findings',
        }}
      />,
    );

    expect(screen.getByRole('region', { name: 'Live evidence' })).toBeTruthy();
    expect(screen.getByText('research/robotics-market.md')).toBeTruthy();
    expect(screen.getByTestId('research-report-preview').textContent).toContain(
      'Evidence is arriving continuously.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review findings' }));
    expect(onOpenReport).toHaveBeenCalledWith('research/robotics-market.md');
  });
});
