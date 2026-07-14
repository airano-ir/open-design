/**
 * Decide whether a markdown link href in chat output should resolve to
 * an in-project file (opened in the right-pane workspace) or fall
 * through to the default browser link behavior (Electron
 * `setWindowOpenHandler` → new window).
 *
 * Chat output frequently contains references like
 * `[template.html](template.html)` or `[hero](subdir/hero.html)`. Those
 * are relative paths into the current project's file workspace; with
 * default `target="_blank"` they open a new Electron window with no
 * project context and land on the home screen. Routing them through
 * the existing `requestOpenFile` callback keeps the user in the same
 * project view and previews the file in the right pane.
 *
 * Returns the normalized file path when the href looks like an
 * in-project link, or `null` to let the default link behavior win.
 */
export function asInProjectFilePath(
  href: string | null | undefined,
  projectFileNames?: ReadonlySet<string>,
  projectId?: string | null,
): string | null {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return null;
  const normalizedHref = normalizeSameOriginHref(trimmed);
  const appRoute = extractAppProjectFileRoute(normalizedHref);
  if (appRoute) {
    if (projectId && appRoute.projectId !== projectId) return null;
    return normalizeProjectFilePath(appRoute.filePath);
  }
  const knownProjectFilePath = matchKnownProjectFilePath(normalizedHref, projectFileNames);
  if (knownProjectFilePath) return knownProjectFilePath;
  // RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) followed by `:`.
  // Catches http:, https:, mailto:, file:, od:, blob:, javascript:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith('/')) return null;
  const stripped = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  // Refuse any `..` segment so a relative path can't climb out of the
  // project root. Cheaper and safer than full path normalization, and
  // assistant chat output never emits `..` for legitimate file refs.
  if (stripped.split('/').some((segment) => segment === '..')) return null;
  return normalizeProjectFilePath(stripped);
}

/**
 * Where a chat file link should open.
 *
 * - `workspace-file`: a file of the CURRENT project — open it through the
 *   right-pane workspace tab opener (`requestOpenFile`).
 * - `project-file`: a file of ANOTHER Open Design project (typical when the
 *   conversation @-references other projects and the assistant links their
 *   files) — navigate to that project's file route in the same window.
 */
export type ChatFileLinkTarget =
  | { kind: 'workspace-file'; filePath: string }
  | { kind: 'project-file'; projectId: string; filePath: string };

/**
 * Resolve a chat markdown href to an in-app file target.
 *
 * Extends `asInProjectFilePath` (current-project resolution for relative
 * paths and known-file matches) with the two cross-project shapes the
 * assistant emits for @-referenced projects: app file routes for another
 * project, and absolute managed-projects disk paths
 * (`<data-root>/projects/<projectId>/<file>` — the daemon hands
 * referenced projects to the agent as absolute paths, so its links come
 * back the same way). Without this, those links fell through to the default
 * `target="_blank"` behavior, and Electron's window-open handler produced a
 * chrome-less child window whose unroutable path rendered the HOME screen
 * instead of the file (0.14.1 acceptance bug: chatpane file links opened a home-page window).
 *
 * Returns `null` when the href has no in-app file target (external URLs,
 * fragments, unresolvable paths).
 */
export function resolveChatFileLink(
  href: string | null | undefined,
  projectFileNames?: ReadonlySet<string>,
  projectId?: string | null,
): ChatFileLinkTarget | null {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalizedHref = normalizeSameOriginHref(trimmed);
  // Hrefs that name their owning project explicitly (app file routes and
  // managed-projects disk paths) are classified FIRST. They must never fall
  // through to the current-project basename fallback below: a cross-project
  // `/…/projects/other/index.html` would otherwise be captured by a
  // same-named file in the current project — common names like `index.html`
  // or `README.md` make that collision realistic — and silently open the
  // WRONG project's file.
  const appRoute = extractAppProjectFileRoute(normalizedHref);
  if (appRoute) {
    const filePath = normalizeProjectFilePath(appRoute.filePath);
    if (!filePath) return null;
    if (projectId && appRoute.projectId !== projectId) {
      return { kind: 'project-file', projectId: appRoute.projectId, filePath };
    }
    return { kind: 'workspace-file', filePath };
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalizedHref)) {
    const diskRoute = extractManagedProjectsDiskRoute(normalizedHref);
    if (diskRoute) {
      if (projectId && diskRoute.projectId === projectId) {
        // Same project even when the file doesn't appear in
        // `projectFileNames` (stale file list, or a file the agent just
        // wrote): still open it in the current workspace rather than
        // re-navigating to our own project.
        return { kind: 'workspace-file', filePath: diskRoute.filePath };
      }
      return { kind: 'project-file', projectId: diskRoute.projectId, filePath: diskRoute.filePath };
    }
  }
  // Everything else — relative paths, known-file basename matches, absolute
  // paths outside the managed projects root — resolves against the current
  // project only.
  const currentProjectPath = asInProjectFilePath(href, projectFileNames, projectId);
  if (currentProjectPath) return { kind: 'workspace-file', filePath: currentProjectPath };
  return null;
}

