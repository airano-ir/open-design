import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Local content-addressed blob cache for the resource drive. A blob's bytes are
// immutable and named by their digest, so once a blob is on disk here we never
// have to pull it from the store again — pull/materialize become read-through.
// Modelled on git's object store / restic's local cache: shard by a digest
// prefix to keep directories small, write atomically (temp + rename) so a
// crashed write never leaves a truncated entry a reader could trust.
//
// v1 keeps everything (no GC). Blobs are content-addressed and shared across
// resources/teams, so the cache is pure upside; eviction is a later concern
// tied to a size budget.

export interface BlobCache {
  get(digest: string): Promise<Uint8Array | null>;
  put(digest: string, bytes: Uint8Array): Promise<void>;
}

// digest is "<algo>:<hex>". Lay it out as <root>/<algo>/<aa>/<rest> so a single
// directory never holds more than 256 shards.
function pathForDigest(root: string, digest: string): string | null {
  const sep = digest.indexOf(':');
  if (sep <= 0) return null;
  const algo = digest.slice(0, sep);
  const hex = digest.slice(sep + 1);
  if (!/^[0-9a-f]{4,}$/u.test(hex)) return null;
  return path.join(root, algo, hex.slice(0, 2), hex.slice(2));
}

export function createBlobCache(rootDir: string): BlobCache {
  return {
    async get(digest) {
      const file = pathForDigest(rootDir, digest);
      if (!file) return null;
      try {
        return new Uint8Array(await fsp.readFile(file));
      } catch {
        return null;
      }
    },
    async put(digest, bytes) {
      const file = pathForDigest(rootDir, digest);
      if (!file) return;
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${randomUUID()}`;
      try {
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, file);
      } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        // A cache write is best-effort — a full disk must not fail the transfer.
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return;
      }
    },
  };
}

// Disabled cache: every read misses, every write is dropped. Lets the drive
// treat "no cache configured" and "cache configured" through one code path.
export const noopBlobCache: BlobCache = {
  async get() {
    return null;
  },
  async put() {},
};
