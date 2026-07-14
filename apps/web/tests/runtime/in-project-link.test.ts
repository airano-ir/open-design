// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  asInProjectFilePath,
  isPathLikeChatHref,
  resolveChatFileLink,
} from '../../src/runtime/in-project-link';

describe('asInProjectFilePath', () => {
  describe('intercepts (returns normalized path)', () => {
    it('bare filename → unchanged', () => {
      expect(asInProjectFilePath('template.html')).toBe('template.html');
    });

    it('strips a leading ./ prefix', () => {
      expect(asInProjectFilePath('./template.html')).toBe('template.html');
    });

    it('keeps subdirectory paths intact', () => {
      expect(asInProjectFilePath('subdir/hero.html')).toBe('subdir/hero.html');
    });

    it('strips ./ in front of a subdirectory path', () => {
      expect(asInProjectFilePath('./subdir/hero.html')).toBe('subdir/hero.html');
    });

    it('drops a trailing query string', () => {
      expect(asInProjectFilePath('template.html?v=2')).toBe('template.html');
    });

    it('drops a trailing fragment', () => {
      expect(asInProjectFilePath('template.html#section')).toBe('template.html');
    });

    it('drops both query and fragment together', () => {
      expect(asInProjectFilePath('template.html?v=2#section')).toBe('template.html');
    });

    it('trims surrounding whitespace from the href', () => {
      expect(asInProjectFilePath('  template.html  ')).toBe('template.html');
    });

    it('handles the exact long filename shape from the issue screenshot', () => {
      expect(asInProjectFilePath('orbit-daily-digest-general-2026-05-11.html'))
        .toBe('orbit-daily-digest-general-2026-05-11.html');
    });

    it('decodes percent-encoded filenames so the workspace tab opener matches the on-disk file', () => {
      // Chat markdown frequently emits links like
      // `[Mock page](Mock%20Page.html)` because the autolink path
      // percent-encodes spaces. The workspace tab opener
      // (`requestOpenFile` → `FileWorkspace`) matches by literal
      // on-disk file name, so handing it the raw `Mock%20Page.html`
      // would silently miss the existing tab. Decode the result
      // before returning. Earlier draft PR #1255 hit this exact
      // miss in review (mrcfps / lefarcen P2).
      expect(asInProjectFilePath('Mock%20Page.html')).toBe('Mock Page.html');
    });

    it('decodes percent-encoded subdirectory paths', () => {
      expect(asInProjectFilePath('Visual%20Direction/hero%20alt.html')).toBe(
        'Visual Direction/hero alt.html',
      );
    });

    it('decodes non-ASCII (UTF-8 percent-encoded) filenames', () => {
      // Chinese / Cyrillic / accented filenames percent-encode into
      // multi-byte sequences. `decodeURIComponent` handles them
      // correctly; the catch arm below keeps malformed encodings
      // from throwing.
      expect(asInProjectFilePath('%E9%A6%96%E9%A1%B5.html')).toBe('首页.html');
    });

    it('extracts project raw file URLs produced by assistant file links', () => {
      expect(asInProjectFilePath('/api/projects/project-1/raw/mutuals-v2.html')).toBe('mutuals-v2.html');
    });

    it('extracts project raw file URLs only when the route project matches the current project', () => {
      expect(asInProjectFilePath('/api/projects/project-1/raw/mutuals-v2.html', undefined, 'project-1')).toBe(
        'mutuals-v2.html',
      );
      expect(asInProjectFilePath('/api/projects/other-project/raw/index.html', new Set(['index.html']), 'project-1'))
        .toBeNull();
    });

    it('extracts same-origin absolute project raw file URLs', () => {
      expect(asInProjectFilePath(`${window.location.origin}/api/projects/project-1/raw/mutuals-v2.html`)).toBe(
        'mutuals-v2.html',
      );
    });

    it('matches local absolute paths against known project files', () => {
      expect(
        asInProjectFilePath(
          '/Users/mac/open-design/open-design-preview-0.10.0/projects/Web%20Prototype/index.html',
          new Set(['index.html']),
        ),
      ).toBe('index.html');
    });

    it('keeps unknown local absolute paths as normal links', () => {
      expect(
        asInProjectFilePath(
          '/Users/mac/open-design/open-design-preview-0.10.0/projects/Web%20Prototype/index.html',
          new Set(['summary.html']),
        ),
      ).toBeNull();
    });

    it('extracts encoded project raw file paths with nested folders', () => {
      expect(asInProjectFilePath('/api/projects/project-1/raw/Web%20Prototype/mutuals-v2.html?v=2')).toBe(
        'Web Prototype/mutuals-v2.html',
      );
    });

    it('extracts project file routes from workspace links', () => {
      expect(asInProjectFilePath('/projects/project-1/files/mutuals-v2.html')).toBe('mutuals-v2.html');
      expect(asInProjectFilePath('/projects/project-1/conversations/conv-1/files/mutuals-v2.html')).toBe(
        'mutuals-v2.html',
      );
    });

    it('extracts workspace file routes only when the route project matches the current project', () => {
      expect(asInProjectFilePath('/projects/project-1/files/mutuals-v2.html', undefined, 'project-1')).toBe(
        'mutuals-v2.html',
      );
      expect(asInProjectFilePath('/projects/other-project/files/index.html', new Set(['index.html']), 'project-1'))
        .toBeNull();
    });

    it('returns null for malformed percent-encoding rather than throwing', () => {
      // A stray `%` (e.g. `Read%this.html` where the user meant a
      // literal percent) makes decodeURIComponent throw a URIError.
      // We never want a chat link to crash the renderer — fall
      // through to the default browser behavior instead.
      expect(asInProjectFilePath('Read%this.html')).toBeNull();
    });
  });

  describe('passes through (returns null) — external schemes', () => {
    it('http://', () => {
      expect(asInProjectFilePath('http://example.com/x')).toBeNull();
    });

    it('https://', () => {
      expect(asInProjectFilePath('https://example.com/x')).toBeNull();
    });

    it('mailto:', () => {
      expect(asInProjectFilePath('mailto:foo@bar.com')).toBeNull();
    });

    it('Electron od: protocol', () => {
      expect(asInProjectFilePath('od://app/projects/123')).toBeNull();
    });

    it('blob: URLs', () => {
      expect(asInProjectFilePath('blob:https://example.com/abc')).toBeNull();
    });

    it('file:// URLs (NOT in-project relative paths)', () => {
      expect(asInProjectFilePath('file:///etc/passwd')).toBeNull();
    });

    it('javascript: scheme is refused even though it matches the RFC grammar', () => {
      expect(asInProjectFilePath('javascript:alert(1)')).toBeNull();
    });
  });

  describe('passes through (returns null) — non-link or unsafe shapes', () => {
    it('null', () => {
      expect(asInProjectFilePath(null)).toBeNull();
    });

    it('undefined', () => {
      expect(asInProjectFilePath(undefined)).toBeNull();
    });

    it('empty string', () => {
      expect(asInProjectFilePath('')).toBeNull();
    });

    it('whitespace-only string', () => {
      expect(asInProjectFilePath('   ')).toBeNull();
    });

    it('#fragment-only — anchor within the same document', () => {
      expect(asInProjectFilePath('#section')).toBeNull();
    });

    it('absolute path starting with / — could mean filesystem root in Electron', () => {
      expect(asInProjectFilePath('/abs/path.html')).toBeNull();
    });

    it('parent-traversal `..` — refuses to climb out of the project root', () => {
      expect(asInProjectFilePath('..')).toBeNull();
    });

    it('relative path that walks up via .. — refused', () => {
      expect(asInProjectFilePath('../sibling.html')).toBeNull();
    });

    it('mid-path .. segment is still refused', () => {
      expect(asInProjectFilePath('a/../b.html')).toBeNull();
    });

    it('refuses a `..` segment smuggled in via percent-encoding (`%2E%2E`)', () => {
      // Decoding happens after the literal-`..` check; without an
      // additional post-decode check a hostile chat link could
      // bypass the traversal guard by writing `%2E%2E/secret.html`
      // and the workspace opener would receive `../secret.html`.
      expect(asInProjectFilePath('%2E%2E/secret.html')).toBeNull();
      expect(asInProjectFilePath('a/%2E%2E/b.html')).toBeNull();
    });
  });
});

