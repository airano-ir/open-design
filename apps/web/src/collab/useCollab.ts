import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CollabClient,
  type CollabClientOptions,
  type CollabPresenceMember,
  type CollabSnapshot,
} from './collab-client';

export interface UseCollabOptions {
  projectId: string | null | undefined;
  member: CollabPresenceMember | null | undefined;
  /** When false the client never starts (e.g. a solo, non-shared project). */
  enabled?: boolean;
  baseUrl?: string;
  heartbeatMs?: number;
  statusPollMs?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface UseCollabResult {
  present: CollabPresenceMember[];
  publishedVersion: number | null;
  syncState: CollabSnapshot['syncState'];
  ownerMemberId: CollabSnapshot['ownerMemberId'];
  ownerDisplayName: CollabSnapshot['ownerDisplayName'];
  ownerRole: CollabSnapshot['ownerRole'];
  reportChange: () => void;
  requestPublish: () => void;
  /** Member side — pull the published head into the local project directory. */
  pull: () => Promise<void>;
}

const EMPTY: CollabSnapshot = {
  present: [],
  publishedVersion: null,
  syncState: null,
  ownerMemberId: null,
  ownerDisplayName: null,
  ownerRole: null,
};

/**
 * React seam over {@link CollabClient} (C lane). Starts a presence heartbeat +
 * sync-status poll for the current shared project and re-renders as the present
 * set / published head version change. Members drive the read-only collab view
 * from this; the author additionally calls reportChange / requestPublish.
 */
export function useCollab(options: UseCollabOptions): UseCollabResult {
  const { projectId, member, enabled = true } = options;
  const [snapshot, setSnapshot] = useState<CollabSnapshot>(EMPTY);
  const clientRef = useRef<CollabClient | null>(null);

  const active = Boolean(enabled && projectId && member);
  // Restart only on identity changes, not on every render of a fresh member object.
  const memberKey = member
    ? JSON.stringify([
        member.memberId,
        member.name ?? '',
        member.role ?? '',
        member.filePath ?? '',
        member.activity ?? null,
      ])
    : '';

  useEffect(() => {
    if (!active || !projectId || !member) {
      setSnapshot(EMPTY);
      return;
    }
    const clientOptions: CollabClientOptions = { projectId, member, onUpdate: setSnapshot };
    if (options.baseUrl !== undefined) clientOptions.baseUrl = options.baseUrl;
    if (options.heartbeatMs !== undefined) clientOptions.heartbeatMs = options.heartbeatMs;
    if (options.statusPollMs !== undefined) clientOptions.statusPollMs = options.statusPollMs;
    if (options.fetch !== undefined) clientOptions.fetch = options.fetch;

    const client = new CollabClient(clientOptions);
    clientRef.current = client;
    client.start();
    // A hard tab close skips React unmount, so `stop()`'s fetch leave never
    // sends. `pagehide` fires on close/navigation and lets the client hand off a
    // beacon that survives the unload, so the present set drops promptly.
    const onPageHide = () => client.leaveBeacon();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      client.stop();
      clientRef.current = null;
      setSnapshot(EMPTY);
    };
    // memberKey stands in for `member`; fetch is intentionally not a restart trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId, memberKey, options.baseUrl, options.heartbeatMs, options.statusPollMs]);

  const reportChange = useCallback(() => {
    void clientRef.current?.reportChange();
  }, []);
  const requestPublish = useCallback(() => {
    void clientRef.current?.requestPublish();
  }, []);
  // Returns the promise (unlike reportChange/requestPublish) so the member
  // auto-pull can await a successful pull before advancing its version cursor.
  const pull = useCallback(async () => {
    await clientRef.current?.pull();
  }, []);

  return {
    present: snapshot.present,
    publishedVersion: snapshot.publishedVersion,
    syncState: snapshot.syncState,
    ownerMemberId: snapshot.ownerMemberId,
    ownerDisplayName: snapshot.ownerDisplayName,
    ownerRole: snapshot.ownerRole,
    reportChange,
    requestPublish,
    pull,
  };
}
