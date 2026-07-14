// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createFlowSnapshot,
  type FlowShapeId,
  type FlowSnapshot,
} from '@open-design/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowDeliveryActions } from '../../src/components/FlowDeliveryActions';

afterEach(cleanup);

function flowAt(
  generate: 'pending' | 'active' | 'complete',
  deliver: 'pending' | 'active' | 'complete',
  shape: FlowShapeId = 'deck',
): FlowSnapshot {
  const flow = createFlowSnapshot(shape, { now: 1 });
  return {
    ...flow,
    activeStage: deliver === 'active' ? 'deliver' : 'generate',
    stages: flow.stages.map((stage) => {
      if (stage.id === 'generate') return { ...stage, state: generate };
      if (stage.id === 'deliver') return { ...stage, state: deliver };
      return stage;
    }),
  };
}

describe('FlowDeliveryActions', () => {
  it('stays hidden until generation starts', () => {
    render(
      <FlowDeliveryActions
        flow={flowAt('pending', 'pending')}
        fileName={'index.html'}
      />,
    );

    expect(screen.queryByTestId('flow-delivery-actions')).toBeNull();
  });

  it('previews download and share CTAs while generation is active', () => {
    render(
      <FlowDeliveryActions
        flow={flowAt('active', 'pending')}
        fileName={'index.html'}
        onDownload={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByTestId('flow-delivery-actions').dataset.ready).toBe(
      'false',
    );
    expect(screen.getByTestId('flow-delivery-download')).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByTestId('flow-delivery-share')).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText('Download PPTX / PDF')).toBeTruthy();
  });

  it('enables hard-delivery actions as soon as generation completes', () => {
    const onDownload = vi.fn();
    const onShare = vi.fn();
    render(
      <FlowDeliveryActions
        flow={flowAt('complete', 'active')}
        fileName={'index.html'}
        onDownload={onDownload}
        onShare={onShare}
      />,
    );

    fireEvent.click(screen.getByTestId('flow-delivery-download'));
    fireEvent.click(screen.getByTestId('flow-delivery-share'));

    expect(onDownload).toHaveBeenCalledWith('index.html');
    expect(onShare).toHaveBeenCalledWith('index.html');
  });

  it.each([
    ['prototype', 'Download ZIP'],
    ['landing', 'Download HTML / ZIP'],
    ['mobile', 'Download ZIP'],
    ['webapp', 'Download ZIP'],
    ['document', 'Download MD / PDF'],
    ['report', 'Download PDF'],
  ] as const)(
    'previews configured hard-delivery actions for %s',
    (shape, downloadLabel) => {
      render(
        <FlowDeliveryActions
          flow={flowAt('active', 'pending', shape)}
          fileName={'artifact.html'}
          onDownload={() => undefined}
          onShare={() => undefined}
        />,
      );

      expect(screen.getByText(downloadLabel)).toBeTruthy();
      expect(screen.getByTestId('flow-delivery-share')).toHaveProperty(
        'disabled',
        true,
      );
    },
  );
});
