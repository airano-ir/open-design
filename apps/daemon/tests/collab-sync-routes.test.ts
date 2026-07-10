import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
  type WorkspaceCollabContext,
} from '@open-design/contracts';
import { createCollabRuntime, type CollabRuntime } from '../src/collab/runtime.js';
import type { WorkspaceContextProvider } from '../src/collab/workspace-context.js';
import { registerCollabSyncRoutes } from '../src/routes/collab-sync.js';

/** A fixed team context whose `canShareProjects` bit is forced to the tested
 *  value, served by a minimal provider (no `set` seam). */
function fixedShareContextProvider(canShareProjects: boolean): WorkspaceContextProvider {
  const context: WorkspaceCollabContext = {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role: 'member',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: buildWorkspaceSeatSummary({ seatLimit: 5, usedSeats: 1 }),
    permissions: {
      ...buildWorkspacePermissions({ role: 'member', lifecycleState: 'active' }),
      canShareProjects,
    },
  };
  return { current: async () => context };
}

let server: http.Server | null = null;
let runtime: CollabRuntime | null = null;

afterEach(async () => {
  runtime?.dispose(); // cancel any pending debounce timers
  runtime = null;
  if (server) {
    const toClose = server;
    server = null;
    await new Promise<void>((resolve) => toClose.close(() => resolve()));
  }
});

async function startSyncServer(workspaceContext?: WorkspaceContextProvider) {
  const app = express();
  app.use(express.json());
  runtime = createCollabRuntime(workspaceContext ? { workspaceContext } : {});
  registerCollabSyncRoutes(app, { collab: runtime });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    async json(route: string, options: { method?: string; body?: unknown } = {}) {
      const init: RequestInit = { method: options.method ?? 'GET' };
      if (options.body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(options.body);
      }
      const response = await fetch(`${base}${route}`, init);
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
    // Publishing is async (flush → adapter → onPublished); poll until it lands.
    async awaitPublishedVersion(route: string, notEqualTo: number | null): Promise<number | null> {
      let version = notEqualTo;
      for (let i = 0; i < 40 && version === notEqualTo; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        version = (await this.json(route)).body.publishedVersion;
      }
      return version;
    },
  };
}

