import type { ReactNode } from 'react';
import type { FlowStageId } from '@open-design/contracts';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import styles from './FlowWorkspaceTransition.module.css';

export interface FlowWorkspaceDescriptor {
  stage: FlowStageId;
  label: string;
  content: ReactNode;
  nonce: number;
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * Keeps the outgoing staged-flow surface mounted long enough to read as a
 * handoff, then brings the next stage in. A plan checkpoint may dock beside
 * the editable outline so approval never hides the work being approved.
 */
export function FlowWorkspaceTransition({
  workspace,
  checkpoint,
}: {
  workspace: FlowWorkspaceDescriptor;
  checkpoint?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={styles.root}
      data-testid="flow-workspace-transition"
      data-active-stage={workspace.stage}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.section
          key={workspace.stage}
          className={`${styles.stage}${checkpoint ? ` ${styles.withCheckpoint}` : ''}`}
          aria-label={workspace.label}
          data-testid={`flow-workspace-${workspace.stage}`}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: {
              duration: reduceMotion ? 0 : 0.2,
              ease: EASE_OUT,
            },
          }}
          exit={{
            opacity: 0,
            y: reduceMotion ? 0 : -4,
            transition: {
              duration: reduceMotion ? 0 : 0.14,
              ease: EASE_OUT,
            },
          }}
        >
          <div className={styles.main}>{workspace.content}</div>
          {checkpoint ? (
            <aside className={styles.checkpoint} data-testid="flow-plan-checkpoint">
              {checkpoint}
            </aside>
          ) : null}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
