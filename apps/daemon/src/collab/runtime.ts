// Team collaboration daemon subsystem: bundles the author-side publish
// scheduler and the presence tracker behind one factory so the server wires
// them once. The resource hub itself is E's (the resource-hub owner) — this holds only C's
// trigger + presence, talking to the hub through ResourcePublishAdapter.

import {
  CollabPresenceTracker,
  type CollabPresenceTrackerOptions,
  type PresenceMember,
} from './presence-tracker.js';
import {
  CollabPublishScheduler,
  type CollabPublishSchedulerOptions,
  type ResourcePublishAdapter,
} from './publish-scheduler.js';
import { createStubResourcePublishAdapter } from './stub-resource-adapter.js';
import {
  contextToResourceHubPrincipal,
  createResourceHubPublishAdapterFromEnv,
} from './resource-hub-publish-adapter.js';
import type { ResourceHubPrincipal } from '../integrations/resource-hub.js';
import {
  projectResourceIdFor,
  type VelaTeamProjectCatalogClient,
} from '../integrations/vela-team-projects.js';
import {
  contextHasTeamIdentity,
  createVelaCliResourceAdapter,
  shouldUseVelaCliResourceTransport,
} from './vela-cli-resource-adapter.js';
import type { WorkspaceContextProvider } from './workspace-context.js';
import { createWorkspaceContextProviderFromEnv } from './vela-workspace-context.js';
import {
  createDevTeamResourceStateProvider,
  type TeamResourceStateProvider,
} from './team-resource-state.js';
import type { ProjectSyncState } from '@open-design/contracts';

export interface CollabRuntime {
  presence: CollabPresenceTracker;
  scheduler: CollabPublishScheduler;
  /** Workspace-context provider — the B-integration seam (identity/visibility). */
  workspaceContext: WorkspaceContextProvider;
  /** Team-resource state provider — the E-resource-hub seam (share/freeze state). */
  teamResources: TeamResourceStateProvider;
  /** Last published version for a project (members poll this to know what to pull). */
  publishedVersion(projectId: string, principal?: ResourceHubPrincipal | null): number | null;
  /**  sync state for a project (`local_only` until a share is requested). */
  projectSyncState(projectId: string, principal?: ResourceHubPrincipal | null): ProjectSyncState;
  /**
   * visibility-to-sync sync-intent seam: mark a project as awaiting upload and flush a publish.
   * D calls this (through the route) when a project flips to team-visible; C
   * orchestrates the publish, which drives the resource hub mechanism behind it.
   * `ownerMemberId` is the sharer's member id — recorded so a member viewing the
   * project can tell whether it is their own (writer) or someone else's (read-only).
   */
  requestTeamShare(projectId: string, share?: string | ResourceHubPrincipal): void;
  /** The member who shared this project, or null if not shared here. */
  projectOwnerMemberId(projectId: string, principal?: ResourceHubPrincipal | null): string | null;
  /**
   * Member pull trigger (the sync trigger owns *when* to pull). Reads the published head via
   * the adapter (E's `syncLatest`); E's client also fetches + extracts the
   * bytes locally. Returns the head version, or null if nothing is published.
   */
  pullLatest(projectId: string, principal?: ResourceHubPrincipal | null): Promise<{ version: number | null }>;
  dispose(): void;
}

export interface CreateCollabRuntimeOptions {
  /**
   * Resource-hub adapter. Precedence: an explicit adapter → the real hub adapter
   * built from env (when `resolveProjectDir` is given and OD_RESOURCE_HUB_URL +
   * workspace member env are set) → the local stub.
   */
  adapter?: ResourcePublishAdapter;
  /** Managed-project directory resolver, so the real hub adapter can pack/land. */
  resolveProjectDir?: (projectId: string) => string;
  /** Workspace-context provider. Defaults to a dev provider until wired to an identity source. */
  workspaceContext?: WorkspaceContextProvider;
  /** Team-resource state provider. Defaults to a dev provider until wired to the hub. */
  teamResources?: TeamResourceStateProvider;
  /**
   * Vela-owned team-project catalog. The resource hub stores bytes/versions; the
   * catalog is the member-discovery index for projects shared from another
   * daemon. Missing config degrades through the client as a no-op.
   */
  teamProjectCatalog?: VelaTeamProjectCatalogClient;
  /** Fired after a project is published so the caller can notify online members. */
  onPublished?: (result: {
    projectId: string;
    version: number;
    reason: string;
    principal: ResourceHubPrincipal | null;
  }) => void;
  /** Fired when a project's presence set changes (join/leave). */
  onPresenceChange?: (result: { projectId: string; present: PresenceMember[] }) => void;
  onError?: (result: { projectId: string; error: unknown; principal: ResourceHubPrincipal | null }) => void;
}

