// Cross-component intent for the inspiration picker's "browse a reference
// site" actions: the picker (deep inside a chat message) dispatches, and
// ProjectView — which owns the workspace's built-in Browser tabs — opens or
// foregrounds one. Same window-event pattern as runtime/home-intent.ts.
//
// The dispatcher returns whether a host handled the intent (listener calls
// preventDefault); callers fall back to window.open for surfaces without a
// workspace (e.g. a future standalone gallery).

export const INSPIRATION_BROWSE_INTENT_EVENT = 'open-design:inspiration-browse';

export interface InspirationBrowseIntentDetail {
  /** Stable per-site id so repeat clicks reuse one Browser tab. */
  siteId: string;
  url: string;
}

export function requestInspirationBrowse(detail: InspirationBrowseIntentDetail): boolean {
  if (typeof window === 'undefined') return false;
  const accepted = window.dispatchEvent(
    new CustomEvent<InspirationBrowseIntentDetail>(INSPIRATION_BROWSE_INTENT_EVENT, {
      detail,
      cancelable: true,
    }),
  );
  // A handling listener calls preventDefault(), which flips dispatchEvent's
  // return value to false.
  return !accepted;
}

export function subscribeInspirationBrowse(
  handler: (detail: InspirationBrowseIntentDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<InspirationBrowseIntentDetail>;
    if (!custom.detail || typeof custom.detail.url !== 'string') return;
    event.preventDefault();
    handler(custom.detail);
  };
  window.addEventListener(INSPIRATION_BROWSE_INTENT_EVENT, listener);
  return () => window.removeEventListener(INSPIRATION_BROWSE_INTENT_EVENT, listener);
}
