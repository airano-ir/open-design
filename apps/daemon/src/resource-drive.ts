import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type {
  ManifestEntryInput,
  ResourceHubClient,
  ResourceHubPrincipal,
  VersionRecord,
} from './integrations/resource-hub.js';
import { type BlobCache, noopBlobCache } from './resource-cache.js';

// Neutral cloud-drive SDK over the resource hub. Kind-agnostic: it moves
// directory trees to/from the hub as content-addressed manifests + blobs, and
// knows nothing about design-systems / plugins / skills or WHEN to sync — that
// is the consumer's concern. Consumers build features ("share a design system")
// on top of these primitives; this layer stays a neutral cloud drive.

const DIGEST_ALGORITHM = 'sha256';

function digestBytes(bytes: Uint8Array): string {
  return `${DIGEST_ALGORITHM}:${createHash(DIGEST_ALGORITHM)
    .update(bytes)
    .digest('hex')}`;
}

export interface PackedTree {
  manifestDigest: string;
  entries: ManifestEntryInput[];
  // Content-addressed file bytes, deduped by digest — the blobs to upload.
  blobs: Map<string, Uint8Array>;
}

// Canonical manifest digest: sort entries by path and hash a stable
// serialization. The hub trusts (does not recompute) this digest, so the only
// requirement is that the daemon computes it deterministically.
export function computeManifestDigest(entries: ManifestEntryInput[]): string {
  const canonical = [...entries]
    .sort(byPath)
    .map((entry) =>
      [
        entry.type,
        entry.executable ? '1' : '0',
        entry.blobDigest ?? '',
        entry.symlinkTarget ?? '',
        entry.path,
      ].join('\t'),
    )
    .join('\n');
  return `${DIGEST_ALGORITHM}:${createHash(DIGEST_ALGORITHM)
    .update(canonical)
    .digest('hex')}`;
}

function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

// Blob byte transfer is the bottleneck for multi-file trees: each PUT/GET is an
// independent network round-trip to the object store, so they parallelize
// cleanly. Bound the fan-out so a large tree doesn't open hundreds of sockets
// at once (git-LFS / rclone use the same bounded-pool shape).
const DEFAULT_TRANSFER_CONCURRENCY = 8;

export interface TransferOptions {
  // Max concurrent blob PUT/GET in flight. Defaults to DEFAULT_TRANSFER_CONCURRENCY.
  concurrency?: number;
  // Local content-addressed cache; materialize reads through it and push
  // populates it, so re-pulling a known blob never hits the network.
  cache?: BlobCache;
}

// Run `fn` over `items` with at most `limit` invocations in flight. A fixed pool
// of workers drains a shared cursor — the daemon's house pattern for bounded
// concurrency (see inline-assets runWithConcurrency).
async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

// Walk a directory into a content-addressed tree. Paths are stored relative to
// rootDir with forward slashes (canonical). Directories are recorded explicitly
// so empty dirs survive; symlinks are stored by target without following.
export async function packTree(rootDir: string): Promise<PackedTree> {
  const entries: ManifestEntryInput[] = [];
  const blobs = new Map<string, Uint8Array>();

  async function walk(absDir: string, relDir: string): Promise<void> {
    const dirents = await fsp.readdir(absDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const abs = path.join(absDir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) {
        entries.push({
          path: rel,
          type: 'symlink',
          symlinkTarget: await fsp.readlink(abs),
        });
      } else if (dirent.isDirectory()) {
        entries.push({ path: rel, type: 'dir' });
        await walk(abs, rel);
      } else if (dirent.isFile()) {
        const bytes = new Uint8Array(await fsp.readFile(abs));
        const digest = digestBytes(bytes);
        if (!blobs.has(digest)) blobs.set(digest, bytes);
        const stat = await fsp.stat(abs);
        entries.push({
          path: rel,
          type: 'file',
          executable: (stat.mode & 0o111) !== 0,
          blobDigest: digest,
        });
      }
      // Other node types (sockets/fifos/devices) are not representable — skip.
    }
  }

  await walk(rootDir, '');
  return { manifestDigest: computeManifestDigest(entries), entries, blobs };
}

