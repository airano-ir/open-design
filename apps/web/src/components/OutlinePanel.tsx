import { Button, Input, Textarea } from '@open-design/components';
import { useId } from 'react';
import styles from './OutlinePanel.module.css';

export interface OutlinePage {
  id: string;
  title: string;
  bullets: string[];
}

export interface OutlinePanelCopy {
  title: string;
  pageLabel: string;
  titleLabel: string;
  bulletsLabel: string;
  bulletsHint: string;
  untitledPage: string;
  addPage: string;
  insertPage: string;
  deletePage: string;
  moveUp: string;
  moveDown: string;
  emptyState: string;
}

export interface OutlinePanelProps {
  pages: readonly OutlinePage[];
  onChange: (pages: OutlinePage[]) => void;
  loading?: boolean;
  statusDetail?: string;
  copy?: Partial<OutlinePanelCopy>;
}

const DEFAULT_COPY: OutlinePanelCopy = {
  title: 'Outline',
  pageLabel: 'Page',
  titleLabel: 'Title',
  bulletsLabel: 'Key points',
  bulletsHint: 'Put each key point on a separate line.',
  untitledPage: 'Untitled page',
  addPage: 'Add page',
  insertPage: 'Insert page',
  deletePage: 'Delete page',
  moveUp: 'Move up',
  moveDown: 'Move down',
  emptyState: 'Add a page to start the outline.',
};

function nextPageId(pages: readonly OutlinePage[]): string {
  const ids = new Set(pages.map((page) => page.id));
  let candidate = pages.length + 1;
  while (ids.has(`outline-page-${candidate}`)) candidate += 1;
  return `outline-page-${candidate}`;
}

function createPage(
  pages: readonly OutlinePage[],
  copy: OutlinePanelCopy,
): OutlinePage {
  return {
    id: nextPageId(pages),
    title: copy.untitledPage,
    bullets: [],
  };
}

export function OutlinePanel({
  pages,
  onChange,
  loading = false,
  statusDetail,
  copy: copyOverrides,
}: OutlinePanelProps) {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };
  const hintIdPrefix = useId();

  const updatePage = (
    pageIndex: number,
    update: Partial<Pick<OutlinePage, 'title' | 'bullets'>>,
  ): void => {
    onChange(
      pages.map((page, index) =>
        index === pageIndex ? { ...page, ...update } : { ...page },
      ),
    );
  };

  const addPage = (): void => {
    onChange([...pages.map((page) => ({ ...page })), createPage(pages, copy)]);
  };

  const insertPage = (afterIndex: number): void => {
    const nextPages = pages.map((page) => ({ ...page }));
    nextPages.splice(afterIndex + 1, 0, createPage(pages, copy));
    onChange(nextPages);
  };

  const deletePage = (pageIndex: number): void => {
    if (pages.length <= 1) return;
    onChange(
      pages
        .filter((_page, index) => index !== pageIndex)
        .map((page) => ({ ...page })),
    );
  };

  const movePage = (pageIndex: number, offset: -1 | 1): void => {
    const destination = pageIndex + offset;
    if (destination < 0 || destination >= pages.length) return;
    const nextPages = pages.map((page) => ({ ...page }));
    const [page] = nextPages.splice(pageIndex, 1);
    if (!page) return;
    nextPages.splice(destination, 0, page);
    onChange(nextPages);
  };

  return (
    <section
      className={styles.root}
      aria-label={copy.title}
      data-testid={'outline-panel'}
    >
      <header className={styles.header}>
        <h2 className={styles.panelTitle}>{copy.title}</h2>
        <Button variant={'primary'} onClick={addPage} disabled={loading}>
          {copy.addPage}
        </Button>
      </header>

      {loading ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <div className={styles.loadingLines} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className={styles.loadingDetail}>{statusDetail ?? copy.emptyState}</span>
        </div>
      ) : pages.length === 0 ? (
        <div className={styles.empty}>{copy.emptyState}</div>
      ) : (
        <ol className={styles.pages}>
          {pages.map((page, pageIndex) => {
            const pageName = [copy.pageLabel, pageIndex + 1].join(' ');
            const hintId = `${hintIdPrefix}-bullets-${pageIndex}`;
            return (
              <li key={page.id} className={styles.page}>
                <article className={styles.pageCard}>
                  <header className={styles.pageHeader}>
                    <span className={styles.pageNumber}>{pageName}</span>
                    <div className={styles.pageActions}>
                      <Button
                        variant={'subtle'}
                        onClick={() => movePage(pageIndex, -1)}
                        disabled={pageIndex === 0}
                        aria-label={[copy.moveUp, pageName].join(' ')}
                      >
                        {copy.moveUp}
                      </Button>
                      <Button
                        variant={'subtle'}
                        onClick={() => movePage(pageIndex, 1)}
                        disabled={pageIndex === pages.length - 1}
                        aria-label={[copy.moveDown, pageName].join(' ')}
                      >
                        {copy.moveDown}
                      </Button>
                      <Button
                        variant={'subtle'}
                        onClick={() => deletePage(pageIndex)}
                        disabled={pages.length <= 1}
                        aria-label={[copy.deletePage, pageName].join(' ')}
                      >
                        {copy.deletePage}
                      </Button>
                    </div>
                  </header>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{copy.titleLabel}</span>
                    <Input
                      value={page.title}
                      onChange={(event) =>
                        updatePage(pageIndex, { title: event.currentTarget.value })
                      }
                      aria-label={[copy.titleLabel, pageName].join(' ')}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{copy.bulletsLabel}</span>
                    <Textarea
                      value={page.bullets.join('\n')}
                      rows={4}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updatePage(pageIndex, {
                          bullets: value === '' ? [] : value.split('\n'),
                        });
                      }}
                      aria-label={[copy.bulletsLabel, pageName].join(' ')}
                      aria-describedby={hintId}
                    />
                    <span id={hintId} className={styles.hint}>
                      {copy.bulletsHint}
                    </span>
                  </label>
                </article>

                {pageIndex < pages.length - 1 ? (
                  <div className={styles.insertRow}>
                    <Button
                      variant={'ghost'}
                      onClick={() => insertPage(pageIndex)}
                      aria-label={[copy.insertPage, pageName].join(' ')}
                    >
                      {copy.insertPage}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
