// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFlowMarker, createFlowSnapshot } from '@open-design/contracts';
import { FlowProgressCard } from '../../src/components/FlowProgressCard';

afterEach(cleanup);

describe('FlowProgressCard', () => {
  it('keeps the optional research step out of the default pending ladder', () => {
    let flow = createFlowSnapshot('deck', { now: 1 });
    flow = applyFlowMarker(flow, { stage: 'clarify', state: 'active' }, 1);

    render(<FlowProgressCard flow={flow} />);

    expect(screen.getByText('Task progress')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByText('Confirm the brief')).toBeTruthy();
    expect(screen.queryByText('Research')).toBeNull();
    // Pending steps always carry a "when does this start" preview line.
    expect(screen.getByText('Pick after the plan is confirmed')).toBeTruthy();
    expect(screen.getByText('Download or share when generation ends')).toBeTruthy();
  });

  it('inserts the pending research step when deep research is selected', () => {
    const flow = {
      ...createFlowSnapshot('deck', { now: 1 }),
      researchMode: 'deep' as const,
    };

    render(<FlowProgressCard flow={flow} />);

    expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    expect(screen.getByText('Research')).toBeTruthy();
  });

  it('shows generate progress counts and stage detail lines', () => {
    let flow = createFlowSnapshot('deck', { now: 1 });
    flow = applyFlowMarker(
      flow,
      { stage: 'research', state: 'skipped', detail: 'Skipped · default style' },
      1,
    );
    flow = applyFlowMarker(flow, { stage: 'generate', state: 'active', done: 3, total: 12 }, 2);

    render(<FlowProgressCard flow={flow} />);

    expect(screen.getByText('3 / 12 slides')).toBeTruthy();
    expect(screen.getByText('Skipped · default style')).toBeTruthy();
  });

  it('localizes canonical engine details while preserving template names', () => {
    let flow = createFlowSnapshot('mobile', { now: 1 });
    flow = applyFlowMarker(
      flow,
      { stage: 'plan', state: 'complete', detail: 'Outline confirmed' },
      2,
    );
    flow = applyFlowMarker(
      flow,
      {
        stage: 'inspire',
        state: 'complete',
        detail: 'Using template wireframe-mobile-flow',
      },
      3,
    );

    render(<FlowProgressCard flow={flow} />);

    expect(screen.queryByText('Outline confirmed')).toBeNull();
    expect(screen.queryByText('Using template wireframe-mobile-flow')).toBeNull();
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getByText('selected · wireframe-mobile-flow')).toBeTruthy();
  });

  it('opens a durable stage artifact from the progress card', () => {
    const onOpenArtifact = vi.fn();
    render(
      <FlowProgressCard
        flow={createFlowSnapshot('deck', { now: 1 })}
        stageArtifactPaths={{ clarify: ['generated/brief.md'] }}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm the brief: generated/brief.md',
      }),
    );

    expect(onOpenArtifact).toHaveBeenCalledWith('generated/brief.md');
  });
});
