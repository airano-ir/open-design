import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  BlobDescriptor,
  Manifest,
  ManifestEntryInput,
  PrepareUploadResult,
  ResourceHubPrincipal,
} from '../src/integrations/resource-hub.js';
import {
  type PackedTree,
  computeManifestDigest,
  materializeTree,
  pushTree,
} from '../src/resource-drive.js';
import { createBlobCache, noopBlobCache } from '../src/resource-cache.js';

const principal: ResourceHubPrincipal = {
  memberId: 'm',
  teamId: 't',
  role: 'owner',
  lifecycleState: 'active',
};

const bytesOf = (s: string) => new TextEncoder().encode(s);
// Realistic-shaped digest (long lowercase hex) so the content-addressed cache,
// which validates the hex, accepts it. Opaque + unique per content otherwise.
const digestOf = (s: string) =>
  `sha256:${Buffer.from(s).toString('hex')}`;

// In-memory fake hub client + object store, recording how the drive calls it.
function fakeClient() {
  const store = new Map<string, Uint8Array>(); // committed blobs
  const staged = new Map<string, Uint8Array>(); // uploaded, awaiting commit
  const manifests = new Map<string, Manifest>();
  const calls = { prepare: 0, commit: 0, upload: 0, pull: 0, publish: 0 };
  let inFlight = 0;
  let maxInFlight = 0;

  const gate = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    await Promise.resolve();
    inFlight--;
  };

  const client = {
    async findMissingBlobs(_p: ResourceHubPrincipal, digests: string[]) {
      return digests.filter((d) => !store.has(d));
    },
    async prepareUpload(
      _p: ResourceHubPrincipal,
      blobs: BlobDescriptor[],
    ): Promise<PrepareUploadResult> {
      calls.prepare++;
      const missing = blobs.filter((b) => !store.has(b.digest));
      return {
        uploads: missing.map((b) => ({
          digest: b.digest,
          url: `mem://${b.digest}`,
          method: 'PUT',
          expiresInSeconds: 60,
        })),
        present: blobs.filter((b) => store.has(b.digest)).map((b) => b.digest),
        storeLive: true,
      };
    },
    async uploadBytes(upload: { url: string }, bytes: Uint8Array) {
      calls.upload++;
      await gate();
      staged.set(upload.url.replace('mem://', ''), bytes);
    },
    async commitUpload(_p: ResourceHubPrincipal, blobs: BlobDescriptor[]) {
      calls.commit++;
      for (const b of blobs) {
        const bytes = staged.get(b.digest);
        if (bytes) store.set(b.digest, bytes);
      }
    },
    async publishVersion(
      _p: ResourceHubPrincipal,
      resourceId: string,
      input: { manifestDigest: string; entries: ManifestEntryInput[] },
    ) {
      calls.publish++;
      manifests.set(input.manifestDigest, {
        digest: input.manifestDigest,
        entries: input.entries.map((e) => ({
          path: e.path,
          type: e.type,
          executable: e.executable ?? false,
          blobDigest: e.blobDigest ?? null,
          symlinkTarget: e.symlinkTarget ?? null,
        })),
      });
      return {
        id: 'v1',
        resourceId,
        version: 1,
        manifestDigest: input.manifestDigest,
        createdByMemberId: 'm',
        createdAt: '2026-07-09T00:00:00.000Z',
      };
    },
    async getManifest(_p: ResourceHubPrincipal, digest: string) {
      const m = manifests.get(digest);
      if (!m) throw new Error(`no manifest ${digest}`);
      return m;
    },
    async pullBlob(_p: ResourceHubPrincipal, digest: string) {
      calls.pull++;
      await gate();
      const bytes = store.get(digest);
      if (!bytes) throw new Error(`no blob ${digest}`);
      return bytes;
    },
  };
  return { client, store, calls, maxInFlight: () => maxInFlight };
}

// A packed tree of `n` files (paths a0..a{n-1}), each with distinct content.
function packOf(n: number): PackedTree {
  const entries: ManifestEntryInput[] = [];
  const blobs = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    const digest = digestOf(`content-${i}`);
    blobs.set(digest, bytesOf(`content-${i}`));
    entries.push({ path: `a${i}.txt`, type: 'file', blobDigest: digest });
  }
  return { manifestDigest: computeManifestDigest(entries), entries, blobs };
}

let tmp: string | null = null;
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('resource-cache', () => {
  it('round-trips bytes and misses on unknown / malformed digests', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'cache-'));
    const cache = createBlobCache(tmp);
    expect(await cache.get('sha256:deadbeef')).toBeNull();
    await cache.put('sha256:deadbeef', bytesOf('hi'));
    expect(new TextDecoder().decode((await cache.get('sha256:deadbeef'))!)).toBe('hi');
    expect(await cache.get('not-a-digest')).toBeNull(); // no colon -> no path
  });
});

describe('pushTree', () => {
  it('uploads missing blobs as ONE prepare + ONE commit, bounded-parallel', async () => {
    const { client, store, calls, maxInFlight } = fakeClient();
    const packed = packOf(20);

    await pushTree(client as never, principal, 'r1', packed, { concurrency: 4 });

    expect(calls.prepare).toBe(1); // batched, not per-blob
    expect(calls.commit).toBe(1);
    expect(calls.upload).toBe(20);
    expect(calls.publish).toBe(1);
    expect(store.size).toBe(20);
    expect(maxInFlight()).toBeLessThanOrEqual(4); // concurrency bound honored
  });

  it('re-push of an already-present tree uploads nothing', async () => {
    const { client, calls } = fakeClient();
    const packed = packOf(10);
    await pushTree(client as never, principal, 'r1', packed, {});
    await pushTree(client as never, principal, 'r1', packed, {});
    expect(calls.upload).toBe(10); // only the first push transferred bytes
    expect(calls.prepare).toBe(1); // 2nd push: nothing missing -> no prepare
    expect(calls.publish).toBe(2); // both pushes still publish a version
  });
});

describe('materializeTree', () => {
  it('writes byte-identical files and pulls each blob once (cold)', async () => {
    const { client } = fakeClient();
    const packed = packOf(8);
    await pushTree(client as never, principal, 'r1', packed, {});
    tmp = await mkdtemp(path.join(os.tmpdir(), 'mat-'));

    await materializeTree(client as never, principal, packed.manifestDigest, tmp);

    for (let i = 0; i < 8; i++) {
      expect(await readFile(path.join(tmp, `a${i}.txt`), 'utf8')).toBe(`content-${i}`);
    }
  });

  it('serves a warm cache without touching the network', async () => {
    const { client, calls } = fakeClient();
    const packed = packOf(6);
    tmp = await mkdtemp(path.join(os.tmpdir(), 'mat-'));
    const cache = createBlobCache(path.join(tmp, 'cache'));

    await pushTree(client as never, principal, 'r1', packed, { cache }); // seeds cache
    const pullsBefore = calls.pull;
    await materializeTree(client as never, principal, packed.manifestDigest, path.join(tmp, 'out'), {
      cache,
    });
    expect(calls.pull).toBe(pullsBefore); // zero pulls: every blob came from cache
  });

  it('falls back to pulls with the noop cache', async () => {
    const { client, calls } = fakeClient();
    const packed = packOf(5);
    await pushTree(client as never, principal, 'r1', packed, {});
    tmp = await mkdtemp(path.join(os.tmpdir(), 'mat-'));
    await materializeTree(client as never, principal, packed.manifestDigest, tmp, {
      cache: noopBlobCache,
    });
    expect(calls.pull).toBe(5);
  });
});
