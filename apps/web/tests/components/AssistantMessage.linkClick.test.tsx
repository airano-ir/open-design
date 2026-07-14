// @vitest-environment jsdom

/**
 * End-to-end coverage for chat file-link routing (issue #1239).
 *
 * Before this fix, every `<a>` rendered from chat markdown carried
 * `target="_blank"` with no `onClick`. In Electron that hits the desktop
 * `setWindowOpenHandler` and creates a new `od://` BrowserWindow; relative
 * hrefs like `template.html` have no base so the new window can't resolve
 * them and the user lands on the home screen. The fix detects in-project
 * file paths in chat markdown and routes them through the existing
 * `requestOpenFile` workspace tab opener.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

afterEach(() => {
  cleanup();
  // Cross-project link clicks navigate via history.pushState; reset the
  // jsdom URL so expectations don't leak between tests.
  window.history.replaceState(null, '', '/');
});

function messageWithText(text: string): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: text,
    events: [{ kind: 'text', text }],
    startedAt: 1_000,
    endedAt: 3_000,
    runStatus: 'succeeded',
  };
}

describe('AssistantMessage — chat file-link routing (#1239)', () => {
  it('routes a relative file-link click through onRequestOpenFile and suppresses the default new-window behavior', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Open [template.html](template.html) to preview.')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('template.html');

    // Dispatch a real DOM MouseEvent so defaultPrevented reflects what
    // Electron's setWindowOpenHandler actually reads.
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('template.html');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('normalizes ./ and nested subdirectory paths before opening', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Inspect [hero](./subdir/hero.html) section.')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor!);
    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('subdir/hero.html');
  });

  it('routes project raw file URLs through onRequestOpenFile instead of opening a new window', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Open [mutuals-v2.html](/api/projects/project-1/raw/mutuals-v2.html).')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/api/projects/project-1/raw/mutuals-v2.html');

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('mutuals-v2.html');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('navigates in-place to app file URLs for a different project instead of opening a new window', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Open [index.html](/projects/other-project/files/index.html).')}
        streaming={false}
        projectId="project-1"
        projectFileNames={new Set(['index.html'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    // Not the current workspace's file — but it IS an Open Design file, so
    // the click must route to the owning project in the SAME window rather
    // than falling through to Electron's window-open handler (which lands a
    // chrome-less child window on the home screen).
    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/projects/other-project/files/index.html');
  });

  it('navigates to the owning project for absolute managed-projects disk paths (0.14.1 acceptance scenario)', () => {
    // @-mentioned reference projects are handed to the agent as absolute
    // disk paths, so the assistant links their files as
    // `<data-root>/projects/<projectId>/<file>`. Clicking one must open
    // that project's file, not a new window on home.
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText(
          '只有一个文件：[deck-outline.md](/Users/mac/.open-design/data/projects/other-project/deck-outline.md)。',
        )}
        streaming={false}
        projectId="project-1"
        projectFileNames={new Set(['unrelated.html'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/projects/other-project/files/deck-outline.md');
  });

  it('suppresses unresolvable path-like links instead of opening a detached home window', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('参考实现：[bar.ts](/Users/mac/code/foo/bar.ts)。')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    // Nothing in the app can preview a path outside the managed projects
    // root; the ONLY wrong outcome is the default target="_blank" fallback,
    // which opens a new app window that renders home.
    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('routes same-origin absolute project raw URLs through onRequestOpenFile', () => {
    const onRequestOpenFile = vi.fn();
    const href = `${window.location.origin}/api/projects/project-1/raw/Web%20Prototype%20mutuals-v2.html`;
    const { container } = render(
      <AssistantMessage
        message={messageWithText(`Open [Web Prototype mutuals-v2.html](${href}).`)}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('Web Prototype mutuals-v2.html');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('routes local absolute paths without a projects boundary through onRequestOpenFile', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText(
          '已完成单文件原型：[index.html](/Users/mac/sites/web-prototype/index.html)。',
        )}
        streaming={false}
        projectId="project-1"
        projectFileNames={new Set(['index.html'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).toHaveBeenCalledTimes(1);
    expect(onRequestOpenFile).toHaveBeenCalledWith('index.html');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('navigates managed-looking disk paths to their named project even when the basename matches a current-project file', () => {
    // A `/projects/<segment>/` boundary claims an owning project, and that
    // claim outranks the current-project basename fallback: `index.html`
    // existing in the current project must not capture ANOTHER project's
    // `index.html` (silently previewing the wrong file). The cost is that a
    // legacy name-keyed directory (`projects/Web Prototype/` from 0.10.x
    // previews) now navigates to that name instead of basename-matching —
    // an in-window project-missing bounce at worst, never the detached
    // home window.
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText(
          '已完成单文件原型：[index.html](/Users/mac/open-design/open-design-preview-0.10.0/projects/Web%20Prototype/index.html)。',
        )}
        streaming={false}
        projectId="project-1"
        projectFileNames={new Set(['index.html'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);

    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(decodeURIComponent(window.location.pathname)).toBe(
      '/projects/Web Prototype/files/index.html',
    );
  });

  it('does not intercept external https:// URLs — preserves default target="_blank" behavior', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('See [docs](https://example.com/docs) for context.')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('does not intercept #anchor fragments', () => {
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Jump to [intro](#intro) of this page.')}
        streaming={false}
        projectId="project-1"
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor!);
    expect(onRequestOpenFile).not.toHaveBeenCalled();
  });

  it('swallows current-project file links when the host did not pass onRequestOpenFile', () => {
    // Some surfaces (e.g. the design-system chat in DesignSystemFlow)
    // intentionally do not pass `onRequestOpenFile`. There is no workspace
    // pane to open the file in, and the default target="_blank" fallback
    // would only produce the detached home-page window — so the click must
    // be swallowed, not left to the default behavior.
    const { container } = render(
      <AssistantMessage
        message={messageWithText('Open [template.html](template.html) to preview.')}
        streaming={false}
        projectId="project-1"
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('still navigates cross-project file routes when the host did not pass onRequestOpenFile', () => {
    // The cross-project navigation path must not be gated on the workspace
    // opener: a surface without one (design-system chat) can still show the
    // other project's file by navigating in the same window.
    const { container } = render(
      <AssistantMessage
        message={messageWithText(
          'See [index.html](/projects/other-project/files/index.html) in the reference project.',
        )}
        streaming={false}
        projectId="project-1"
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/projects/other-project/files/index.html');
  });

  it('still suppresses unresolvable path-like links when the host did not pass onRequestOpenFile', () => {
    const { container } = render(
      <AssistantMessage
        message={messageWithText('参考实现：[bar.ts](/Users/mac/code/foo/bar.ts)。')}
        streaming={false}
        projectId="project-1"
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/');
  });

  it('keeps default behavior for external URLs when the host did not pass onRequestOpenFile', () => {
    const { container } = render(
      <AssistantMessage
        message={messageWithText('See [docs](https://example.com/docs) for context.')}
        streaming={false}
        projectId="project-1"
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('routes a cross-project disk path away from a same-named current-project file', () => {
    // `index.html` exists in BOTH the current project and the linked
    // @-referenced project. The managed-projects disk path names its owning
    // project, so the click must navigate there — not open the current
    // project's same-named file through the workspace opener.
    const onRequestOpenFile = vi.fn();
    const { container } = render(
      <AssistantMessage
        message={messageWithText(
          '成稿在 [index.html](/Users/mac/.open-design/data/projects/other-project/index.html)。',
        )}
        streaming={false}
        projectId="project-1"
        projectFileNames={new Set(['index.html'])}
        onRequestOpenFile={onRequestOpenFile}
      />,
    );

    const anchor = container.querySelector('a.md-link');
    expect(anchor).not.toBeNull();
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor!.dispatchEvent(clickEvent);
    expect(onRequestOpenFile).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/projects/other-project/files/index.html');
  });
});
