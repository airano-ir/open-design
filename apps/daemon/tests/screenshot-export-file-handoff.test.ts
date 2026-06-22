import type http from 'node:http';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DesktopRenderSlidesInput, DesktopRenderSlidesResult } from '@open-design/sidecar-proto';
import { startServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// Screenshot export — desktop renderer file handoff.
//
// The daemon hands the desktop renderer a scratch `outputDir` under the data
// root, the renderer writes image files there (instead of pushing base64
// through IPC), and the daemon reads them back and deletes the scratch dir.
// Exercised end-to-end at the HTTP boundary with a stub renderer standing in
// for the desktop runtime.
// ---------------------------------------------------------------------------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

describe('screenshot export desktop renderer file handoff', () => {
  let server: http.Server;
  let baseUrl: string;
  let exportRenderRoot: string;
  const projectId = 'proj-export-handoff';
  const seenDirs: string[] = [];

  // Stub desktop renderer: assert we were handed an outputDir, write the image
  // files there exactly like the real renderer's emitImages, return file paths.
  const stubRenderer = async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
    if (!input.outputDir) return { ok: false, error: 'expected an outputDir handoff' };
    seenDirs.push(input.outputDir);
    await mkdir(input.outputDir, { recursive: true });
    const file = path.join(input.outputDir, 'slide-0.png');
    await writeFile(file, PNG);
    return { ok: true, slideFiles: [file], width: 1920, height: 1080, mode: input.stitch ? 'deck' : 'page' };
  };

  const exportImage = () =>
    fetch(`${baseUrl}/api/projects/${projectId}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html' }),
    });

  beforeAll(async () => {
    const started = (await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: stubRenderer,
    })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;

    const dataDir = process.env.OD_DATA_DIR!;
    // The daemon derives the scratch dir from the realpath-resolved data root
    // (RUNTIME_DATA_DIR_CANONICAL); on macOS OD_DATA_DIR may contain a symlink
    // (/var -> /private/var), so resolve it the same way for the prefix check.
    exportRenderRoot = path.join(realpathSync(dataDir), 'export-render');
    const dir = path.join(dataDir, 'projects', projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<html><body><section class="slide">A</section></body></html>');
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('hands the renderer an outputDir under the data root and returns the image', async () => {
    const res = await exportImage();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic

    const used = seenDirs.at(-1)!;
    expect(used).toBeTruthy();
    expect(used.startsWith(exportRenderRoot + path.sep)).toBe(true);
  });

  it('deletes the scratch render dir after the export completes', async () => {
    const res = await exportImage();
    await res.arrayBuffer();
    const used = seenDirs.at(-1)!;
    // Cleanup runs in the handler's finally, after the response is flushed —
    // poll for eventual removal rather than asserting synchronously.
    expect(await waitFor(() => !existsSync(used))).toBe(true);
    const remaining = existsSync(exportRenderRoot) ? await readdir(exportRenderRoot) : [];
    expect(remaining.length).toBe(0);
  });

  it('gives each concurrent export its own scratch dir', async () => {
    const before = seenDirs.length;
    await Promise.all(Array.from({ length: 5 }, () => exportImage().then((r) => r.arrayBuffer())));
    const fresh = seenDirs.slice(before);
    expect(fresh.length).toBe(5);
    expect(new Set(fresh).size).toBe(5); // all unique — no collision across concurrent exports
  });
});
