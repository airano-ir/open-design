// Presentation shell for the Computer panel (spec §3.4): a docked right-side
// drawer ("side view") or a centered modal, toggleable. Rendered via a portal
// so it floats above the project split without touching the workspace tabs.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TrackingProjectKind } from '@open-design/contracts/analytics';
import { OdComputerPanel } from './OdComputerPanel';
import type { TaskRound } from '../runtime/task-steps';
import type { ProjectFile } from '../types';
import styles from './OdComputerOverlay.module.css';

const COMPUTER_OVERLAY_EXIT_MS = 140;

function reducedMotionRequested(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function OdComputerOverlay({
  open,
  onClose,
  round,
  initialStepId,
  projectId,
  projectKind,
  projectFiles,
  filesRefreshKey,
  projectFileNames,
  onRequestOpenFile,
  onDock,
}: {
  open: boolean;
  onClose: () => void;
  round: TaskRound | null;
  initialStepId?: string;
  projectId?: string | null;
  projectKind?: TrackingProjectKind | null;
  projectFiles?: ProjectFile[];
  filesRefreshKey?: number;
  projectFileNames?: Set<string>;
  onRequestOpenFile?: (name: string) => void;
  onDock?: (runId: string, stepId?: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  const finishAfterExit = useCallback((finish: () => void) => {
    if (closing) return;
    if (reducedMotionRequested()) {
      finish();
      return;
    }
    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      finish();
    }, COMPUTER_OVERLAY_EXIT_MS);
  }, [closing]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.layer}
      data-variant="modal"
      data-state={closing ? 'closing' : 'open'}
      role="dialog"
      aria-modal="true"
      aria-label="Computer"
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-hidden
        tabIndex={-1}
        onClick={() => finishAfterExit(onClose)}
      />
      <div className={styles.shell} data-variant="modal">
        <OdComputerPanel
          round={round}
          variant="modal"
          initialStepId={initialStepId}
          projectId={projectId}
          projectKind={projectKind}
          projectFiles={projectFiles}
          filesRefreshKey={filesRefreshKey}
          projectFileNames={projectFileNames}
          onRequestOpenFile={onRequestOpenFile}
          onToggleView={round && onDock
            ? (stepId) => finishAfterExit(() => onDock(round.runId, stepId))
            : undefined}
          onClose={() => finishAfterExit(onClose)}
        />
      </div>
    </div>,
    document.body,
  );
}
