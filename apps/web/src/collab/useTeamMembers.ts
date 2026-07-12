import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CollabCloudMemberDirectoryEntry,
  CollabCloudMembersResponse,
} from '@open-design/contracts';

// Poll cadence for the collab-cloud member directory. ~15s is light enough to
// keep a comment author's name / role fresh (a member registers on join) without
// a heavy loop; it mirrors `useTeamProjects`'s cadence. The read is daemon-local
// (the daemon caches the directory) so the poll just refetches the whole list.
const TEAM_MEMBERS_POLL_MS = 15_000;

export interface TeamMembersState {
  members: CollabCloudMemberDirectoryEntry[];
  /** memberId → directory entry, for O(1) author/owner resolution. */
  byId: Map<string, CollabCloudMemberDirectoryEntry>;
  /**
   * Turn an opaque `authorMemberId` / `ownerMemberId` into a `{displayName,
   * role}` entry, or null when the id is missing / not in the directory (off
   * team, or a member the daemon has not seen register yet). Callers fall back
   * to their existing id-only rendering on null.
   */
  resolve: (memberId: string | null | undefined) => CollabCloudMemberDirectoryEntry | null;
}

/**
 * Collab-cloud member directory read (`GET /api/workspace/members`). Returns the
 * team roster the client uses to render "琼羽 · Owner" on a comment card and the
 * owner name on the shared-project banner. Off-team / 404 degrades to an empty
 * map (never throws), so this is safe to mount unconditionally. Lightly polled so
 * a member who joins mid-session resolves without a refresh.
 */
export function useTeamMembers(): TeamMembersState {
  const [members, setMembers] = useState<CollabCloudMemberDirectoryEntry[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace/members');
      if (!res.ok) {
        if (mountedRef.current) setMembers([]);
        return;
      }
      const body = (await res.json()) as CollabCloudMembersResponse;
      if (mountedRef.current) setMembers(body.members ?? []);
    } catch {
      // Personal / offline / daemon without the collab cloud: no directory.
      if (mountedRef.current) setMembers([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, TEAM_MEMBERS_POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map<string, CollabCloudMemberDirectoryEntry>();
    for (const entry of members) map.set(entry.memberId, entry);
    return map;
  }, [members]);

  const resolve = useCallback(
    (memberId: string | null | undefined): CollabCloudMemberDirectoryEntry | null =>
      memberId ? byId.get(memberId) ?? null : null,
    [byId],
  );

  return { members, byId, resolve };
}
