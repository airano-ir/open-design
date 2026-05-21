import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  deleteBundleKey,
  listBundles,
  validateBundleKey,
  type BundleEntry,
  type BundlePublicationDigest,
  type BundleRef,
} from "@open-design/bundle";
import type {
  PackagedBundleClearSnapshot,
  PackagedBundleFetchSnapshot,
  PackagedBundleLocalAliasSnapshot,
  PackagedBundleLocalEntrySnapshot,
  PackagedBundleLocalSnapshot,
  PackagedBundlePresentationSnapshot,
} from "@open-design/sidecar-proto";

import type { PackagedNamespacePaths } from "./paths.js";

const PACKAGED_BUNDLE_SETTINGS_VERSION = 1;

export type PackagedBundleFetchedRecord = {
  artifact?: PackagedBundleFetchSnapshot["artifact"];
  importedAt: string;
  presentation?: PackagedBundlePresentationSnapshot;
  publication: {
    channel: string;
    digest: BundlePublicationDigest;
    pathKey: string;
    url: string;
    version: string;
    versionOrTag: string;
  };
  ref: BundleRef;
  selected: PackagedBundleFetchSnapshot["selected"];
};

type PackagedBundleKeySettings = {
  fetched: PackagedBundleFetchedRecord[];
};

type PackagedBundleSettingsFile = {
  keys: Record<string, PackagedBundleKeySettings>;
  schemaVersion: typeof PACKAGED_BUNDLE_SETTINGS_VERSION;
};

export function packagedBundleSettingsPath(paths: PackagedNamespacePaths): string {
  return join(paths.dataRoot, "settings", "bundle", "metadata.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDigest(value: unknown): BundlePublicationDigest | null {
  if (!isRecord(value) || value.algorithm !== "sha256") return null;
  const digest = stringField(value, "value");
  return digest == null ? null : { algorithm: "sha256", value: digest };
}

function parseBundleKey(value: string): string | null {
  try {
    return validateBundleKey(value);
  } catch {
    return null;
  }
}

function parsePresentation(value: unknown): PackagedBundlePresentationSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const channel = stringField(value, "channel");
  const version = stringField(value, "version");
  const display = isRecord(value.display) ? value.display : null;
  const displayVersion = display == null ? null : stringField(display, "version");
  if (channel == null || version == null || display == null || displayVersion == null) return undefined;
  return {
    channel,
    display: {
      summary: isRecord(display.summary) ? Object.fromEntries(
        Object.entries(display.summary).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ) : { default: "" },
      title: isRecord(display.title) ? Object.fromEntries(
        Object.entries(display.title).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ) : { default: "" },
      version: displayVersion,
    },
    version,
  };
}

function parseFetchedRecord(value: unknown): PackagedBundleFetchedRecord | null {
  if (!isRecord(value)) return null;
  const ref = isRecord(value.ref) ? value.ref : null;
  const publication = isRecord(value.publication) ? value.publication : null;
  const selected = isRecord(value.selected) ? value.selected : null;
  const artifact = isRecord(value.artifact) ? value.artifact : null;
  const key = ref == null ? null : stringField(ref, "key");
  const version = ref == null ? null : stringField(ref, "version");
  const importedAt = stringField(value, "importedAt");
  const channel = publication == null ? null : stringField(publication, "channel");
  const pathKey = publication == null ? null : stringField(publication, "pathKey");
  const publicationUrl = publication == null ? null : stringField(publication, "url");
  const publicationVersion = publication == null ? null : stringField(publication, "version");
  const versionOrTag = publication == null ? null : stringField(publication, "versionOrTag");
  const publicationDigest = publication == null ? null : parseDigest(publication.digest);
  const selectedPlatform = selected == null ? null : stringField(selected, "platform");
  const selectedVersion = selected == null ? null : stringField(selected, "version");
  const parsedKey = key == null ? null : parseBundleKey(key);
  if (
    parsedKey == null ||
    version == null ||
    importedAt == null ||
    channel == null ||
    pathKey == null ||
    publicationUrl == null ||
    publicationVersion == null ||
    versionOrTag == null ||
    publicationDigest == null ||
    selectedPlatform == null ||
    selectedVersion == null
  ) {
    return null;
  }

  const artifactDigest = artifact == null ? null : parseDigest(artifact.digest);
  const artifactUrl = artifact == null ? null : stringField(artifact, "url");
  const artifactSize = artifact == null ? undefined : artifact.size;
  const presentation = parsePresentation(value.presentation);
  return {
    ...(artifactDigest == null || artifactUrl == null
      ? {}
      : {
          artifact: {
            digest: artifactDigest,
            ...(typeof artifactSize === "number" ? { size: artifactSize } : {}),
            url: artifactUrl,
          },
        }),
    importedAt,
    ...(presentation == null ? {} : { presentation }),
    publication: {
      channel,
      digest: publicationDigest,
      pathKey,
      url: publicationUrl,
      version: publicationVersion,
      versionOrTag,
    },
    ref: { key: parsedKey, version },
    selected: { platform: selectedPlatform, version: selectedVersion },
  };
}

function emptySettings(): PackagedBundleSettingsFile {
  return { keys: {}, schemaVersion: PACKAGED_BUNDLE_SETTINGS_VERSION };
}

