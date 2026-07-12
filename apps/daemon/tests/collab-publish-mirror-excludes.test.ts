import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createResourceHubPublishAdapter } from '../src/collab/resource-hub-publish-adapter.js';
import type {
  ManifestEntryInput,
  PublishVersionInput,
  ResourceHubPrincipal,
  VersionRecord,
} from '../src/integrations/resource-hub.js';
import { packTree } from '../src/resource-drive.js';

// A member's read-only mirror must carry only the latest visible content — no
// author-only, daemon-internal directories. `.file-versions` is the concrete
// bug: it is the owner's version history and C spec §779 requires the member
// mirror to exclude it (observed on a member's disk before this fix).

const PRINCIPAL: ResourceHubPrincipal = {
  memberId: 'member_1',
  teamId: 'team_1',
  role: 'owner',
  lifecycleState: null,
};

function seedProjectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'collab-mirror-'));
  // Visible content that must sync unchanged.
  writeFileSync(path.join(dir, 'index.html'), '<h1>hello</h1>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}');
  // Author-only, internal directories that must NOT reach the member mirror.
  mkdirSync(path.join(dir, '.file-versions', 'index.html'), { recursive: true });
  writeFileSync(path.join(dir, '.file-versions', 'index.html', 'v1'), 'old');
  mkdirSync(path.join(dir, '.live-artifacts'), { recursive: true });
  writeFileSync(path.join(dir, '.live-artifacts', 'registry.json'), '{}');
  mkdirSync(path.join(dir, '.od-skills', 'deck'), { recursive: true });
  writeFileSync(path.join(dir, '.od-skills', 'deck', 'SKILL.md'), '# staged');
  return dir;
}

describe('packTree exclude option', () => {
  it('drops excluded directories and their subtrees, keeps everything else', async () => {
    const dir = seedProjectDir();
    const packed = await packTree(dir, {
      exclude: (name) => name === '.file-versions',
    });
    const paths = packed.entries.map((entry) => entry.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('assets');
    expect(paths).toContain('assets/app.css');
    // The whole `.file-versions` subtree is gone — not just the top dir.
    expect(paths.some((p) => p === '.file-versions' || p.startsWith('.file-versions/'))).toBe(false);
    // Non-excluded dotdirs still pass through the neutral SDK by default.
    expect(paths).toContain('.live-artifacts');
  });

  it('packs the full tree (including dotdirs) when no exclude is given', async () => {
    const dir = seedProjectDir();
    const packed = await packTree(dir);
    const paths = packed.entries.map((entry) => entry.path);
    expect(paths.some((p) => p.startsWith('.file-versions'))).toBe(true);
  });
});

describe('collab publish member mirror', () => {
  it('publishes visible content but never the author-only internal directories', async () => {
    const dir = seedProjectDir();
    let published: PublishVersionInput | null = null;

    const client = {
      async getResource() {
        return {
          id: 'res_1',
          teamId: 'team_1',
          kind: 'project',
          ownerMemberId: 'member_1',
          createdAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
        };
      },
      async findMissingBlobs(_principal: ResourceHubPrincipal, digests: string[]) {
        return digests; // pretend the store has nothing yet
      },
      async pushBlob() {
        /* accept every blob */
      },
      async publishVersion(
        _principal: ResourceHubPrincipal,
        _resourceId: string,
        input: PublishVersionInput,
      ): Promise<VersionRecord> {
        published = input;
        return {
          id: 'version_1',
          resourceId: 'res_1',
          version: 1,
          manifestDigest: input.manifestDigest,
          createdByMemberId: 'member_1',
          createdAt: '2026-01-01T00:00:00.000Z',
        };
      },
    };

    const adapter = createResourceHubPublishAdapter({
      // The fake only needs the methods publish() touches.
      client: client as never,
      getPrincipal: () => PRINCIPAL,
      resolveProjectDir: () => dir,
    });

    const result = await adapter.publish({ projectId: 'p1', reason: 'change' });
    expect(result).toEqual({ version: 1 });

    const entries = (published as unknown as PublishVersionInput | null)?.entries ?? [];
    const paths = entries.map((entry: ManifestEntryInput) => entry.path);
    // Visible content is synced verbatim.
    expect(paths).toContain('index.html');
    expect(paths).toContain('assets/app.css');
    // None of the author-only internal directories leak into the mirror.
    for (const excluded of ['.file-versions', '.live-artifacts', '.od-skills']) {
      expect(paths.some((p: string) => p === excluded || p.startsWith(`${excluded}/`))).toBe(false);
    }
  });
});
