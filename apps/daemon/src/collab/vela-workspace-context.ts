import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
} from '@open-design/contracts';
import type {
  CollabMemberRole,
  WorkspaceBillingState,
  WorkspaceCollabContext,
  WorkspaceLifecycleState,
  WorkspaceMemberStatus,
  WorkspacePermissions,
  WorkspaceProviderMode,
  WorkspaceSeatSummary,
  WorkspaceType,
} from '@open-design/contracts';
import { readVelaControlApiContext } from '../integrations/vela.js';
import {
  createDevWorkspaceContextProvider,
  resolveWorkspaceSettingsUrl,
  type WorkspaceContextProvider,
  type WorkspaceContextRequest,
} from './workspace-context.js';

// Real B-integration provider (T2). The daemon reuses the SAME vela login session
// that AMR / the vela CLI use — `readVelaControlApiContext` reads the control key
// + api url from ~/.amr/config.json (or env) — and calls B's authoritative
// `GET /api/v1/workspaces/current`, which authenticates that session and returns
// the CurrentWorkspaceContext. No second identity: one vela session drives AMR,
// resource sharing, and the workspace context. Any failure (no session, signed
// out, B unreachable) degrades to null → collab stays single-player, never throws.

const WORKSPACE_CURRENT_PATH = '/api/v1/workspaces/current';
const DEFAULT_TIMEOUT_MS = 8_000;

const WORKSPACE_TYPES = new Set<WorkspaceType>(['personal', 'team']);
const ROLES = new Set<CollabMemberRole>(['owner', 'admin', 'member']);
const MEMBER_STATUSES = new Set<WorkspaceMemberStatus>(['active', 'removed']);
const LIFECYCLE_STATES = new Set<WorkspaceLifecycleState>([
  'active',
  'billing_past_due',
  'locked',
  'deleting',
  'deleted',
]);
const BILLING_STATES = new Set<WorkspaceBillingState>([
  'free',
  'active',
  'past_due',
  'canceled',
  'inactive',
  'locked',
]);
const PROVIDER_MODES = new Set<WorkspaceProviderMode>(['platform_credits', 'personal_byok']);

interface VelaWorkspaceContextOptions {
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to reading ~/.amr/config.json + env. */
  readSession?: typeof readVelaControlApiContext;
  timeoutMs?: number;
}

/**
 * Map B's `GET /api/v1/workspaces/current` body onto our WorkspaceCollabContext.
 * The shape is a faithful mirror of B's CurrentWorkspaceContext, so this is a
 * near pass-through with two adjustments:
 *  - `teamId` is derived as `workspaceId` for a team workspace: B has no separate
 *    team id — the workspace IS the team scope the resource hub keys resources by.
 *  - `permissions` / `seatSummary` are trusted from B when well-formed, and
 *    defensively re-derived (so read-only gating never breaks) if B omits them.
 * Returns null when a required field is missing or an enum is out of range —
 * collab then stays dormant rather than acting on a malformed context.
 */
export function mapVelaWorkspaceContext(input: unknown): WorkspaceCollabContext | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const workspaceId = str(raw.workspaceId);
  const workspaceMemberId = str(raw.workspaceMemberId);
  if (!workspaceId || !workspaceMemberId) return null;
  if (!WORKSPACE_TYPES.has(raw.workspaceType as WorkspaceType)) return null;
  if (!ROLES.has(raw.role as CollabMemberRole)) return null;
  if (!MEMBER_STATUSES.has(raw.memberStatus as WorkspaceMemberStatus)) return null;
  if (!LIFECYCLE_STATES.has(raw.lifecycleState as WorkspaceLifecycleState)) return null;
  if (!PROVIDER_MODES.has(raw.providerMode as WorkspaceProviderMode)) return null;

  const workspaceType = raw.workspaceType as WorkspaceType;
  const role = raw.role as CollabMemberRole;
  const memberStatus = raw.memberStatus as WorkspaceMemberStatus;
  const lifecycleState = raw.lifecycleState as WorkspaceLifecycleState;
  const billingState = BILLING_STATES.has(raw.billingState as WorkspaceBillingState)
    ? raw.billingState as WorkspaceBillingState
    : billingStateFromLifecycle(lifecycleState);

  const context: WorkspaceCollabContext = {
    workspaceId,
    workspaceType,
    workspaceMemberId,
    role,
    memberStatus,
    lifecycleState,
    billingState,
    planId: str(raw.planId) || null,
    providerMode: raw.providerMode as WorkspaceProviderMode,
    seatSummary: parseSeatSummary(raw.seatSummary),
    permissions:
      parsePermissions(raw.permissions) ??
      buildWorkspacePermissions({ role, lifecycleState, memberStatus }),
  };
  const billingRecovery = parseBillingRecovery(raw.billingRecovery);
  if (billingRecovery) context.billingRecovery = billingRecovery;
  const lastActive = str(raw.lastActiveWorkspaceId);
  if (lastActive) context.lastActiveWorkspaceId = lastActive;
  // The team workspace IS the team scope; carry its id as teamId so the resource
  // hub principal derives from this one context.
  if (workspaceType === 'team') {
    context.teamId = workspaceId;
    // Team management (members/billing/dashboard) is in the cloud console; carry
    // its URL (B's field when present, else built from OD_VELA_WEB_URL) so the
    // client's one settings entry links out to it.
    const settingsUrl = resolveWorkspaceSettingsUrl(
      workspaceId,
      (raw as { workspaceSettingsUrl?: unknown }).workspaceSettingsUrl,
    );
    if (settingsUrl) context.workspaceSettingsUrl = settingsUrl;
  }
  const displayName = str((raw as { displayName?: unknown }).displayName);
  if (displayName) context.displayName = displayName;
  return context;
}