describe('resolveChatFileLink (issue: chatpane file links opening a home-page window)', () => {
  describe('current-project targets (delegates to asInProjectFilePath)', () => {
    it('resolves a bare relative filename to a workspace file', () => {
      expect(resolveChatFileLink('template.html', undefined, 'project-1')).toEqual({
        kind: 'workspace-file',
        filePath: 'template.html',
      });
    });

    it('resolves a matching-route raw URL to a workspace file', () => {
      expect(
        resolveChatFileLink('/api/projects/project-1/raw/mutuals-v2.html', undefined, 'project-1'),
      ).toEqual({ kind: 'workspace-file', filePath: 'mutuals-v2.html' });
    });

    it('prefers the current project when a disk path names the current project', () => {
      // The `/projects/<seg>/` segment IS the current project id, so the
      // file opens in the current workspace — regardless of whether the
      // basename also appears in `projectFileNames`.
      expect(
        resolveChatFileLink(
          '/Users/mac/open-design/data/projects/project-1/index.html',
          new Set(['index.html']),
          'project-1',
        ),
      ).toEqual({ kind: 'workspace-file', filePath: 'index.html' });
    });

    it('still matches non-managed absolute paths against known project files', () => {
      // Absolute paths WITHOUT a `/projects/<seg>/` boundary keep the
      // known-file basename fallback (imported-folder projects reference
      // current-project files by external absolute path).
      expect(
        resolveChatFileLink(
          '/Users/mac/my-workspace/site/index.html',
          new Set(['index.html']),
          'project-1',
        ),
      ).toEqual({ kind: 'workspace-file', filePath: 'index.html' });
    });
  });

  describe('cross-project targets (the 0.14.1 acceptance scenario)', () => {
    it('resolves a workspace file route for another project instead of falling through', () => {
      expect(
        resolveChatFileLink('/projects/other-project/files/index.html', new Set(['index.html']), 'project-1'),
      ).toEqual({ kind: 'project-file', projectId: 'other-project', filePath: 'index.html' });
    });

    it('resolves a raw API route for another project instead of falling through', () => {
      expect(
        resolveChatFileLink('/api/projects/other-project/raw/deck-outline.md', undefined, 'project-1'),
      ).toEqual({ kind: 'project-file', projectId: 'other-project', filePath: 'deck-outline.md' });
    });

    it('routes a cross-project disk path to its owning project even when the basename collides with a current-project file', () => {
      // `index.html` exists in BOTH projects. The disk path names its owning
      // project explicitly, so the current-project basename fallback must
      // not capture it — that would silently open the WRONG project's file.
      expect(
        resolveChatFileLink(
          '/Users/mac/.open-design/data/projects/other-project/index.html',
          new Set(['index.html']),
          'project-1',
        ),
      ).toEqual({ kind: 'project-file', projectId: 'other-project', filePath: 'index.html' });
    });

    it('resolves an absolute managed-projects disk path to the owning project', () => {
      // The daemon tells the agent to reference @-mentioned projects by
      // absolute path (`chat-run-context.ts`), so chat links to their files
      // arrive as `<data-root>/projects/<projectId>/<file>`.
      expect(
        resolveChatFileLink(
          '/Users/mac/.open-design/data/projects/04d5e136-0cf2-4bf4/deck-outline.md',
          new Set(['unrelated.html']),
          'project-1',
        ),
      ).toEqual({
        kind: 'project-file',
        projectId: '04d5e136-0cf2-4bf4',
        filePath: 'deck-outline.md',
      });
    });

    it('decodes percent-encoded segments in disk paths', () => {
      expect(
        resolveChatFileLink(
          '/Users/mac/data/projects/Web%20Prototype/sub%20dir/hero.html',
          undefined,
          'project-1',
        ),
      ).toEqual({
        kind: 'project-file',
        projectId: 'Web Prototype',
        filePath: 'sub dir/hero.html',
      });
    });

    it('keeps nested file paths under the owning project', () => {
      expect(
        resolveChatFileLink('/data/projects/p2/assets/img/logo.svg', undefined, 'project-1'),
      ).toEqual({ kind: 'project-file', projectId: 'p2', filePath: 'assets/img/logo.svg' });
    });

    it('routes a disk path for the CURRENT project through the workspace opener even when the file list is stale', () => {
      expect(
        resolveChatFileLink('/data/projects/project-1/new-file.md', new Set(['other.html']), 'project-1'),
      ).toEqual({ kind: 'workspace-file', filePath: 'new-file.md' });
    });
  });

  describe('returns null (no in-app file target)', () => {
    it('external https URLs', () => {
      expect(resolveChatFileLink('https://example.com/docs', undefined, 'project-1')).toBeNull();
    });

    it('absolute paths without a managed projects segment', () => {
      expect(resolveChatFileLink('/Users/mac/code/foo/bar.ts', undefined, 'project-1')).toBeNull();
    });

    it('refuses traversal segments inside a disk-path file part', () => {
      expect(
        resolveChatFileLink('/data/projects/p2/%2E%2E/secret.html', undefined, 'project-1'),
      ).toBeNull();
    });

    it('fragment-only anchors', () => {
      expect(resolveChatFileLink('#intro', undefined, 'project-1')).toBeNull();
    });
  });
});

