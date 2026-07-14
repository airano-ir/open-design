import {
  FLOW_SHAPES,
  type FlowSnapshot,
} from '@open-design/contracts';

import { NextStepActions } from './NextStepActions';
import styles from './FlowDeliveryActions.module.css';

export function FlowDeliveryActions({
  flow,
  fileName,
  onDownload,
  onShare,
}: {
  flow: FlowSnapshot;
  fileName?: string | null;
  onDownload?: (fileName: string) => void;
  onShare?: (fileName: string) => void;
}) {
  const generateState = flow.stages.find((stage) => stage.id === 'generate')?.state;
  const deliverState = flow.stages.find((stage) => stage.id === 'deliver')?.state;
  const visible =
    generateState === 'active' ||
    generateState === 'complete' ||
    deliverState === 'active' ||
    deliverState === 'complete';
  if (!visible) return null;

  const ready =
    generateState === 'complete' ||
    deliverState === 'active' ||
    deliverState === 'complete';

  return (
    <div
      className={styles.root}
      data-testid={'flow-delivery-actions'}
      data-ready={ready ? 'true' : 'false'}
    >
      <NextStepActions
        variant={'delivery'}
        fileName={fileName}
        deliverActions={FLOW_SHAPES[flow.shape].deliverActions}
        deliveryReady={ready}
        onDownload={onDownload}
        onShare={onShare}
      />
    </div>
  );
}
