export const WORKSPACE_TABS_STORAGE_KEY = 'open-design:workspace-tabs:v1';
export const WORKSPACE_TABS_STATE_CHANGED_EVENT = 'open-design:workspace-tabs:changed';

export interface WorkspaceTabsSnapshot {
  openProjectIds: string[];
  activeProjectId: string | null;
  openTabCount: number;
}

/**
 * Read only the navigation facts the project sidebar needs. Keeping this
 * projection separate from the WorkspaceTabsBar component lets app tests mock
 * the hidden legacy tab chrome without also mocking sidebar state.
 */
export function readWorkspaceTabsSnapshot(): WorkspaceTabsSnapshot {
  if (typeof window === 'undefined') {
    return { openProjectIds: [], activeProjectId: null, openTabCount: 0 };
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
    if (!raw) return { openProjectIds: [], activeProjectId: null, openTabCount: 0 };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((tab): tab is Record<string, unknown> => Boolean(tab && typeof tab === 'object'))
      : [];
    const openProjectIds = Array.from(new Set(tabs.flatMap((tab) =>
      tab.kind === 'project' && typeof tab.projectId === 'string' ? [tab.projectId] : [],
    )));
    const activeTab = typeof parsed.activeTabId === 'string'
      ? tabs.find((tab) => tab.id === parsed.activeTabId)
      : null;
    return {
      openProjectIds,
      activeProjectId: activeTab?.kind === 'project' && typeof activeTab.projectId === 'string'
        ? activeTab.projectId
        : null,
      openTabCount: tabs.length,
    };
  } catch {
    return { openProjectIds: [], activeProjectId: null, openTabCount: 0 };
  }
}