async function readSettings(paths: PackagedNamespacePaths): Promise<PackagedBundleSettingsFile> {
  const settingsPath = packagedBundleSettingsPath(paths);
  try {
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== PACKAGED_BUNDLE_SETTINGS_VERSION || !isRecord(raw.keys)) {
      return emptySettings();
    }
    const keys: Record<string, PackagedBundleKeySettings> = {};
    for (const [key, value] of Object.entries(raw.keys)) {
      const parsedKey = parseBundleKey(key);
      if (parsedKey == null) continue;
      if (!isRecord(value) || !Array.isArray(value.fetched)) continue;
      const fetched = value.fetched.flatMap((entry) => {
        const parsed = parseFetchedRecord(entry);
        return parsed == null ? [] : [parsed];
      });
      keys[parsedKey] = { fetched };
    }
    return { keys, schemaVersion: PACKAGED_BUNDLE_SETTINGS_VERSION };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySettings();
    throw error;
  }
}

async function writeSettings(paths: PackagedNamespacePaths, settings: PackagedBundleSettingsFile): Promise<void> {
  const settingsPath = packagedBundleSettingsPath(paths);
  await mkdir(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(tmp, settingsPath);
}

export async function recordFetchedPackagedBundle(
  paths: PackagedNamespacePaths,
  record: PackagedBundleFetchedRecord,
): Promise<void> {
  const key = validateBundleKey(record.ref.key);
  const settings = await readSettings(paths);
  const current = settings.keys[key]?.fetched ?? [];
  settings.keys[key] = {
    fetched: [
      ...current.filter((entry) =>
        entry.ref.version !== record.ref.version ||
        entry.publication.url !== record.publication.url ||
        entry.publication.versionOrTag !== record.publication.versionOrTag
      ),
      record,
    ].sort((left, right) => {
      const version = left.ref.version.localeCompare(right.ref.version);
      return version === 0 ? left.publication.versionOrTag.localeCompare(right.publication.versionOrTag) : version;
    }),
  };
  await writeSettings(paths, settings);
}

function fetchedRecordsByVersion(
  settings: PackagedBundleSettingsFile,
  key: string,
): Map<string, PackagedBundleFetchedRecord[]> {
  const map = new Map<string, PackagedBundleFetchedRecord[]>();
  for (const record of settings.keys[key]?.fetched ?? []) {
    const list = map.get(record.ref.version) ?? [];
    list.push(record);
    map.set(record.ref.version, list);
  }
  return map;
}

function aliasPath(record: PackagedBundleFetchedRecord, versionOrTag: string): string {
  return `public/${record.ref.key}/${record.publication.channel}/${versionOrTag}`;
}

function aliasesFor(records: PackagedBundleFetchedRecord[]): PackagedBundleLocalAliasSnapshot[] {
  const aliases = new Map<string, PackagedBundleLocalAliasSnapshot>();
  for (const record of records) {
    const concretePath = aliasPath(record, record.publication.version);
    aliases.set(concretePath, {
      label: record.publication.version,
      path: concretePath,
      publicationUrl: record.publication.url,
      version: record.ref.version,
    });
    const tagPath = aliasPath(record, record.publication.versionOrTag);
    aliases.set(tagPath, {
      label: record.publication.versionOrTag,
      path: tagPath,
      publicationUrl: record.publication.url,
      version: record.ref.version,
    });
  }
  return [...aliases.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function publicEntry(input: {
  active: boolean;
  aliases: PackagedBundleLocalAliasSnapshot[];
  entry: BundleEntry;
  records: PackagedBundleFetchedRecord[];
}): Extract<PackagedBundleLocalEntrySnapshot, { source: "public" }> {
  const latestRecord = input.records.at(-1);
  return {
    active: input.active,
    aliases: input.aliases,
    createdAt: input.entry.createdAt,
    digest: input.entry.digest,
    key: input.entry.ref.key,
    label: latestRecord?.presentation?.display.version ?? input.entry.ref.version,
    path: `public/${input.entry.ref.key}/${input.entry.ref.version}`,
    ...(latestRecord?.presentation == null ? {} : { presentation: latestRecord.presentation }),
    ...(latestRecord == null
      ? {}
      : {
          publication: {
            channel: latestRecord.publication.channel,
            digest: latestRecord.publication.digest,
            pathKey: latestRecord.publication.pathKey,
            url: latestRecord.publication.url,
            version: latestRecord.publication.version,
          },
        }),
    source: "public",
    version: input.entry.ref.version,
  };
}

export async function readPackagedBundleLocalSnapshot(input: {
  activeSource: "bundle" | "builtin";
  activeVersion?: string;
  key: string;
  paths: PackagedNamespacePaths;
}): Promise<PackagedBundleLocalSnapshot> {
  const key = validateBundleKey(input.key);
  const [settings, bundles] = await Promise.all([
    readSettings(input.paths),
    listBundles(input.paths.bundleBasePath),
  ]);
  const fetched = fetchedRecordsByVersion(settings, key);
  const publicEntries = bundles
    .filter((entry) => entry.ref.key === key)
    .map((entry) => {
      const records = fetched.get(entry.ref.version) ?? [];
      return publicEntry({
        active: input.activeSource === "bundle" && input.activeVersion === entry.ref.version,
        aliases: aliasesFor(records),
        entry,
        records,
      });
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  return {
    entries: [
      {
        active: input.activeSource === "builtin",
        key,
        label: "internal",
        path: "internal",
        source: "internal",
      },
      ...publicEntries,
    ],
    key,
    settingsPath: packagedBundleSettingsPath(input.paths),
    storePath: input.paths.bundleBasePath,
  };
}

export async function clearPackagedBundleKey(input: {
  key: string;
  paths: PackagedNamespacePaths;
}): Promise<PackagedBundleClearSnapshot> {
  const key = validateBundleKey(input.key);
  const settings = await readSettings(input.paths);
  const settingsCleared = settings.keys[key] != null;
  delete settings.keys[key];
  await writeSettings(input.paths, settings);
  const deleted = await deleteBundleKey({ basePath: input.paths.bundleBasePath, key });
  return { deleted, key, settingsCleared };
}
