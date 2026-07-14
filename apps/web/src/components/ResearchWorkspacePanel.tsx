import { Button } from '@open-design/components';
import { renderMarkdown } from '../runtime/markdown';
import styles from './ResearchWorkspacePanel.module.css';

export type ResearchRoundStatus = 'pending' | 'active' | 'complete' | 'error';

export interface ResearchRound {
  id: string;
  title: string;
  detail?: string;
  status: ResearchRoundStatus;
}

export interface ResearchWorkspacePanelCopy {
  title: string;
  roundOneTitle: string;
  roundTwoTitle: string;
  pendingStatus: string;
  activeStatus: string;
  completeStatus: string;
  errorStatus: string;
  reportLabel: string;
  reportPending: string;
  openReport: string;
}

export interface ResearchWorkspacePanelProps {
  rounds?: readonly ResearchRound[];
  activeDetail?: string;
  reportPath?: string;
  reportMarkdown?: string;
  onOpenReport?: (path: string) => void;
  copy?: Partial<ResearchWorkspacePanelCopy>;
}

const DEFAULT_COPY: ResearchWorkspacePanelCopy = {
  title: 'Research workspace',
  roundOneTitle: 'Round 1 · Explore the topic',
  roundTwoTitle: 'Round 2 · Fill evidence gaps',
  pendingStatus: 'Pending',
  activeStatus: 'In progress',
  completeStatus: 'Complete',
  errorStatus: 'Needs attention',
  reportLabel: 'Research report',
  reportPending: 'The report will appear when research finishes.',
  openReport: 'Open report',
};

const STATUS_GLYPH: Record<ResearchRoundStatus, string> = {
  pending: '○',
  active: '◔',
  complete: '✓',
  error: '✕',
};

function statusLabel(
  status: ResearchRoundStatus,
  copy: ResearchWorkspacePanelCopy,
): string {
  if (status === 'active') return copy.activeStatus;
  if (status === 'complete') return copy.completeStatus;
  if (status === 'error') return copy.errorStatus;
  return copy.pendingStatus;
}

export function ResearchWorkspacePanel({
  rounds,
  activeDetail,
  reportPath,
  reportMarkdown,
  onOpenReport,
  copy: copyOverrides,
}: ResearchWorkspacePanelProps) {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };
  const visibleRounds: readonly ResearchRound[] = rounds ?? [
    {
      id: 'round-1',
      title: copy.roundOneTitle,
      status: 'active',
    },
    {
      id: 'round-2',
      title: copy.roundTwoTitle,
      status: 'pending',
    },
  ];

  return (
    <section
      className={styles.root}
      aria-label={copy.title}
      data-testid={'research-workspace-panel'}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{copy.title}</h2>
      </header>

      <ol className={styles.rounds}>
        {visibleRounds.map((round) => {
          const detail =
            round.status === 'active' && activeDetail ? activeDetail : round.detail;
          return (
            <li
              key={round.id}
              className={`${styles.round} ${styles[round.status]}`}
              data-status={round.status}
            >
              <span className={styles.glyph} aria-hidden={true}>
                {STATUS_GLYPH[round.status]}
              </span>
              <div className={styles.roundCopy}>
                <div className={styles.roundHeading}>
                  <span className={styles.roundTitle}>{round.title}</span>
                  <span className={styles.status}>
                    {statusLabel(round.status, copy)}
                  </span>
                </div>
                {detail ? (
                  <p
                    className={styles.detail}
                    aria-live={round.status === 'active' ? 'polite' : undefined}
                  >
                    {detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {reportMarkdown ? (
        <div
          className={styles.reportPreview}
          aria-live={'polite'}
          data-testid={'research-report-preview'}
        >
          {renderMarkdown(reportMarkdown)}
        </div>
      ) : null}

      <footer className={styles.report}>
        <div className={styles.reportCopy}>
          <span className={styles.reportLabel}>{copy.reportLabel}</span>
          <span className={reportPath ? styles.reportPath : styles.reportPending}>
            {reportPath ?? copy.reportPending}
          </span>
        </div>
        {reportPath && onOpenReport ? (
          <Button
            variant={'primary'}
            onClick={() => onOpenReport(reportPath)}
            className={styles.openButton}
          >
            {copy.openReport}
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