/**
 * Whether an unresolvable chat href still LOOKS like a file/route path —
 * i.e. it carries no scheme (after same-origin normalization) and is not a
 * same-document fragment. For these, the default `target="_blank"` fallback
 * can never do anything useful inside the app: Electron resolves the
 * relative/absolute path against the app origin and opens a detached window
 * whose SPA router lands on HOME. Callers should `preventDefault()` and
 * treat the link as inert instead (0.14.1 acceptance bug: chatpane file links opened a home-page window).
 */
export function isPathLikeChatHref(href: string | null | undefined): boolean {
  if (typeof href !== 'string') return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const normalizedHref = normalizeSameOriginHref(trimmed);
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedHref)) return false;
  // Daemon-served prefixes return real content (downloads, exports, baked
  // previews) rather than re-entering the SPA — keep their default link
  // behavior.
  if (isDaemonServedPath(normalizedHref)) return false;
  return true;
}

// Same-origin prefixes the daemon serves directly (see `apps/web/next.config.ts`
// rewrites and the daemon's static mounts). Opening these in a new window
// shows actual content, so they are neither file links nor SPA routes.
function isDaemonServedPath(path: string): boolean {
  return (
    path.startsWith('/api/') || path.startsWith('/artifacts/') || path.startsWith('/frames/')
  );
}

function normalizeSameOriginHref(href: string): string {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (typeof window === 'undefined' || !window.location?.origin) return href;
  try {
    const url = new URL(href);
    if (url.origin !== window.location.origin) return href;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

interface AppProjectFileRoute {
  projectId: string;
  filePath: string;
}

function extractAppProjectFileRoute(href: string): AppProjectFileRoute | null {
  const withoutHash = href.split('#')[0] ?? href;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  const patterns = [
    /^\/api\/projects\/([^/]+)\/raw\/(.+)$/i,
    /^\/api\/projects\/([^/]+)\/files\/(.+)$/i,
    /^\/projects\/([^/]+)\/files\/(.+)$/i,
    /^\/projects\/([^/]+)\/conversations\/[^/]+\/files\/(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(withoutQuery);
    if (!match?.[1] || !match[2]) continue;
    return {
      projectId: decodeRouteSegment(match[1]),
      filePath: match[2],
    };
  }
  return null;
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Extract `{ projectId, filePath }` from an absolute filesystem path into
 * the daemon's managed projects root (`<data-root>/projects/<id>/<file…>`).
 * The web app can't know the data root itself, so it keys on the first
 * `/projects/<segment>/` boundary — for managed projects the segment IS the
 * project id. False positives (a personal folder literally named
 * `projects`) degrade to the project-missing error + home bounce in the
 * SAME window, which is still strictly better than the detached home
 * window this path produced before.
 */
function extractManagedProjectsDiskRoute(
  href: string,
): { projectId: string; filePath: string } | null {
  if (!href.startsWith('/')) return null;
  // Daemon endpoints under /api (and static mounts) are URLs, not disk
  // paths — `/api/projects/<id>/export/…` must not be reinterpreted as a
  // managed-projects file.
  if (isDaemonServedPath(href)) return null;
  const withoutHash = href.split('#')[0] ?? href;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const match = /\/projects\/([^/]+)\/(.+)$/.exec(decoded);
  if (!match?.[1] || !match[2]) return null;
  const projectId = match[1];
  const filePath = match[2];
  // Same traversal guard as normalizeProjectFilePath: never hand the file
  // router a path that climbs out of the project root.
  if (projectId === '..' || filePath.split('/').some((segment) => segment === '..')) return null;
  return { projectId, filePath };
}

function matchKnownProjectFilePath(
  href: string,
  projectFileNames: ReadonlySet<string> | undefined,
): string | null {
  if (!projectFileNames || projectFileNames.size === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const normalized = normalizeProjectFilePath(href);
  if (!normalized) return null;
  if (projectFileNames.has(normalized)) return normalized;
  const matches = Array.from(projectFileNames)
    .filter((name) => normalized === name || normalized.endsWith(`/${name}`))
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

function normalizeProjectFilePath(path: string): string | null {
  // Strip query and fragment — the workspace tab opener takes a file
  // path, not a URL.
  const withoutHash = path.split('#')[0] ?? path;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  if (!withoutQuery) return null;
  // Chat markdown emits links as URL-encoded text (`Mock%20Page.html`
  // for a file named `Mock Page.html`, multi-byte sequences for
  // non-ASCII names). The workspace tab opener
  // (`requestOpenFile` → `FileWorkspace`) matches by literal on-disk
  // file name, so passing the encoded form silently misses the tab.
  // Decode after the literal `..` check so a `%2E%2E` smuggling
  // attempt cannot bypass the traversal guard, and re-check `..` on
  // the decoded form. Treat malformed encodings as "not a real
  // in-project link" rather than letting the URIError crash the
  // renderer.
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded.split('/').some((segment) => segment === '..')) return null;
  return decoded;
}