describe('collab sync routes', () => {
  it('keeps publish callbacks scoped to every workspace sharing the same project', async () => {
    const onPublished = vi.fn();
    const publish = vi.fn(async (input: { principal?: { memberId?: string } }) => ({
      version: input.principal?.memberId === 'member-a' ? 11 : 22,
    }));
    runtime = createCollabRuntime({
      adapter: { publish },
      onPublished,
    });
    const projectId = 'shared-project';
    const workspaceA = {
      memberId: 'member-a',
      teamId: 'workspace-a',
      role: 'admin' as const,
      lifecycleState: 'active' as const,
    };
    const workspaceB = {
      memberId: 'member-b',
      teamId: 'workspace-b',
      role: 'admin' as const,
      lifecycleState: 'active' as const,
    };

    runtime.requestTeamShare(projectId, workspaceA);
    runtime.requestTeamShare(projectId, workspaceB);

    for (let i = 0; i < 40 && (publish.mock.calls.length < 2 || onPublished.mock.calls.length < 2); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((publish.mock.calls as unknown as Array<[Record<string, unknown>]>).map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId, principal: workspaceA }),
        expect.objectContaining({ projectId, principal: workspaceB }),
      ]),
    );
    expect(onPublished.mock.calls.map((call) => call[0]?.principal)).toEqual(
      expect.arrayContaining([workspaceA, workspaceB]),
    );
    expect(runtime.publishedVersion(projectId, workspaceA)).toBe(11);
    expect(runtime.publishedVersion(projectId, workspaceB)).toBe(22);
    expect(runtime.projectOwnerMemberId(projectId, workspaceA)).toBe('member-a');
    expect(runtime.projectOwnerMemberId(projectId, workspaceB)).toBe('member-b');

    publish.mockClear();
    onPublished.mockClear();
    runtime.scheduler.notifyChanged(projectId, 'save');
    runtime.scheduler.runBoundary(projectId);

    for (
      let i = 0;
      i < 40 &&
      (publish.mock.calls.length < 2 ||
        runtime.publishedVersion(projectId, workspaceA) === null ||
        runtime.publishedVersion(projectId, workspaceB) === null);
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((publish.mock.calls as unknown as Array<[Record<string, unknown>]>).map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId, reason: 'save', principal: workspaceA }),
        expect.objectContaining({ projectId, reason: 'save', principal: workspaceB }),
      ]),
    );
    expect(onPublished.mock.calls.map((call) => call[0]?.principal)).toEqual(
      expect.arrayContaining([workspaceA, workspaceB]),
    );
    expect(runtime.publishedVersion(projectId, workspaceA)).toBe(11);
    expect(runtime.publishedVersion(projectId, workspaceB)).toBe(22);
  });

  it('reports ordinary publish failures to every workspace sharing the same project', async () => {
    let failPublish = false;
    const onError = vi.fn();
    const publish = vi.fn(async (input: { principal?: { memberId?: string } }) => {
      if (failPublish) throw new Error('resource hub unavailable');
      return { version: input.principal?.memberId === 'member-a' ? 11 : 22 };
    });
    runtime = createCollabRuntime({
      adapter: { publish },
      onError,
    });
    const projectId = 'shared-project';
    const workspaceA = {
      memberId: 'member-a',
      teamId: 'workspace-a',
      role: 'admin' as const,
      lifecycleState: 'active' as const,
    };
    const workspaceB = {
      memberId: 'member-b',
      teamId: 'workspace-b',
      role: 'admin' as const,
      lifecycleState: 'active' as const,
    };

    runtime.requestTeamShare(projectId, workspaceA);
    runtime.requestTeamShare(projectId, workspaceB);

    for (
      let i = 0;
      i < 40 &&
      (publish.mock.calls.length < 2 ||
        runtime.publishedVersion(projectId, workspaceA) === null ||
        runtime.publishedVersion(projectId, workspaceB) === null);
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    publish.mockClear();
    onError.mockClear();

    failPublish = true;
    runtime.scheduler.notifyChanged(projectId, 'change');
    runtime.scheduler.runBoundary(projectId);

    for (
      let i = 0;
      i < 40 &&
      (onError.mock.calls.length < 2 ||
        runtime.projectSyncState(projectId, workspaceA) !== 'sync_failed' ||
        runtime.projectSyncState(projectId, workspaceB) !== 'sync_failed');
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(onError.mock.calls.map((call) => call[0]?.principal)).toEqual(
      expect.arrayContaining([workspaceA, workspaceB]),
    );
    expect(runtime.projectSyncState(projectId, workspaceA)).toBe('sync_failed');
    expect(runtime.projectSyncState(projectId, workspaceB)).toBe('sync_failed');
  });

  it('publishes on request and advances the published version monotonically', async () => {
    const api = await startSyncServer();
    expect((await api.json('/api/projects/p1/collab/status')).body.publishedVersion).toBeNull();

    const pub = await api.json('/api/projects/p1/collab/publish', { method: 'POST' });
    expect(pub.status).toBe(200);
    expect(pub.body.ok).toBe(true);

    const v1 = await api.awaitPublishedVersion('/api/projects/p1/collab/status', null);
    expect(v1).toBe(1);

    await api.json('/api/projects/p1/collab/publish', { method: 'POST' });
    const v2 = await api.awaitPublishedVersion('/api/projects/p1/collab/status', v1);
    expect(v2).toBe(2);
  });

  it('accepts a coalesced change notification', async () => {
    const api = await startSyncServer();
    const res = await api.json('/api/projects/p1/collab/changed', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('keeps published versions independent per project', async () => {
    const api = await startSyncServer();
    await api.json('/api/projects/a/collab/publish', { method: 'POST' });
    await api.awaitPublishedVersion('/api/projects/a/collab/status', null);
    expect((await api.json('/api/projects/b/collab/status')).body.publishedVersion).toBeNull();
  });

  it('reports local_only sync state before any share', async () => {
    const api = await startSyncServer();
    expect((await api.json('/api/projects/p1/collab/status')).body.syncState).toBe('local_only');
  });

  it('drives the visibility-to-sync team-share intent through to synced', async () => {
    const api = await startSyncServer();
    const intent = await api.json('/api/projects/p1/collab/sync-intent', {
      method: 'POST',
      body: { event: 'project_team_share_requested', projectId: 'p1' },
    });
    expect(intent.status).toBe(200);
    // The intent marks it pending immediately; the publish confirms asynchronously.
    expect(['pending_upload', 'synced']).toContain(intent.body.syncState);

    // Poll until the publish confirms → synced.
    let state = intent.body.syncState;
    for (let i = 0; i < 40 && state !== 'synced'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = (await api.json('/api/projects/p1/collab/status')).body.syncState;
    }
    expect(state).toBe('synced');
    expect((await api.json('/api/projects/p1/collab/status')).body.publishedVersion).toBe(1);
  });

  it('accepts a visibility-changed intent as a no-op signal', async () => {
    const api = await startSyncServer();
    const res = await api.json('/api/projects/p1/collab/sync-intent', {
      method: 'POST',
      body: { event: 'project_visibility_changed', projectId: 'p1' },
    });
    expect(res.status).toBe(200);
    expect(res.body.syncState).toBe('local_only'); // visibility change alone doesn't publish
  });

  it('rejects an unknown sync intent event', async () => {
    const api = await startSyncServer();
    const res = await api.json('/api/projects/p1/collab/sync-intent', {
      method: 'POST',
      body: { event: 'nonsense', projectId: 'p1' },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a team-share intent from a member without canShareProjects (server-side gate)', async () => {
    // The client hides the share affordance, but the daemon must not trust the
    // client — a member whose context lacks canShareProjects is refused (403),
    // and the project stays local_only (no publish is triggered).
    const api = await startSyncServer(fixedShareContextProvider(false));
    const res = await api.json('/api/projects/p1/collab/sync-intent', {
      method: 'POST',
      body: { event: 'project_team_share_requested', projectId: 'p1' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WORKSPACE_PROJECT_SHARE_DENIED');
    expect((await api.json('/api/projects/p1/collab/status')).body.syncState).toBe('local_only');
  });

  it('honors a team-share intent from a member with canShareProjects', async () => {
    const api = await startSyncServer(fixedShareContextProvider(true));
    const res = await api.json('/api/projects/p1/collab/sync-intent', {
      method: 'POST',
      body: { event: 'project_team_share_requested', projectId: 'p1' },
    });
    expect(res.status).toBe(200);
    expect(['pending_upload', 'synced']).toContain(res.body.syncState);
  });

  it('pulls the published head for a member (null before any publish)', async () => {
    const api = await startSyncServer();
    const before = await api.json('/api/projects/p1/collab/pull', { method: 'POST' });
    expect(before.status).toBe(200);
    expect(before.body.version).toBeNull();

    await api.json('/api/projects/p1/collab/publish', { method: 'POST' });
    await api.awaitPublishedVersion('/api/projects/p1/collab/status', null);
    const after = await api.json('/api/projects/p1/collab/pull', { method: 'POST' });
    expect(after.body.version).toBe(1);
  });
});
