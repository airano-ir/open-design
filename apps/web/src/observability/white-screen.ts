// White-screen detector.
//
// Fires `client_white_screen` when the app fails to mount after a
// generous timeout. The detection runs once at module load, sets a single
// timer, and (importantly) cancels itself the moment the React root mounts
// content — so a perfectly normal boot produces zero events.
//
// What counts as "mounted":
//   - The root container exists in the DOM, AND
//   - it has at least one child, AND
//   - its visible text exceeds a small floor (so a single "Loading…"
//     shell doesn't count as a successful mount).
//
// We do not try to discriminate between "still loading" and "white screen
// caused by a render error" — both are equally bad from the user's seat,
// and the latter usually accompanies a `$exception` we'll already have
// captured via `error-tracking.ts`.

import { reportSafetyEvent } from '../analytics/error-tracking';

const APP_MOUNT_TIMEOUT_MS = 5000;
// Below this floor we treat the root as still showing the skeleton shell
// (e.g. the dynamic import's loading sentinel "Loading Open Design…").
const MIN_VISIBLE_TEXT = 10;

export function installWhiteScreenDetector(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (typeof document === 'undefined') return () => undefined;

  let cancelled = false;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    if (isAppMounted()) return;
    reportSafetyEvent('client_white_screen', {
      reason: 'app_not_mounted_after_timeout',
      timeout_ms: APP_MOUNT_TIMEOUT_MS,
      ready_state: document.readyState,
      // Whether the user has navigated away from the tab — `hidden`
      // backgrounded tabs throttle setTimeout, so a "white screen" here
      // is much more likely an OS-side scheduling artifact than a real
      // mount failure. Surfacing it lets us filter the noise.
      visibility_state: document.visibilityState,
      body_child_count: document.body?.children.length ?? 0,
    });
  }, APP_MOUNT_TIMEOUT_MS);

  // Cancel the timer as soon as the app renders something meaningful.
  // `requestIdleCallback` (when available) batches the check so we don't
  // poll for every microtask; the fallback chain keeps it working in
  // Safari which still ships without rIC.
  const stopMonitor = monitorMount(() => {
    if (cancelled) return;
    cancelled = true;
    window.clearTimeout(timer);
  });

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    stopMonitor();
  };
}

function isAppMounted(): boolean {
  if (typeof document === 'undefined') return false;
  // The Next.js shell renders into the `__next` root. Falling back to
  // `document.body` keeps the check working in test harnesses that mount
  // into different containers.
  const root = document.getElementById('__next') ?? document.body;
  if (!root) return false;
  if (root.children.length === 0) return false;
  const text = (root.innerText ?? root.textContent ?? '').trim();
  if (text.length < MIN_VISIBLE_TEXT) return false;
  return true;
}

function monitorMount(onMounted: () => void): () => void {
  let stopped = false;
  const observer = new MutationObserver(() => {
    if (stopped) return;
    if (isAppMounted()) {
      stopped = true;
      observer.disconnect();
      onMounted();
    }
  });
  // Observe the whole body subtree — the React root is repeatedly
  // detached/reattached during hydration, so observing `#__next`
  // directly would stop firing the moment it gets replaced.
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  // Best-effort short-circuit: if the app is already mounted by the time
  // this hook runs (HMR, slow tab, etc.) we can fire immediately.
  if (isAppMounted()) {
    stopped = true;
    observer.disconnect();
    onMounted();
  }
  return () => {
    stopped = true;
    observer.disconnect();
  };
}