/**
 * Provider that fetches the workspace context from B using the local vela
 * session. Swap this in for the dev stub once a B-backed vela is reachable.
 */
export function createVelaWorkspaceContextProvider(
  options: VelaWorkspaceContextOptions = {},
): WorkspaceContextProvider {
  const fetchImpl = options.fetch ?? fetch;
  const readSession = options.readSession ?? readVelaControlApiContext;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async current(_req: WorkspaceContextRequest): Promise<WorkspaceCollabContext | null> {
      const session = readSession();
      if (!session || !session.controlKey || !session.apiUrl) return null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(new URL(WORKSPACE_CURRENT_PATH, session.apiUrl), {
          method: 'GET',
          headers: { authorization: `Bearer ${session.controlKey}` },
          signal: controller.signal,
        });
        // 401 = signed out at the vela layer; anything non-2xx → single-player.
        if (!response.ok) return null;
        const body: unknown = await response.json();
        return mapVelaWorkspaceContext(body);
      } catch {
        // Never let a workspace-context failure throw into collab — degrade to
        // single-player. A transient B outage must not break the local editor.
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Select the workspace-context provider for this run. `OD_WORKSPACE_CONTEXT_SOURCE
 * =vela` opts into the real B-backed provider (production / e2e against a live
 * vela); every other value keeps the dev stub, so demo and tools-dev runs — which
 * have no B and drive the context via the dev PUT — are unaffected.
 */
export function createWorkspaceContextProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceContextProvider {
  if (env.OD_WORKSPACE_CONTEXT_SOURCE?.trim() === 'vela') {
    return createVelaWorkspaceContextProvider();
  }
  return createDevWorkspaceContextProvider();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function billingStateFromLifecycle(
  lifecycleState: WorkspaceLifecycleState,
): WorkspaceBillingState {
  if (lifecycleState === 'billing_past_due') return 'past_due';
  if (lifecycleState === 'locked') return 'locked';
  if (lifecycleState === 'deleting' || lifecycleState === 'deleted') {
    return 'inactive';
  }
  return 'active';
}

function parseSeatSummary(value: unknown): WorkspaceSeatSummary {
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (typeof raw.seatLimit === 'number' && typeof raw.usedSeats === 'number') {
      // Re-derive availableSeats/isSeatFull from the authoritative counts so a
      // stale or inconsistent summary can never disagree with itself.
      return buildWorkspaceSeatSummary({ seatLimit: raw.seatLimit, usedSeats: raw.usedSeats });
    }
  }
  return buildWorkspaceSeatSummary({ seatLimit: 0, usedSeats: 0 });
}

function parsePermissions(value: unknown): WorkspacePermissions | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const keys: (keyof WorkspacePermissions)[] = [
    'canManageMembers',
    'canManageBilling',
    'canInviteMembers',
    'canManageAutoRecharge',
    'canShareProjects',
    'canWriteSyncedFiles',
    'canViewWorkspaceSettings',
    'canManageSharedResources',
  ];
  const permissions = {} as WorkspacePermissions;
  for (const key of keys) {
    if (typeof raw[key] !== 'boolean') return null;
    permissions[key] = raw[key] as boolean;
  }
  return permissions;
}

function parseBillingRecovery(
  value: unknown,
): { canEnterBillingRecovery: boolean; recoveryUrl: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.canEnterBillingRecovery !== 'boolean') return null;
  return {
    canEnterBillingRecovery: raw.canEnterBillingRecovery,
    recoveryUrl: typeof raw.recoveryUrl === 'string' ? raw.recoveryUrl : null,
  };
}
