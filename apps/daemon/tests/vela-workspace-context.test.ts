import { describe, expect, it, vi } from 'vitest';
import {
  createVelaWorkspaceContextProvider,
  mapVelaWorkspaceContext,
} from '../src/collab/vela-workspace-context.js';

// A well-formed body as B's GET /api/v1/workspaces/current returns it — a team
// member on a BYOK provider (workspace features stay on regardless of provider).
const B_TEAM_CONTEXT = {
  userId: 'auth-user-1',
  appUserId: 'app-user-1',
  workspaceId: 'ws-team-1',
  workspaceType: 'team',
  workspaceMemberId: 'wm-1',
  role: 'member',
  memberStatus: 'active',
  lifecycleState: 'active',
  billingState: 'active',
  planId: 'team-pro',
  providerMode: 'personal_byok',
  seatSummary: { seatLimit: 5, usedSeats: 2, availableSeats: 3, isSeatFull: false },
  permissions: {
    canManageMembers: false,
    canManageBilling: false,
    canInviteMembers: false,
    canManageAutoRecharge: false,
    canShareProjects: true,
    canWriteSyncedFiles: true,
    canViewWorkspaceSettings: true,
    canManageSharedResources: false,
  },
  lastActiveWorkspaceId: 'ws-team-1',
};

const SESSION = { profile: 'prod', apiUrl: 'https://vela.example', controlKey: 'ck-1', user: null, configMtimeMs: null };

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('mapVelaWorkspaceContext', () => {
  it('maps a team context, deriving teamId from workspaceId and preserving BYOK', () => {
    const mapped = mapVelaWorkspaceContext(B_TEAM_CONTEXT);
    expect(mapped).not.toBeNull();
    // The team workspace IS the team scope → teamId mirrors workspaceId.
    expect(mapped?.teamId).toBe('ws-team-1');
    // BYOK provider must not disable team features — provider is carried verbatim.
    expect(mapped?.providerMode).toBe('personal_byok');
    // B's permissions are trusted (passed through), not re-derived.
    expect(mapped?.permissions.canWriteSyncedFiles).toBe(true);
    expect(mapped?.seatSummary).toEqual({ seatLimit: 5, usedSeats: 2, availableSeats: 3, isSeatFull: false });
    // B-only identity fields are dropped from the collab context.
    expect(mapped).not.toHaveProperty('userId');
    expect(mapped).not.toHaveProperty('appUserId');
  });

  it('does not attach teamId for a personal workspace', () => {
    const mapped = mapVelaWorkspaceContext({ ...B_TEAM_CONTEXT, workspaceType: 'personal' });
    expect(mapped?.workspaceType).toBe('personal');
    expect(mapped?.teamId).toBeUndefined();
  });

  it('re-derives an inconsistent seat summary from the authoritative counts', () => {
    const mapped = mapVelaWorkspaceContext({
      ...B_TEAM_CONTEXT,
      seatSummary: { seatLimit: 5, usedSeats: 5, availableSeats: 99, isSeatFull: false },
    });
    expect(mapped?.seatSummary).toEqual({ seatLimit: 5, usedSeats: 5, availableSeats: 0, isSeatFull: true });
  });

  it('accepts member contexts that hide billing-only fields', () => {
    const mapped = mapVelaWorkspaceContext({
      ...B_TEAM_CONTEXT,
      billingState: undefined,
      planId: undefined,
      seatSummary: undefined,
    });
    expect(mapped).not.toBeNull();
    expect(mapped?.billingState).toBe('active');
    expect(mapped?.planId).toBeNull();
    expect(mapped?.seatSummary).toEqual({ seatLimit: 0, usedSeats: 0, availableSeats: 0, isSeatFull: true });
    expect(mapped?.permissions.canShareProjects).toBe(true);
  });

  it('returns null on a bad enum or a missing id', () => {
    expect(mapVelaWorkspaceContext({ ...B_TEAM_CONTEXT, role: 'viewer' })).toBeNull();
    expect(mapVelaWorkspaceContext({ ...B_TEAM_CONTEXT, lifecycleState: 'frozen' })).toBeNull();
    expect(mapVelaWorkspaceContext({ ...B_TEAM_CONTEXT, workspaceMemberId: '' })).toBeNull();
    expect(mapVelaWorkspaceContext(null)).toBeNull();
  });
});

describe('createVelaWorkspaceContextProvider', () => {
  it('fetches B with the vela session bearer token and maps the result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, B_TEAM_CONTEXT)) as unknown as typeof fetch;
    const provider = createVelaWorkspaceContextProvider({
      fetch: fetchImpl,
      readSession: () => SESSION,
    });
    const context = await provider.current({});
    expect(context?.workspaceMemberId).toBe('wm-1');
    expect(context?.teamId).toBe('ws-team-1');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('https://vela.example/api/v1/workspaces/current');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer ck-1' });
  });

  it('returns null without calling B when there is no vela session', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, B_TEAM_CONTEXT)) as unknown as typeof fetch;
    const provider = createVelaWorkspaceContextProvider({ fetch: fetchImpl, readSession: () => null });
    expect(await provider.current({})).toBeNull();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('degrades to null on a 401 (signed out) or a network error', async () => {
    const unauthorized = createVelaWorkspaceContextProvider({
      fetch: (async () => jsonResponse(401, { error: 'unauthenticated' })) as unknown as typeof fetch,
      readSession: () => SESSION,
    });
    expect(await unauthorized.current({})).toBeNull();

    const broken = createVelaWorkspaceContextProvider({
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      readSession: () => SESSION,
    });
    expect(await broken.current({})).toBeNull();
  });
});
