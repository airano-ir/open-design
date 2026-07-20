// @vitest-environment jsdom
//
// Acceptance #54 / #59: opening a private project showed it as a read-only
// shell first — the personal avatar instead of the collab roster, 历史版本 and
// 分享 disabled — then filled in. `viewerOnly` fails closed while the workspace
// context is in flight, and this hook used to start that (vela-backed,
// seconds-long) read cold on every project open, even though the nav shell had
// already resolved the very same context.

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
  type WorkspaceCollabContext,
} from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectCollab } from '../src/collab/useProjectCollab';
import {
  resetWorkspaceContextCache,
  useWorkspaceContext,
} from '../src/collab/useWorkspaceContext';

function teamContext(): WorkspaceCollabContext {
  const role = 'member' as const;
  const lifecycleState = 'active' as const;
  return {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    workspaceMemberId: 'wm-1',
    role,
    memberStatus: 'active',
    lifecycleState,
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: buildWorkspaceSeatSummary({ seatLimit: 5, usedSeats: 1 }),
    permissions: buildWorkspacePermissions({ role, lifecycleState }),
    displayName: 'Ma Shu',
  };
}

/** A context read that never settles, so the only context available is the seed. */
function installNeverResolvingContextFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input), 'http://d.local').pathname;
    if (pathname.endsWith('/workspace/context')) return new Promise<Response>(() => {});
    return {
      ok: true,
      status: 200,
      json: async () => ({ publishedVersion: 1, syncState: 'local_only' }),
    } as unknown as Response;
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetWorkspaceContextCache();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  resetWorkspaceContextCache();
  vi.restoreAllMocks();
});

describe('useProjectCollab workspace-context seeding', () => {
  it('starts from the context the nav shell already resolved instead of a cold read', async () => {
    // The shell resolves the context once…
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), 'http://d.local').pathname;
      if (pathname.endsWith('/workspace/context')) {
        return { ok: true, status: 200, json: async () => ({ context: teamContext() }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    const shell = renderHook(() => useWorkspaceContext());
    await waitFor(() => {
      expect(shell.result.current.loading).toBe(false);
    });
    shell.unmount();

    // …and opening a project must not pay for that read again. With the context
    // request hanging forever, the hook is writable only if it used the seed.
    installNeverResolvingContextFetch();
    const project = renderHook(() => useProjectCollab('p-private'));

    await waitFor(() => {
      expect(project.result.current.viewerOnly).toBe(false);
    });
  });

  it('still fails closed on the first read of a session, before any context is known', async () => {
    installNeverResolvingContextFetch();
    const project = renderHook(() => useProjectCollab('p-private'));

    expect(project.result.current.viewerOnly).toBe(true);
  });

  it('does not inherit the shell cache when a test injects its own daemon', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), 'http://d.local').pathname;
      if (pathname.endsWith('/workspace/context')) {
        return { ok: true, status: 200, json: async () => ({ context: teamContext() }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    const shell = renderHook(() => useWorkspaceContext());
    await waitFor(() => {
      expect(shell.result.current.loading).toBe(false);
    });
    shell.unmount();

    const injected = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const project = renderHook(() => useProjectCollab('p-private', { fetch: injected }));

    expect(project.result.current.viewerOnly).toBe(true);
  });
});
