import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  BUNDLE_PUBLICATION_FILE,
  bundlePublicationDigest,
  listBundles,
  type BundlePublication,
} from "@open-design/bundle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PACKAGED_WEB_SIDECAR_BUNDLE_KEY } from "../src/bundle-activation.js";
import { fetchPackagedRemoteBundle } from "../src/bundle-remote.js";
import { readPackagedBundleLocalSnapshot } from "../src/bundle-settings.js";
import type { PackagedNamespacePaths } from "../src/paths.js";

let roots: string[] = [];
let servers: Server[] = [];

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `od-packaged-bundle-remote-${label}-${process.pid}-${Date.now()}-${roots.length}`);
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

function listen(server: Server): Promise<string> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      const address = server.address();
      if (address == null || typeof address === "string") {
        rejectListen(new Error("server did not listen on TCP"));
        return;
      }
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function startStaticServer(root: string): Promise<string> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const rootPath = resolve(root);
      const filePath = resolve(rootPath, ...url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part)));
      const relativePath = relative(rootPath, filePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        response.statusCode = 400;
        response.end("invalid path");
        return;
      }
      try {
        const info = await stat(filePath);
        if (!info.isFile()) {
          response.statusCode = 404;
          response.end("not found");
          return;
        }
        response.setHeader("content-length", String(info.size));
        response.end(await readFile(filePath));
      } catch {
        response.statusCode = 404;
        response.end("not found");
      }
    })();
  });
  servers.push(server);
  return await listen(server);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectCommand);
    child.once("close", (code) => {
      if (code === 0) {
        resolveCommand();
      } else {
        rejectCommand(new Error(Buffer.concat(stderr).toString("utf8")));
      }
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
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
  servers = [];
});

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))));
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

describe("packaged remote bundle fetch", () => {
  it("downloads, verifies, imports, and records a remote publication", async () => {
    const root = await tempRoot("fetch");
    const paths = fakePaths(root);
    const registry = await tempRoot("registry");
    const version = "0.8.0-beta.4.web.1";
    const bundleSource = await makeWebBundleSource("source", version);
    const publicationDir = join(registry, "od-sidecar-web", "beta", "latest");
    await mkdir(publicationDir, { recursive: true });
    const archivePath = join(publicationDir, "bundle.tar");
    await run("tar", ["-cf", archivePath, "-C", bundleSource, "."]);
    const archiveInfo = await stat(archivePath);
    const archiveSha256 = await sha256File(archivePath);
    const publication: BundlePublication = {
      bundle: {
        key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
        pathKey: "od-sidecar-web",
        variants: [
          {
            artifact: {
              format: "tar",
              sha256: archiveSha256,
              size: archiveInfo.size,
              url: "bundle.tar",
            },
            compatible: { hostEpoch: "0.8.0-beta.4" },
            platform: "any",
            version,
          },
        ],
      },
      metadata: {
        channel: "beta",
        display: {
          summary: { default: "Downloaded web" },
          title: { default: "Web" },
          version: "Beta 4 web 1",
        },
        publish: {},
        version: "0.8.0-beta.4",
      },
      schemaVersion: 1,
    };
    const content = `${JSON.stringify(publication, null, 2)}\n`;
    const digest = bundlePublicationDigest(content);
    await writeFile(join(publicationDir, BUNDLE_PUBLICATION_FILE), content, "utf8");
    await writeFile(join(publicationDir, "publication.json.sha256"), `${digest.value}  publication.json\n`, "utf8");
    const origin = await startStaticServer(registry);

    const result = await fetchPackagedRemoteBundle({
      hostEpoch: "0.8.0-beta.4",
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      paths,
      platform: "darwin-arm64",
      publicationUrl: `${origin}/od-sidecar-web/beta/latest/publication.json`,
    });

    expect(result.fetch.imported).toBe(true);
    expect(result.fetch.artifact?.digest.value).toBe(archiveSha256);
    expect(result.fetch.publication.digest.value).toBe(digest.value);
    expect(result.fetch.publication.versionOrTag).toBe("latest");
    await expect(listBundles(paths.bundleBasePath)).resolves.toHaveLength(1);
    const local = await readPackagedBundleLocalSnapshot({
      activeSource: "builtin",
      key: PACKAGED_WEB_SIDECAR_BUNDLE_KEY,
      paths,
    });
    expect(local.entries[1]).toMatchObject({
      label: "Beta 4 web 1",
      source: "public",
      version,
    });
  });
});