/**
 * Pick the resource transport for this run. The `vela resource` CLI transport
 * (OD_RESOURCE_TRANSPORT=vela-cli) reuses the vela login session and keeps the
 * content-addressing in the CLI; otherwise the in-process hub SDK adapter runs.
 * Both gate on the same workspace context, so one identity drives either path.
 * Returns null when there is no project-dir resolver (caller falls back to the
 * local stub).
 */
function selectResourcePublishAdapter(
  resolveProjectDir: ((projectId: string) => string | Promise<string>) | undefined,
  workspaceContext: WorkspaceContextProvider,
  getProjectPrincipal: (projectId?: string) => ResourceHubPrincipal | null | Promise<ResourceHubPrincipal | null>,
): ResourcePublishAdapter | null {
  if (!resolveProjectDir) return null;
  if (shouldUseVelaCliResourceTransport()) {
    return createVelaCliResourceAdapter({
      resolveProjectDir,
      hasTeamIdentity: async () => contextHasTeamIdentity(await workspaceContext.current({})),
    });
  }
  return createResourceHubPublishAdapterFromEnv(resolveProjectDir, getProjectPrincipal);
}

export function createCollabRuntime(options: CreateCollabRuntimeOptions = {}): CollabRuntime {
  const workspaceContext = options.workspaceContext ?? createWorkspaceContextProviderFromEnv();
  const sharePrincipals = new Map<string, Map<string, ResourceHubPrincipal>>();
  const SCOPED_PROJECT_SEPARATOR = '\u0000';
  const scopedProjectKey = (projectId: string, principal: ResourceHubPrincipal) =>
    `${principal.teamId}${SCOPED_PROJECT_SEPARATOR}${projectId}`;
  const principalsForProject = (projectId: string) => [...(sharePrincipals.get(projectId)?.values() ?? [])];
  function parseScopedProjectKey(key: string) {
    const separatorIndex = key.indexOf(SCOPED_PROJECT_SEPARATOR);
    if (separatorIndex < 0) return { projectId: key, principal: null };
    const teamId = key.slice(0, separatorIndex);
    const projectId = key.slice(separatorIndex + SCOPED_PROJECT_SEPARATOR.length);
    return { projectId, principal: sharePrincipals.get(projectId)?.get(teamId) ?? null };
  }
  const getProjectPrincipal = async (projectId?: string) => {
    if (projectId) {
      const principal = principalsForProject(projectId)[0];
      if (principal) return principal;
    }
    return contextToResourceHubPrincipal(await workspaceContext.current({}));
  };
  // Single identity source: whichever transport runs, the team-identity gate
  // derives from the same workspace context the web collab surface reads, so one
  // signed-in identity drives both. Transport precedence: an explicit adapter →
  // the `vela resource` CLI transport when opted in (OD_RESOURCE_TRANSPORT=vela-cli)
  // → the in-process hub SDK adapter → the local stub.
  const baseAdapter =
    options.adapter ??
    selectResourcePublishAdapter(options.resolveProjectDir, workspaceContext, getProjectPrincipal) ??
    createStubResourcePublishAdapter();
  const schedulerAdapter: ResourcePublishAdapter = {
    async publish({ projectId: key, reason }) {
      const { projectId, principal } = parseScopedProjectKey(key);
      return baseAdapter.publish({
        projectId,
        reason,
        ...(principal ? { principal } : {}),
      });
    },
  };
  if (baseAdapter.syncLatest) {
    schedulerAdapter.syncLatest = ({ projectId: key }) => {
      const { projectId, principal } = parseScopedProjectKey(key);
      return baseAdapter.syncLatest!({
        projectId,
        ...(principal ? { principal } : {}),
      });
    };
  }
  if (baseAdapter.pull) {
    schedulerAdapter.pull = ({ projectId: key }) => {
      const { projectId, principal } = parseScopedProjectKey(key);
      return baseAdapter.pull!({
        projectId,
        ...(principal ? { principal } : {}),
      });
    };
  }
  const published = new Map<string, number>();
  const syncStates = new Map<string, ProjectSyncState>();
  // projectId → the member who shared it (the single writer). Members compare
  // this to their own id to know whether they view the project read-only.
  const owners = new Map<string, string>();
  const scopedOwners = new Map<string, string>();
  async function markTeamProject(
    projectId: string,
    syncState: 'pending_upload' | 'synced' | 'failed',
    principal?: ResourceHubPrincipal | null,
  ) {
    const principals = principal ? [principal] : principalsForProject(projectId);
    const targets = principals.length > 0 ? principals : [await getProjectPrincipal(projectId)].filter((principal): principal is ResourceHubPrincipal => Boolean(principal));
    for (const principal of targets) {
      await options.teamProjectCatalog?.upsert(
        {
          projectId,
          resourceId: projectResourceIdFor(projectId),
          syncState,
        },
        principal,
      );
    }
  }
  function markTeamProjectSoon(
    projectId: string,
    syncState: 'pending_upload' | 'synced' | 'failed',
    principal?: ResourceHubPrincipal | null,
  ) {
    void markTeamProject(projectId, syncState, principal).catch((error) => {
      const principals = principal ? [principal] : principalsForProject(projectId);
      if (principals.length === 0) {
        options.onError?.({ projectId, error, principal: null });
        return;
      }
      for (const principal of principals) options.onError?.({ projectId, error, principal });
    });
  }
  // Always track the published head + sync state so members can poll them; also
  // forward to any caller-supplied callback. (exactOptionalPropertyTypes forbids
  // assigning an explicit `undefined` to an optional property, hence we always
  // wrap onError rather than passing options.onError through conditionally.)
  const schedulerOptions: CollabPublishSchedulerOptions = {
    adapter: schedulerAdapter,
    onPublished: (result) => {
      const { projectId, principal } = parseScopedProjectKey(result.projectId);
      published.set(projectId, result.version);
      if (principal) published.set(scopedProjectKey(projectId, principal), result.version);
      syncStates.set(projectId, 'synced');
      if (principal) syncStates.set(scopedProjectKey(projectId, principal), 'synced');
      markTeamProjectSoon(projectId, 'synced', principal);
      options.onPublished?.({ ...result, projectId, principal });
    },
    onError: (result) => {
      // A failed publish leaves the prior head standing; surface it as a
      // recoverable sync state rather than wedging the project.
      const { projectId, principal } = parseScopedProjectKey(result.projectId);
      syncStates.set(projectId, 'sync_failed');
      if (principal) syncStates.set(scopedProjectKey(projectId, principal), 'sync_failed');
      markTeamProjectSoon(projectId, 'failed', principal);
      options.onError?.({ ...result, projectId, principal });
    },
  };
  const scheduler = new CollabPublishScheduler(schedulerOptions);
  const presenceOptions: CollabPresenceTrackerOptions = {};
  if (options.onPresenceChange) presenceOptions.onChange = options.onPresenceChange;
  const presence = new CollabPresenceTracker(presenceOptions);
  const teamResources = options.teamResources ?? createDevTeamResourceStateProvider();
  return {
    presence,
    scheduler,
    workspaceContext,
    teamResources,
    publishedVersion: (projectId, principal) => {
      if (principal) return published.get(scopedProjectKey(projectId, principal)) ?? null;
      return published.get(projectId) ?? null;
    },
    projectSyncState: (projectId, principal) => {
      if (principal) return syncStates.get(scopedProjectKey(projectId, principal)) ?? syncStates.get(projectId) ?? 'local_only';
      const states = principalsForProject(projectId)
        .map((principal) => syncStates.get(scopedProjectKey(projectId, principal)))
        .filter((state): state is ProjectSyncState => Boolean(state));
      if (states.includes('pending_upload')) return 'pending_upload';
      if (states.includes('sync_failed')) return 'sync_failed';
      if (states.includes('synced')) return 'synced';
      return syncStates.get(projectId) ?? 'local_only';
    },
    projectOwnerMemberId: (projectId, principal) => {
      if (principal) return scopedOwners.get(scopedProjectKey(projectId, principal)) ?? owners.get(projectId) ?? null;
      return owners.get(projectId) ?? null;
    },
    requestTeamShare(projectId, share) {
      // Record the sharer as the project's single writer so members can tell
      // apart their own project from one shared to them.
      if (typeof share === 'string') {
        owners.set(projectId, share);
      } else if (share) {
        owners.set(projectId, share.memberId);
        scopedOwners.set(scopedProjectKey(projectId, share), share.memberId);
        let principals = sharePrincipals.get(projectId);
        if (!principals) {
          principals = new Map();
          sharePrincipals.set(projectId, principals);
        }
        principals.set(share.teamId, share);
      }
      // Pending until the publish confirms (onPublished → 'synced' / onError →
      // 'sync_failed'). Flushing at a run boundary publishes the stable state.
      syncStates.set(projectId, 'pending_upload');
      if (share && typeof share !== 'string') {
        const key = scopedProjectKey(projectId, share);
        syncStates.set(key, 'pending_upload');
        markTeamProjectSoon(projectId, 'pending_upload', share);
        scheduler.notifyChanged(key, 'share');
        scheduler.runBoundary(key);
      } else {
        markTeamProjectSoon(projectId, 'pending_upload');
        scheduler.notifyChanged(projectId, 'share');
        scheduler.runBoundary(projectId);
      }
    },
    async pullLatest(projectId, principal) {
      // The real hub adapter materializes the published tree locally; the stub
      // has no bytes. Either way, report the head version.
      if (baseAdapter.pull) await baseAdapter.pull({ projectId, ...(principal ? { principal } : {}) });
      const head = baseAdapter.syncLatest
        ? await baseAdapter.syncLatest({ projectId, ...(principal ? { principal } : {}) })
        : { version: principal ? published.get(scopedProjectKey(projectId, principal)) ?? null : published.get(projectId) ?? null };
      return { version: head?.version ?? null };
    },
    dispose() {
      scheduler.dispose();
      presence.dispose();
    },
  };
}
