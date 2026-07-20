// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async (projectId: string, name: string) => {
    if (projectId === 'project-ds' && name === 'brand.json') {
      return JSON.stringify({
        logo: { primary: 'logos/favicon-1.png' },
        imagery: { samples: [{ file: 'imagery/cover-0.png', kind: 'cover' }] },
      });
    }
    if (projectId === 'project-ds-fallback' && name === 'brand.json') {
      return JSON.stringify({
        logo: {
          primary: 'logos/favicon-1.png',
          alternates: ['logos/wordmark.svg'],
        },
      });
    }
    return null;
  }),
  fetchProjectFiles: vi.fn(async (projectId: string) => {
    if (projectId === 'project-ds') {
      return [
        { name: 'favicon-1.png', path: 'logos/favicon-1.png', kind: 'image', mtime: 4 },
        { name: 'cover-0.png', path: 'imagery/cover-0.png', kind: 'image', mtime: 3 },
      ];
    }
    if (projectId === 'project-ds-fallback') {
      return [
        { name: 'favicon-1.png', path: 'logos/favicon-1.png', kind: 'image', mtime: 4 },
        { name: 'wordmark.svg', path: 'logos/wordmark.svg', kind: 'image', mtime: 3 },
      ];
    }
    if (projectId === 'project-html') {
      return [{ name: 'index.html', kind: 'html', mtime: 2 }];
    }
    if (projectId === 'project-deck') {
      return [{ name: 'index.html', kind: 'html', mtime: 2 }];
    }
    return [];
  }),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
    ...overrides,
  };
}

function projects(count: number): Project[] {
  return Array.from({ length: count }, (_, index) =>
    project({
      id: `project-${index + 1}`,
      name: `Project ${index + 1}`,
      updatedAt: count - index,
    }),
  );
}

describe('RecentProjectsStrip', () => {
  // The blank-state CTA disappears the moment the user owns one project, and
  // #5517's alignment removed both the rail "+" and the home template row — so
  // without a header action the New Project modal has no reachable entry at
  // all. Pin it: a list page must always be able to start a project.
  it('offers a create action on the list pages', () => {
    const onNewProject = vi.fn();
    render(
      <RecentProjectsStrip
        projects={projects(3)}
        heading="Drafts"
        limit={1000}
        onOpen={() => {}}
        onViewAll={() => {}}
        onNewProject={onNewProject}
      />,
    );

    screen.getByTestId('recent-projects-new').click();
    expect(onNewProject).toHaveBeenCalled();
  });

  // Home has no header action — there the composer IS the create surface.
  it('omits the create action when no handler is supplied', () => {
    render(
      <RecentProjectsStrip
        projects={projects(3)}
        heading="Drafts"
        limit={1000}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    expect(screen.queryByTestId('recent-projects-new')).toBeNull();
  });

  it('shows seven projects when the row has room for a seventh card', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        width: this.classList.contains('recent-projects__row') ? 1332 : 180,
        height: 100,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    const { container } = render(
      <RecentProjectsStrip
        projects={projects(8)}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    });
  });

  it('keeps six projects when the row is below the wide-card threshold', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        width: this.classList.contains('recent-projects__row') ? 1331 : 180,
        height: 100,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    const { container } = render(
      <RecentProjectsStrip
        projects={projects(8)}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(6);
  });

  it('remeasures when projects arrive after the initial empty render', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1400,
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        width: this.classList.contains('recent-projects__row') ? 1331 : 180,
        height: 100,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    const { container, rerender } = render(
      <RecentProjectsStrip
        projects={[]}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    rerender(
      <RecentProjectsStrip
        projects={projects(8)}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(6);
  });

  it('matches project cards with previews and design-system tags', async () => {
    const { container } = render(
      <RecentProjectsStrip
        projects={[
          project({
            id: 'project-ds',
            name: 'Acme Design System',
            updatedAt: 4,
            metadata: {
              kind: 'other',
              importedFrom: 'design-system',
            },
          }),
          project({
            id: 'project-html',
            name: 'Web Prototype',
            updatedAt: 3,
          }),
        ]}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    expect(screen.getByText('Design System')).toBeTruthy();
    expect(screen.getAllByText('Prototype').length).toBeGreaterThan(0);
    const designSystemCard = container.querySelector('.recent-projects__card.is-design-system-project');
    expect(designSystemCard).toBeTruthy();
    expect(designSystemCard?.querySelectorAll('.design-card-tag')).toHaveLength(1);

    await waitFor(() => {
      expect(designSystemCard?.querySelector('.recent-projects__card-thumb-image img')).toBeTruthy();
      expect(designSystemCard?.querySelector('img')?.getAttribute('src')).toBe(
        '/api/projects/project-ds/files/imagery/cover-0.png',
      );
      // HTML projects render their real artifact in the card thumbnail; the
      // initial glyph is only the no-entry-file fallback.
      expect(container.querySelector('.recent-projects__card-thumb-html iframe')).toBeTruthy();
      expect(container.querySelector('.recent-projects__card-thumb-html .recent-projects__card-glyph')).toBeNull();
    });
  });

  it('marks owner-shared projects with the shared card state and badge', () => {
    const { container } = render(
      <RecentProjectsStrip
        projects={[
          project({
            id: 'project-shared',
            name: 'Shared Prototype',
            updatedAt: 4,
          }),
        ]}
        sharedProjectIds={new Set(['project-shared'])}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    const card = container.querySelector('.recent-projects__card');
    expect(card?.classList.contains('is-shared')).toBe(true);
    expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('uses non-favicon design-system logo alternates when no cover exists', async () => {
    const { container } = render(
      <RecentProjectsStrip
        projects={[
          project({
            id: 'project-ds-fallback',
            name: 'Acme Design System',
            updatedAt: 4,
            metadata: {
              kind: 'other',
              importedFrom: 'design-system',
            },
          }),
        ]}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    const designSystemCard = container.querySelector('.recent-projects__card.is-design-system-project');

    await waitFor(() => {
      expect(designSystemCard?.querySelector('.recent-projects__card-thumb-logo img')).toBeTruthy();
      expect(designSystemCard?.querySelector('img')?.getAttribute('src')).toBe(
        '/api/projects/project-ds-fallback/files/logos/wordmark.svg',
      );
    });
  });

  // This used to assert the opposite — that the grid never renders a preview,
  // because doing so fetched every project's raw content on mount. #5517 shows
  // real content in these cards and the placeholder grid was one of the visible
  // gaps against it, so the previews are back, but only on terms that keep the
  // old test's actual concern satisfied: the iframes are lazy, and deck covers
  // resolve through a module-level cache so N cards on one src cost one fetch.
  it('renders HTML previews lazily rather than eagerly fetching every card', async () => {
    const fetchMock = vi.fn(async () => new Response('<html><body>deck</body></html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <RecentProjectsStrip
        projects={[
          project({ id: 'project-html', name: 'Web Prototype', updatedAt: 3 }),
        ]}
        onOpen={() => {}}
        onViewAll={() => {}}
      />,
    );

    const htmlCard = container.querySelector('[data-project-id="project-html"]');
    await waitFor(() => {
      expect(htmlCard?.querySelector('iframe')).toBeTruthy();
    });
    // Lazy is the whole safety margin: an off-screen card costs nothing until
    // the browser decides to load it.
    expect(htmlCard?.querySelector('iframe')?.getAttribute('loading')).toBe('lazy');
    // And the card itself must not pull project content imperatively.
    const previewFetches = fetchMock.mock.calls.filter(([input]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);
      return url.includes('/api/projects/');
    });
    expect(previewFetches).toEqual([]);
  });
});
