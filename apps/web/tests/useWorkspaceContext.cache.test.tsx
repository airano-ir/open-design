// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceContext } from '../src/collab/useWorkspaceContext';

// A resolved workspace context. Shape is intentionally partial — the hook
// round-trips `body.context` verbatim, so the test only cares that the same
// value comes back.
const SIGNED_IN = { workspaceId: 'ws-1', teamName: 'Acme', workspaceType: 'team' };

function stubContextFetch(context: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ context }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('useWorkspaceContext module cache', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('seeds a remount from the last resolved context so returning home never flashes signed-out', async () => {
    stubContextFetch(SIGNED_IN);

    // First visit: starts null + loading, then resolves to the signed-in context.
    const first = renderHook(() => useWorkspaceContext());
    expect(first.result.current.context).toBeNull();
    await waitFor(() => expect(first.result.current.context).toEqual(SIGNED_IN));
    first.unmount();

    // Returning home remounts the hook. Its VERY FIRST render must already carry
    // the cached context — not null/loading — so the nav rail never paints the
    // signed-out state while the background revalidation is in flight.
    const second = renderHook(() => useWorkspaceContext());
    expect(second.result.current.context).toEqual(SIGNED_IN);
    expect(second.result.current.loading).toBe(false);
    second.unmount();
  });
});
