import { Button, Input, VisuallyHidden } from '@open-design/components';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { Route } from '../router';
import type { Project, ProjectDisplayStatus } from '../types';
import { Icon, type IconName } from './Icon';
import type { PetTaskCenter } from './pet/PetOverlay';
import {
  readWorkspaceTabsSnapshot,
  WORKSPACE_TABS_STATE_CHANGED_EVENT,
  type WorkspaceTabsSnapshot,
} from './workspace-tabs-snapshot';
import styles from './ProjectSidebar.module.css';

const COLLAPSE_STORAGE_KEY = 'open-design:project-sidebar:collapsed:v1';
const PRIMARY_ICON_SIZE = 18;
const SECONDARY_ICON_SIZE = 16;

interface Props {
  route: Route;
  projects: Project[];
  projectsLoading: boolean;
  taskCenter: PetTaskCenter;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  onOpenHome: () => void;
  onOpenProjects: () => void;
}

interface SidebarTask {
  projectId: string;
  projectName: string;
  status: 'running' | 'queued' | 'succeeded' | 'incomplete' | 'failed' | 'canceled';
  count: number;
  updatedAt: number;
}

function initialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function projectSearchText(project: Project): string {
  return [
    project.name,
    project.pendingPrompt,
    project.customInstructions,
    project.metadata?.kind,
    project.metadata?.intent,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
}

function projectIcon(project: Project): IconName {
  switch (project.metadata?.kind) {
    case 'deck':
      return 'slides';
    case 'image':
      return 'image';
    case 'video':
      return 'play';
    case 'audio':
      return 'volume';
    case 'brand':
      return 'palette';
    case 'prototype':
      return 'layout';
    case 'template':
      return 'blocks';
    default:
      return 'folder';
  }
}

function statusRank(status: ProjectDisplayStatus | undefined): number {
  switch (status) {
    case 'running':
      return 0;
    case 'awaiting_input':
      return 1;
    case 'queued':
      return 2;
    case 'incomplete':
    case 'failed':
      return 3;
    default:
      return 4;
  }
}

function buildSidebarTasks(taskCenter: PetTaskCenter): SidebarTask[] {
  return [
    ...taskCenter.running.map((task) => ({
      ...task,
      updatedAt: Number.MAX_SAFE_INTEGER,
    })),
    ...taskCenter.queued.map((task) => ({
      ...task,
      updatedAt: Number.MAX_SAFE_INTEGER - 1,
    })),
    ...taskCenter.recent.map((task) => ({
      ...task,
      count: 1,
    })),
  ];
}

function activeTaskByProject(
  taskCenter: PetTaskCenter,
): Map<string, { status: ProjectDisplayStatus; count: number }> {
  const result = new Map<string, { status: ProjectDisplayStatus; count: number }>();
  for (const task of taskCenter.queued) {
    result.set(task.projectId, { status: 'queued', count: task.count });
  }
  for (const task of taskCenter.running) {
    result.set(task.projectId, { status: 'running', count: task.count });
  }
  return result;
}

function labelForStatus(status: SidebarTask['status'] | ProjectDisplayStatus, t: ReturnType<typeof useT>): string {
  switch (status) {
    case 'running':
      return t('pet.taskGroup.running');
    case 'queued':
    case 'not_started':
      return t('pet.taskGroup.queued');
    case 'awaiting_input':
      return t('designs.status.awaitingInput');
    case 'incomplete':
      return t('designs.status.incomplete');
    case 'failed':
      return t('designs.status.failed');
    case 'canceled':
      return t('designs.status.canceled');
    case 'succeeded':
      return t('tasks.filter.done');
    default:
      return t('workspaceTabs.project');
  }
}

export const ProjectSidebar = memo(function ProjectSidebar({
  route,
  projects,
  projectsLoading,
  taskCenter,
  onOpenProject,
  onNewProject,
  onOpenHome,
  onOpenProjects,
}: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [query, setQuery] = useState('');
  const [focusSearchAfterExpand, setFocusSearchAfterExpand] = useState(false);
  const [tabsSnapshot, setTabsSnapshot] = useState<WorkspaceTabsSnapshot>(readWorkspaceTabsSnapshot);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const activeProjectId = route.kind === 'project' ? route.projectId : null;

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // The sidebar remains usable when storage is unavailable.
    }
  }, [collapsed]);

  useEffect(() => {
    if (collapsed || !focusSearchAfterExpand) return;
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      setFocusSearchAfterExpand(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, focusSearchAfterExpand]);

  useEffect(() => {
    const handleTabsChanged = (event: Event) => {
      const snapshot = (event as CustomEvent<WorkspaceTabsSnapshot>).detail;
      setTabsSnapshot(snapshot ?? readWorkspaceTabsSnapshot());
    };
    window.addEventListener(WORKSPACE_TABS_STATE_CHANGED_EVENT, handleTabsChanged);
    return () => window.removeEventListener(WORKSPACE_TABS_STATE_CHANGED_EVENT, handleTabsChanged);
  }, []);

  const openProjectIds = useMemo(
    () => new Set(tabsSnapshot.openProjectIds),
    [tabsSnapshot.openProjectIds],
  );
  const activeTasksByProject = useMemo(
    () => activeTaskByProject(taskCenter),
    [taskCenter],
  );
  const needle = normalizeSearch(query);
  const visibleProjects = useMemo(() => {
    const filtered = needle
      ? projects.filter((project) => projectSearchText(project).includes(needle))
      : projects;
    return filtered.slice().sort((left, right) => {
      if (left.id === activeProjectId) return -1;
      if (right.id === activeProjectId) return 1;
      const leftTaskStatus = activeTasksByProject.get(left.id)?.status ?? left.status?.value;
      const rightTaskStatus = activeTasksByProject.get(right.id)?.status ?? right.status?.value;
      const statusDiff = statusRank(leftTaskStatus) - statusRank(rightTaskStatus);
      if (statusDiff !== 0) return statusDiff;
      const leftOpen = openProjectIds.has(left.id) ? 1 : 0;
      const rightOpen = openProjectIds.has(right.id) ? 1 : 0;
      if (leftOpen !== rightOpen) return rightOpen - leftOpen;
      return right.updatedAt - left.updatedAt;
    });
  }, [activeProjectId, activeTasksByProject, needle, openProjectIds, projects]);

  const visibleTasks = useMemo(() => {
    const tasks = buildSidebarTasks(taskCenter);
    if (!needle) return tasks;
    return tasks.filter((task) => task.projectName.toLocaleLowerCase().includes(needle));
  }, [needle, taskCenter]);

  const toggleCollapsed = () => {
    setCollapsed((current) => !current);
  };
  const openSearchFromRail = () => {
    setFocusSearchAfterExpand(true);
    setCollapsed(false);
  };

  return (
    <aside
      className={`${styles.root}${collapsed ? ` ${styles.collapsed}` : ''}`}
      data-project-sidebar
      data-testid="project-sidebar"
      aria-label={t('entry.navProjects')}
    >
      <div className={styles.header}>
        <Button
          variant="ghost"
          className={`${styles.brand} od-tooltip`}
          onClick={onOpenHome}
          title={t('entry.navHome')}
          data-tooltip={collapsed ? t('entry.navHome') : undefined}
          data-tooltip-placement="right"
        >
          <img className={styles.brandIcon} src="/app-icon.svg" alt="" draggable={false} />
          <span className={styles.brandName}>{t('app.brand')}</span>
          <VisuallyHidden>{t('entry.navHome')}</VisuallyHidden>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`${styles.collapseButton} od-tooltip`}
          onClick={toggleCollapsed}
          aria-label={collapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
          title={collapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
          data-tooltip={collapsed ? t('designFiles.expandGroup') : t('designFiles.collapseGroup')}
          data-tooltip-placement="right"
          data-testid="project-sidebar-toggle"
        >
          <Icon name={collapsed ? 'chevron-right' : 'panel-left'} size={PRIMARY_ICON_SIZE} />
        </Button>
      </div>

      <div className={styles.primaryActions}>
        <Button
          variant="subtle"
          className={`${styles.newProjectButton} od-tooltip`}
          onClick={onNewProject}
          title={t('entry.navNewProject')}
          data-tooltip={collapsed ? t('entry.navNewProject') : undefined}
          data-tooltip-placement="right"
        >
          <Icon name="plus" size={PRIMARY_ICON_SIZE} />
          <span className={styles.actionLabel}>{t('entry.navNewProject')}</span>
        </Button>
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className={`${styles.railSearchButton} od-tooltip`}
            onClick={openSearchFromRail}
            aria-label={t('common.search')}
            title={t('common.search')}
            data-tooltip={t('common.search')}
            data-tooltip-placement="right"
          >
            <Icon name="search" size={PRIMARY_ICON_SIZE} />
          </Button>
        ) : (
          <label className={styles.search}>
            <Icon name="search" size={SECONDARY_ICON_SIZE} />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('common.searchEllipsis')}
              aria-label={t('common.search')}
            />
          </label>
        )}
      </div>

      <div className={styles.scrollArea}>
        <section className={styles.section} aria-labelledby="project-sidebar-projects">
          <div className={styles.sectionHeader}>
            <Button
              variant="ghost"
              className={styles.sectionTitleButton}
              onClick={onOpenProjects}
              title={t('entry.navProjects')}
            >
              <span id="project-sidebar-projects">{t('entry.navProjects')}</span>
            </Button>
            <span className={styles.sectionCount}>{visibleProjects.length}</span>
          </div>
          <div className={styles.list}>
            {projectsLoading && projects.length === 0 ? (
              Array.from({ length: 4 }, (_, index) => (
                <div className={styles.skeletonRow} key={index} aria-hidden />
              ))
            ) : visibleProjects.length > 0 ? (
              visibleProjects.map((project) => {
                const active = project.id === activeProjectId;
                const open = openProjectIds.has(project.id);
                const activeTask = activeTasksByProject.get(project.id);
                const status = activeTask?.status ?? project.status?.value;
                const taskCount = activeTask?.count ?? 0;
                return (
                  <Button
                    key={project.id}
                    variant="ghost"
                    className={`${styles.projectRow}${active ? ` ${styles.activeRow}` : ''}${open ? ` ${styles.openRow}` : ''} od-tooltip`}
                    onClick={() => onOpenProject(project.id)}
                    aria-current={active ? 'page' : undefined}
                    title={project.name}
                    data-tooltip={collapsed ? project.name : undefined}
                    data-tooltip-placement="right"
                  >
                    <span className={styles.projectIcon} aria-hidden>
                      <Icon name={projectIcon(project)} size={PRIMARY_ICON_SIZE} />
                      {status ? <span className={`${styles.statusDot} ${styles[`status_${status}`]}`} /> : null}
                    </span>
                    <span className={styles.projectText}>
                      <span className={styles.projectName}>{project.name || t('common.untitled')}</span>
                      <span className={styles.projectMeta}>
                        {status ? labelForStatus(status, t) : t('workspaceTabs.project')}
                      </span>
                    </span>
                    {taskCount > 1 ? (
                      <span className={styles.taskCount} aria-label={`${taskCount}`}>
                        {taskCount}
                      </span>
                    ) : open ? (
                      <span className={styles.openIndicator} aria-hidden />
                    ) : null}
                  </Button>
                );
              })
            ) : (
              <div className={styles.empty}>{t('common.none')}</div>
            )}
          </div>
        </section>

        {visibleTasks.length > 0 ? (
          <section className={`${styles.section} ${styles.taskSection}`} aria-labelledby="project-sidebar-tasks">
            <div className={styles.sectionHeader}>
              <span id="project-sidebar-tasks" className={styles.sectionTitle}>{t('entry.navTasks')}</span>
              <span className={styles.sectionCount}>{visibleTasks.length}</span>
            </div>
            <div className={styles.list}>
              {visibleTasks.map((task) => (
                <Button
                  key={`${task.status}:${task.projectId}`}
                  variant="ghost"
                  className={`${styles.taskRow} od-tooltip`}
                  onClick={() => onOpenProject(task.projectId)}
                  title={task.projectName}
                  data-tooltip={collapsed ? task.projectName : undefined}
                  data-tooltip-placement="right"
                >
                  <span className={`${styles.taskStatusIcon} ${styles[`status_${task.status}`]}`} aria-hidden>
                    {task.status === 'running' ? (
                      <Icon name="spinner" size={SECONDARY_ICON_SIZE} />
                    ) : task.status === 'queued' ? (
                      <Icon name="history" size={SECONDARY_ICON_SIZE} />
                    ) : task.status === 'succeeded' ? (
                      <Icon name="check" size={SECONDARY_ICON_SIZE} />
                    ) : (
                      <Icon name="alert-triangle" size={SECONDARY_ICON_SIZE} />
                    )}
                  </span>
                  <span className={styles.projectText}>
                    <span className={styles.projectName}>{task.projectName}</span>
                    <span className={styles.projectMeta}>{labelForStatus(task.status, t)}</span>
                  </span>
                  {task.count > 1 ? <span className={styles.taskCount}>{task.count}</span> : null}
                </Button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <Button
        variant="ghost"
        className={`${styles.footer} od-tooltip`}
        onClick={onOpenProjects}
        title={t('entry.navProjects')}
        data-tooltip={collapsed ? t('entry.navProjects') : undefined}
        data-tooltip-placement="right"
      >
        <Icon name="folder" size={SECONDARY_ICON_SIZE} />
        <span className={styles.footerLabel}>
          {tabsSnapshot.openProjectIds.length} / {projects.length}
        </span>
      </Button>
    </aside>
  );
});
