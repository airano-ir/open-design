import type { TeamProject, WorkspaceCollabContext } from '@open-design/contracts';
import type { Project } from '../types';

/**
 * The card list behind the 全部项目 grid.
 *
 * The invariant: **every project the member can reach appears here** — their own
 * local projects whether or not those are shared, plus the projects teammates
 * shared to the hub, deduped by id. Sharing decides a card's badge and where it
 * can be opened from, never whether its owner can find it in the grid the nav
 * calls 全部项目.
 *
 * A shared project the member has not pulled yet has no local record, so it is
 * synthesized into a normal card: placeholder name until the pull registers it
 * under its real name, timestamps from when it was shared.
 *
 * Names follow the hub catalog for rows owned by SOMEONE ELSE (a pulled copy's
 * local name freezes at pull time, so an owner's rename would otherwise never
 * converge here). The member's own rows keep the local name — their fresh
 * rename may not have round-tripped to the catalog yet, and letting the stale
 * catalog name win would look like the rename bounced.
 */
export function buildAllProjectsList(input: {
  projects: Project[];
  teamProjects: TeamProject[];
  workspaceContext: WorkspaceCollabContext | null;
  /** Display name for a shared project that has no catalog name yet. */
  sharedFallbackName: string;
  now?: () => number;
}): Project[] {
  const { projects, teamProjects, workspaceContext, sharedFallbackName } = input;
  const now = input.now ?? Date.now;

  // A personal workspace has no hub side: the local list already IS everything.
  if (workspaceContext?.workspaceType === 'personal') return projects;

  const localProjectIds = new Set(projects.map((project) => project.id));
  const selfMemberId = workspaceContext?.workspaceMemberId ?? null;

  const catalogNameOverride = new Map(
    teamProjects
      .filter((teamProject) => teamProject.ownerMemberId !== selfMemberId)
      .map((teamProject) => [teamProject.projectId, teamProject.name?.trim() || '']),
  );

  const localCards = projects.map((project) => {
    const catalogName = catalogNameOverride.get(project.id);
    return catalogName && catalogName !== project.name ? { ...project, name: catalogName } : project;
  });

  const sharedCards: Project[] = teamProjects
    .filter((teamProject) => !localProjectIds.has(teamProject.projectId))
    .map((teamProject) => {
      const sharedAtMs = Date.parse(teamProject.sharedAt);
      const fallbackTimestamp = Number.isFinite(sharedAtMs) ? sharedAtMs : now();
      return {
        id: teamProject.projectId,
        name: teamProject.name?.trim() || sharedFallbackName,
        skillId: teamProject.skillId ?? null,
        designSystemId: teamProject.designSystemId ?? null,
        createdAt: typeof teamProject.createdAt === 'number' ? teamProject.createdAt : fallbackTimestamp,
        updatedAt: typeof teamProject.updatedAt === 'number' ? teamProject.updatedAt : fallbackTimestamp,
        ...(teamProject.metadata ? { metadata: teamProject.metadata } : {}),
      } satisfies Project;
    });

  return [...localCards, ...sharedCards];
}