describe('isPathLikeChatHref (suppresses the detached home-window fallback)', () => {
  it('true for unresolvable absolute filesystem paths', () => {
    expect(isPathLikeChatHref('/Users/mac/code/foo/bar.ts')).toBe(true);
  });

  it('true for traversal-relative paths', () => {
    expect(isPathLikeChatHref('../sibling/file.md')).toBe(true);
  });

  it('true for malformed percent-encoded relative paths', () => {
    expect(isPathLikeChatHref('Read%this.html')).toBe(true);
  });

  it('true for same-origin app URLs (they reopen the SPA, not a document)', () => {
    expect(isPathLikeChatHref(`${window.location.origin}/deck-outline.md`)).toBe(true);
  });

  it('false for external http(s) URLs', () => {
    expect(isPathLikeChatHref('https://example.com/docs')).toBe(false);
    expect(isPathLikeChatHref('http://example.com/x')).toBe(false);
  });

  it('false for mailto: and other schemes', () => {
    expect(isPathLikeChatHref('mailto:foo@bar.com')).toBe(false);
    expect(isPathLikeChatHref('od://app/projects/123')).toBe(false);
    expect(isPathLikeChatHref('file:///etc/passwd')).toBe(false);
  });

  it('false for fragment-only anchors and empty hrefs', () => {
    expect(isPathLikeChatHref('#intro')).toBe(false);
    expect(isPathLikeChatHref('')).toBe(false);
    expect(isPathLikeChatHref('   ')).toBe(false);
  });
});
