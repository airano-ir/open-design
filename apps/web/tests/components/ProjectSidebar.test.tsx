// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSidebar } from '../../src/components/ProjectSidebar';
import type { PetTaskCenter } from '../../src/components/pet/PetOverlay';
import type { Project } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => {
    const labels: Record<string, string> = {
      'app.brand': 'Open Design',
      'common.none': 'None',
      'common.search': 'Search',
      'common.searchEllipsis': 'Search…',
      'common.untitled': 'Untitled',
      'designFiles.collapseGroup': 'Collapse',
      'designFiles.expandGroup': 'Expand',
      'designs.status.awaitingInput': 'Needs input',
      'designs.status.canceled': 'Canceled',
      'designs.status.failed': 'Failed',
      'designs.status.incomplete': 'Incomplete',
      'entry.navHome': 'Home',
      'entry.navNewProject': 'New project',
      'entry.navProjects': 'Projects',
      'entry.navTasks': 'Tasks',
      'pet.taskGroup.queued': 'Waiting',
      'pet.taskGroup.running': 'Running',
      'tasks.filter.done': 'Done',
      'workspaceTabs.project': 'Project',
    };
    return labels[key] ?? key;
  },
}));

const projects: Project[] = [
  {
    id: 'alpha',
    name: 'Project Alpha',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 10,
    pendingPrompt: 'Create a quiet dashboard',
    metadata: { kind: 'prototype' },
  },
  {
    id: 'beta',
    name: 'Project Beta',
    skillId: null,
    designSystemId: null,
    createdAt: 2,
    updatedAt: 20,
    pendingPrompt: 'Brief beta for a launch deck',
    metadata: { kind: 'deck' },
  },
];

const taskCenter: PetTaskCenter = {
  running: [{ projectId: 'beta', projectName: 'Project Beta', status: 'running', count: 2 }],
  queued: [],
  recent: [],
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ProjectSidebar>> = {}) {
  const props: React.ComponentProps<typeof ProjectSidebar> = {
    route: { kind: 'project', projectId: 'alpha', conversationId: null, fileName: null },
    projects,
    projectsLoading: false,
    taskCenter,
    onOpenProject: vi.fn(),
    onNewProject: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenProjects: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProjectSidebar {...props} />), props };
}

describe('ProjectSidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps projects and live tasks visible in a persistent navigation rail', () => {
    renderSidebar();

    expect(screen.getByTestId('project-sidebar')).toBeTruthy();
    expect(screen.getByText('Open Design')).toBeTruthy();
    expect(screen.getByText('Project Alpha')).toBeTruthy();
    expect(screen.getAllByText('Project Beta').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps primary sidebar glyphs legible inside their larger click targets', () => {
    renderSidebar();

    const collapseIcon = screen.getByTestId('project-sidebar-toggle').querySelector('svg');
    const newProjectIcon = screen.getByRole('button', { name: /New project/ }).querySelector('svg');
    const projectIcon = screen.getByTitle('Project Alpha').querySelector('svg');
    const searchIcon = screen.getByRole('textbox', { name: 'Search' }).parentElement?.querySelector('svg');

    expect(collapseIcon?.getAttribute('width')).toBe('18');
    expect(newProjectIcon?.getAttribute('width')).toBe('18');
    expect(projectIcon?.getAttribute('width')).toBe('18');
    expect(searchIcon?.getAttribute('width')).toBe('16');
  });

  it('persists collapse state and restores the compact rail', async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('project-sidebar-toggle'));

    await waitFor(() => {
      expect(window.localStorage.getItem('open-design:project-sidebar:collapsed:v1')).toBe('1');
    });
    expect(screen.getByTestId('project-sidebar').className).toContain('collapsed');

    cleanup();
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy();
  });

  it('expands and focuses search from the collapsed rail', async () => {
    window.localStorage.setItem('open-design:project-sidebar:collapsed:v1', '1');
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search' })).toBe(document.activeElement);
    });
    expect(screen.getByTestId('project-sidebar').className).not.toContain('collapsed');
  });

  it('searches project names and saved briefs', () => {
    renderSidebar();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'launch deck' },
    });

    expect(screen.queryByTitle('Project Alpha')).toBeNull();
    expect(screen.getAllByTitle('Project Beta').length).toBeGreaterThanOrEqual(1);
  });

  it('switches projects and opens the new-project entry point', () => {
    const onOpenProject = vi.fn();
    const onNewProject = vi.fn();
    renderSidebar({ onOpenProject, onNewProject });

    fireEvent.click(screen.getByTitle('Project Alpha'));
    fireEvent.click(screen.getByRole('button', { name: /New project/ }));

    expect(onOpenProject).toHaveBeenCalledWith('alpha');
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
});