// Push a packed tree as a new version: upload only the blobs the store is
// missing, then publish. Optionally move a ref (with optimistic concurrency).
//
// The store already dedupes globally, so find-missing IS the delta: only blobs
// absent store-wide travel. Those upload as one batched prepare -> concurrent
// PUTs -> one batched commit (instead of a prepare/PUT/commit round-trip per
// blob, serially), the Bazel BatchUpdateBlobs / OCI-parallel-push shape.
export async function pushTree(
  client: ResourceHubClient,
  principal: ResourceHubPrincipal,
  resourceId: string,
  packed: PackedTree,
  options: {
    ref?: string;
    expectedVersionId?: string | null;
  } & TransferOptions = {},
): Promise<VersionRecord> {
  const cache = options.cache ?? noopBlobCache;
  const concurrency = options.concurrency ?? DEFAULT_TRANSFER_CONCURRENCY;

  const missing = await client.findMissingBlobs(principal, [
    ...packed.blobs.keys(),
  ]);
  const descriptors = missing
    .map((digest) => {
      const bytes = packed.blobs.get(digest);
      return bytes ? { digest, size: bytes.byteLength } : null;
    })
    .filter((d): d is { digest: string; size: number } => d !== null);

  if (descriptors.length > 0) {
    // One prepare for the whole batch: the store re-checks and only signs the
    // blobs it is still missing (present[] we skip).
    const prepared = await client.prepareUpload(principal, descriptors);
    await forEachLimit(prepared.uploads, concurrency, async (upload) => {
      const bytes = packed.blobs.get(upload.digest);
      if (!bytes) return;
      await client.uploadBytes(upload, bytes);
    });
    // One commit for the whole batch (the hub HEAD-verifies each object).
    await client.commitUpload(principal, descriptors);
    // Seed the local cache with what we just pushed so an immediate
    // materialize of this tree stays local.
    await forEachLimit(descriptors, concurrency, async ({ digest }) => {
      const bytes = packed.blobs.get(digest);
      if (bytes) await cache.put(digest, bytes);
    });
  }

  return client.publishVersion(principal, resourceId, {
    manifestDigest: packed.manifestDigest,
    entries: packed.entries,
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(options.expectedVersionId === undefined
      ? {}
      : { expectedVersionId: options.expectedVersionId }),
  });
}

// Materialize a manifest's tree into destDir. Pulls only file blobs. Uses a
// hardened join so a hostile path or symlink target cannot escape destDir
// (Spec E §2.7 safe landing).
//
// Structure (dirs + symlinks) lands first, in path order, so every parent
// exists before its children. File blobs then fetch concurrently, read through
// the local cache — a blob already on disk (from a prior pull or the push that
// created it) never touches the network.
export async function materializeTree(
  client: ResourceHubClient,
  principal: ResourceHubPrincipal,
  manifestDigest: string,
  destDir: string,
  options: TransferOptions = {},
): Promise<void> {
  const cache = options.cache ?? noopBlobCache;
  const concurrency = options.concurrency ?? DEFAULT_TRANSFER_CONCURRENCY;
  const manifest = await client.getManifest(principal, manifestDigest);
  const root = path.resolve(destDir);

  const files: { target: string; digest: string; executable: boolean }[] = [];
  // Sort by path so parent directories are created before their children.
  for (const entry of [...manifest.entries].sort(byPath)) {
    const target = safeJoin(root, entry.path);
    if (entry.type === 'dir') {
      await fsp.mkdir(target, { recursive: true });
    } else if (entry.type === 'symlink') {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      assertContained(
        root,
        path.resolve(path.dirname(target), entry.symlinkTarget ?? ''),
      );
      await fsp.symlink(entry.symlinkTarget ?? '', target);
    } else if (entry.type === 'file' && entry.blobDigest) {
      files.push({
        target,
        digest: entry.blobDigest,
        executable: entry.executable,
      });
    }
  }

  await forEachLimit(files, concurrency, async (file) => {
    let bytes = await cache.get(file.digest);
    if (!bytes) {
      bytes = await client.pullBlob(principal, file.digest);
      await cache.put(file.digest, bytes);
    }
    await fsp.mkdir(path.dirname(file.target), { recursive: true });
    await fsp.writeFile(file.target, bytes);
    if (file.executable) await fsp.chmod(file.target, 0o755);
  });
}

// Resolve a ref to its version's manifest and materialize it. Convenience over
// getRef + listVersions so consumers don't re-implement the lookup.
export async function materializeRef(
  client: ResourceHubClient,
  principal: ResourceHubPrincipal,
  resourceId: string,
  ref: string,
  destDir: string,
  options: TransferOptions = {},
): Promise<VersionRecord> {
  const refRecord = await client.getRef(principal, resourceId, ref);
  const versions = await client.listVersions(principal, resourceId);
  const version = versions.find((candidate) => candidate.id === refRecord.versionId);
  if (!version) {
    throw new Error(`ref ${ref} points at unknown version ${refRecord.versionId}`);
  }
  await materializeTree(client, principal, version.manifestDigest, destDir, options);
  return version;
}

function safeJoin(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  assertContained(root, resolved);
  return resolved;
}

function assertContained(root: string, resolved: string): void {
  const rel = path.relative(root, resolved);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`unsafe path escapes destination: ${resolved}`);
  }
}
