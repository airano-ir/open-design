/**
 * "Files this turn" disclosure pinned to the top of an assistant message.
 *
 * The first four files stay visible so artifacts are presented as results,
 * not hidden inside execution history. In larger batches only the remaining
 * files start collapsed; a changed result file also gets one direct "Open"
 * action that lifts the basename up to ProjectView so FileWorkspace focuses
 * the matching tab.
 *
 * The component is read-only over `events` — derivation lives in
 * `runtime/file-ops.ts` so the same logic is reachable from tests and
 * future surfaces (sidebar, log export, etc.) without coupling to
 * AssistantMessage's render shape.
 */
import { useState } from 'react';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import {
  countFileOps,
  type FileOpEntry,
  type FileOpKind,
} from '../runtime/file-ops';
import { Icon } from './Icon';

interface Props {
  entries: FileOpEntry[];
  /** True while the parent run is still streaming. Drives live-pulse styling. */
  streaming: boolean;
  /** Names that exist in the project folder. When set, the open button
   *  only shows for entries whose basename is in the set. Pass undefined
   *  to opt out of the existence check (button always shown). */
  projectFileNames?: Set<string> | undefined;
  onRequestOpenFile?: ((name: string) => void) | undefined;
}

const OP_LABEL_KEY: Record<FileOpKind, keyof Dict> = {
  read: 'tool.read',
  write: 'tool.write',
  edit: 'tool.edit',
  delete: 'tool.delete',
};

const OP_BADGE_GLYPH: Record<FileOpKind, string> = {
  read: 'R',
  write: 'W',
  edit: 'E',
  delete: 'D',
};

const COLLAPSE_AFTER_ENTRY_COUNT = 4;

export function FileOpsSummary({
  entries,
  streaming,
  projectFileNames,
  onRequestOpenFile,
}: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  // Keep the first four results immediately legible. Once a run touches more
  // files, only rows after the fourth start hidden; expanding reveals the
  // remainder without making the entire result set disappear by default.
  const isCollapsible = entries.length > COLLAPSE_AFTER_ENTRY_COUNT;

  const counts = countFileOps(entries);
  const summaryParts: string[] = [];
  if (counts.write > 0) summaryParts.push(`${t('tool.write')} ${counts.write}`);
  if (counts.edit > 0) summaryParts.push(`${t('tool.edit')} ${counts.edit}`);
  if (counts.delete > 0) summaryParts.push(`${t('tool.delete')} ${counts.delete}`);
  if (counts.read > 0) summaryParts.push(`${t('tool.read')} ${counts.read}`);

  // Prefer the latest changed file as the result entry point. Read-only turns
  // intentionally have no primary action: opening an arbitrary input would
  // make the execution record look like a delivery card.
  const primaryEntry = [...entries]
    .reverse()
    .find((entry) =>
      !entry.ops.includes('delete') &&
      (entry.ops.includes('write') || entry.ops.includes('edit')),
    );
  const canOpenPrimary =
    !!primaryEntry &&
    !!onRequestOpenFile &&
    (projectFileNames ? projectFileNames.has(primaryEntry.path) : true);
  const header = (
    <>
      <span className="file-ops-icon" aria-hidden>
        <Icon name="file" size={13} />
      </span>
      <span className="file-ops-label">{t('assistant.producedFiles')}</span>
      <span className="file-ops-summary-line">{summaryParts.join(' · ')}</span>
      <span className="file-ops-count">{entries.length}</span>
      {isCollapsible ? (
        <span className={`file-ops-chev${expanded ? ' is-expanded' : ''}`} aria-hidden>
          <Icon name="chevron-down" size={11} />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={`file-ops${streaming ? ' is-streaming' : ''}`}
      data-testid="file-ops-summary"
    >
      <div className="file-ops-head">
        {isCollapsible ? (
          <button
            type="button"
            className="file-ops-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            data-testid="file-ops-toggle"
          >
            {header}
          </button>
        ) : (
          <div
            className="file-ops-toggle file-ops-toggle--static"
            data-testid="file-ops-toggle"
          >
            {header}
          </div>
        )}
        {canOpenPrimary && primaryEntry && isCollapsible && !expanded ? (
          <button
            type="button"
            className="file-ops-primary-action"
            onClick={() => onRequestOpenFile?.(primaryEntry.path)}
            title={t('tool.openInTab', { name: primaryEntry.path })}
            data-testid={`file-ops-primary-open-${primaryEntry.path}`}
          >
            {t('assistant.openFile')}
          </button>
        ) : null}
      </div>
      <ul className="file-ops-list" role="list">
        {entries.map((entry, index) => (
          <FileOpRow
            key={entry.fullPath}
            entry={entry}
            hidden={isCollapsible && !expanded && index >= COLLAPSE_AFTER_ENTRY_COUNT}
            projectFileNames={projectFileNames}
            onRequestOpenFile={onRequestOpenFile}
          />
        ))}
      </ul>
    </div>
  );
}

function FileOpRow({
  entry,
  hidden,
  projectFileNames,
  onRequestOpenFile,
}: {
  entry: FileOpEntry;
  hidden?: boolean;
  projectFileNames?: Set<string> | undefined;
  onRequestOpenFile?: ((name: string) => void) | undefined;
}) {
  const t = useT();
  const canOpen =
    !!onRequestOpenFile &&
    !entry.ops.includes('delete') &&
    (projectFileNames ? projectFileNames.has(entry.path) : true);
  return (
    <li
      className={`file-ops-row file-ops-row--${entry.status}`}
      data-testid={`file-ops-row-${entry.path}`}
      hidden={hidden}
    >
      <div className="file-ops-row-badges" aria-hidden>
        {entry.ops.map((op) => {
          const count = entry.opCounts[op];
          return (
            <span
              key={op}
              className={`file-ops-badge file-ops-badge--${op}`}
              title={
                count > 1
                  ? `${t(OP_LABEL_KEY[op])} ×${count}`
                  : t(OP_LABEL_KEY[op])
              }
            >
              {OP_BADGE_GLYPH[op]}
              {count > 1 ? (
                <span className="file-ops-badge-count">×{count}</span>
              ) : null}
            </span>
          );
        })}
      </div>
      <code className="file-ops-row-path" title={entry.fullPath}>
        {entry.path}
      </code>
      {entry.status === 'running' ? (
        <span className="file-ops-row-status file-ops-row-status--running">
          {t('tool.running')}
        </span>
      ) : entry.status === 'error' ? (
        <span className="file-ops-row-status file-ops-row-status--error">
          {t('tool.error')}
        </span>
      ) : null}
      {canOpen ? (
        <button
          type="button"
          className="file-ops-row-open"
          onClick={() => onRequestOpenFile?.(entry.path)}
          title={t('tool.openInTab', { name: entry.path })}
          data-testid={`file-ops-row-open-${entry.path}`}
        >
          {t('assistant.openFile')}
        </button>
      ) : null}
    </li>
  );
}
