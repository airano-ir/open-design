import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addBundle, listBundles } from "@open-design/bundle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPackagedBundleKey,
  packagedBundleSettingsPath,
  readPackagedBundleLocalSnapshot,
  recordFetchedPackagedBundle,
} from "../src/bundle-settings.js";
import { PACKAGED_WEB_SIDECAR_BUNDLE_KEY } from "../src/bundle-activation.js";
import type { PackagedNamespacePaths } from "../src/paths.js";

let roots: string[] = [];

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `od-packaged-bundle-settings-${label}-${process.pid}-${Date.now()}-${roots.length}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

function fakePaths(root: string): PackagedNamespacePaths {
  return {
    bundleActivationPath: join(root, "data", "bundle-activation.json"),
    bundleBasePath: join(root, "data", "bundles"),
    cacheRoot: join(root, "cache"),
    dataRoot: join(root, "data"),
    desktopIdentityPath: join(root, "runtime", "desktop-root.json"),
    desktopLogPath: join(root, "logs", "desktop", "latest.log"),
    desktopLogsRoot: join(root, "logs", "desktop"),
    electronSessionDataRoot: join(root, "user-data", "session"),
    electronUserDataRoot: join(root, "user-data"),
    headlessIdentityPath: join(root, "runtime", "headless-root.json"),
    logsRoot: join(root, "logs"),
    namespaceRoot: root,
    resourceRoot: join(root, "resources"),
    runtimeRoot: join(root, "runtime"),
    updateRoot: join(root, "updates"),
    webIdentityPath: join(root, "runtime", "web-root.json"),
  };
}

async function makeWebBundleSource(label: string, version: string): Promise<string> {
  const source = await tempRoot(label);
  await mkdir(join(source, "sidecar"), { recursive: true });
  await writeFile(join(source, "sidecar", "index.mjs"), "export const marker = 'bundle';\n", "utf8");
  await mkdir(join(source, "web", "standalone"), { recursive: true });
  await writeFile(join(source, "web", "standalone", "server.js"), "console.log('standalone');\n", "utf8");
  await writeFile(join(source, "bundle.json"), `${JSON.stringify({
    entry: { kind: "js", path: "sidecar/index.mjs" },
    key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
    schemaVersion: 2,
    version,
    web: { outputMode: "standalone", standaloneRoot: "web/standalone" },
  }, null, 2)}\n`, "utf8");
  return source;
}

beforeEach(() => {
  roots = [];
});

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("packaged bundle settings", () => {
  it("keeps bundle facts in the store and aliases in settings", async () => {
    const root = await tempRoot("local");
    const paths = fakePaths(root);
    const version = "0.8.0-beta.4.web.1";
    const source = await makeWebBundleSource("source", version);
    await addBundle({
      basePath: paths.bundleBasePath,
      ref: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version },
      sourcePath: source,
    });
    await recordFetchedPackagedBundle(paths, {
      artifact: {
        digest: { algorithm: "sha256", value: "a".repeat(64) },
        size: 123,
        url: "https://example.com/bundle.tar",
      },
      importedAt: "2026-05-21T00:00:00.000Z",
      presentation: {
        channel: "beta",
        display: {
          summary: { default: "Web bundle" },
          title: { default: "Web" },
          version: "Beta 4 web 1",
        },
        version: "0.8.0-beta.4",
      },
      publication: {
        channel: "beta",
        digest: { algorithm: "sha256", value: "b".repeat(64) },
        pathKey: "od-sidecar-web",
        url: "https://example.com/od-sidecar-web/beta/latest/publication.json",
        version: "0.8.0-beta.4",
        versionOrTag: "latest",
      },
      ref: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version },
      selected: { platform: "any", version },
    });

    const local = await readPackagedBundleLocalSnapshot({
      activeSource: "bundle",
      activeVersion: version,
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      paths,
    });

    expect(local.storePath).toBe(paths.bundleBasePath);
    expect(local.settingsPath).toContain(join("settings", "bundle", "metadata.json"));
    expect(local.entries[0]).toMatchObject({ active: false, path: "internal", source: "internal" });
    expect(local.entries[1]).toMatchObject({
      active: true,
      label: "Beta 4 web 1",
      path: `public/${PACKAGED_WEB_SIDECAR_BUNDLE_KEY}/${version}`,
      source: "public",
      version,
    });
    expect(local.entries[1]?.source === "public" ? local.entries[1].aliases.map((alias) => alias.path) : []).toEqual([
      `public/${PACKAGED_WEB_SIDECAR_BUNDLE_KEY}/beta/0.8.0-beta.4`,
      `public/${PACKAGED_WEB_SIDECAR_BUNDLE_KEY}/beta/latest`,
    ]);
  });

  it("clears settings and bundle facts for one key", async () => {
    const root = await tempRoot("clear");
    const paths = fakePaths(root);
    const version = "0.8.0-beta.4.web.2";
    const source = await makeWebBundleSource("source-clear", version);
    await addBundle({
      basePath: paths.bundleBasePath,
      ref: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version },
      sourcePath: source,
    });
    await recordFetchedPackagedBundle(paths, {
      importedAt: "2026-05-21T00:00:00.000Z",
      publication: {
        channel: "beta",
        digest: { algorithm: "sha256", value: "c".repeat(64) },
        pathKey: "od-sidecar-web",
        url: "https://example.com/od-sidecar-web/beta/latest/publication.json",
        version: "0.8.0-beta.4",
        versionOrTag: "latest",
      },
      ref: { key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, version },
      selected: { platform: "any", version },
    });

    await expect(listBundles(paths.bundleBasePath)).resolves.toHaveLength(1);
    await expect(clearPackagedBundleKey({ key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY, paths })).resolves.toEqual({
      deleted: 1,
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      settingsCleared: true,
    });
    await expect(listBundles(paths.bundleBasePath)).resolves.toEqual([]);
    const local = await readPackagedBundleLocalSnapshot({
      activeSource: "builtin",
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      paths,
    });
    expect(local.entries).toEqual([
      {
        active: true,
        key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
        label: "internal",
        path: "internal",
        source: "internal",
      },
    ]);
  });

  it("ignores malformed persisted settings records", async () => {
    const root = await tempRoot("malformed");
    const paths = fakePaths(root);
    const settingsPath = packagedBundleSettingsPath(paths);
    await mkdir(join(paths.dataRoot, "settings", "bundle"), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify({
      keys: {
        "not a bundle key": {
          fetched: [],
        },
        [PACKAGED_WEB_SIDECAR_BUNDLE_KEY]: {
          fetched: [
            {
              importedAt: "2026-05-21T00:00:00.000Z",
              publication: {
                channel: "beta",
                digest: { algorithm: "sha256", value: "d".repeat(64) },
                pathKey: "od-sidecar-web",
                url: "https://example.com/od-sidecar-web/beta/latest/publication.json",
                version: "0.8.0-beta.4",
                versionOrTag: "latest",
              },
              ref: { key: "not a bundle key", version: "0.8.0-beta.4.web.1" },
              selected: { platform: "any", version: "0.8.0-beta.4.web.1" },
            },
          ],
        },
      },
      schemaVersion: 1,
    }, null, 2)}\n`, "utf8");

    await expect(readPackagedBundleLocalSnapshot({
      activeSource: "builtin",
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      paths,
    })).resolves.toMatchObject({
      entries: [
        {
          active: true,
          key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
          label: "internal",
          path: "internal",
          source: "internal",
        },
      ],
    });
  });
});
