import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2,
  BundleStoreError,
  addBundle,
  bundlePublicationDigest,
  parseBundlePublicationDigest,
  resolveBundle,
  resolveBundleArtifact,
  selectBundlePublicationVariant,
  validateBundlePublication,
  validateBundleRef,
  type BundlePublication,
  type BundlePublicationVariant,
  type BundleResolved,
} from "@open-design/bundle";
import type {
  PackagedBundleFetchSnapshot,
  PackagedBundlePresentationSnapshot,
} from "@open-design/sidecar-proto";

import {
  recordFetchedPackagedBundle,
  type PackagedBundleFetchedRecord,
} from "./bundle-settings.js";
import type { PackagedNamespacePaths } from "./paths.js";

export type PackagedRemoteBundlePublication = {
  digest: {
    algorithm: "sha256";
    value: string;
  };
  publication: BundlePublication;
};

export type FetchedPackagedRemoteBundle = {
  fetch: PackagedBundleFetchSnapshot;
  presentation: PackagedBundlePresentationSnapshot;
  resolved: BundleResolved;
};

function publicationDigestUrl(publicationUrl: string): string {
  return new URL("publication.json.sha256", publicationUrl).href;
}

function artifactUrl(publicationUrl: string, artifactPath: string): string {
  return new URL(artifactPath, publicationUrl).href;
}

function versionOrTagFromPublicationUrl(publicationUrl: string, fallback: string): string {
  const url = new URL(publicationUrl);
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (parts.at(-1) !== "publication.json") return fallback;
  return parts.at(-2) ?? fallback;
}

function presentationFromPublication(publication: BundlePublication): PackagedBundlePresentationSnapshot {
  return {
    channel: publication.metadata.channel,
    display: publication.metadata.display,
    version: publication.metadata.version,
  };
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed ${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function fetchText(url: string): Promise<string> {
  return await (await fetchOk(url)).text();
}

async function downloadFile(url: string, filePath: string): Promise<number> {
  const response = await fetchOk(url);
  const body = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, body);
  return body.byteLength;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function commandFailed(command: string, args: string[], code: number | null, signal: NodeJS.Signals | null): Error {
  const suffix = signal == null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
  return new Error(`command failed with ${suffix}: ${[command, ...args].map((part) => JSON.stringify(part)).join(" ")}`);
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const stderr: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0 && signal == null) {
        resolveCommand();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      const error = commandFailed(command, args, code, signal);
      if (detail.length > 0) error.message = `${error.message}\n${detail}`;
      rejectCommand(error);
    });
  });
}

async function extractTarArchive(input: {
  archivePath: string;
  outputPath: string;
}): Promise<void> {
  await mkdir(input.outputPath, { recursive: true });
  await run("tar", ["-xf", input.archivePath, "-C", input.outputPath]);
}

async function expectedArtifactSha256(input: {
  artifact: BundlePublicationVariant["artifact"];
  publicationUrl: string;
}): Promise<string> {
  let expected = input.artifact.sha256?.toLowerCase();
  if (input.artifact.sha256Url != null) {
    const digestUrl = artifactUrl(input.publicationUrl, input.artifact.sha256Url);
    const remoteDigest = parseBundlePublicationDigest(await fetchText(digestUrl)).value;
    if (expected != null && expected !== remoteDigest) {
      throw new Error(`bundle artifact sha256 does not match sha256Url: ${digestUrl}`);
    }
    expected = remoteDigest;
  }
  if (expected == null) throw new Error("bundle publication artifact must provide sha256 or sha256Url");
  return expected;
}

async function existingBundle(input: {
  key: string;
  paths: PackagedNamespacePaths;
  version: string;
}): Promise<BundleResolved | null> {
  try {
    return await resolveBundle({
      basePath: input.paths.bundleBasePath,
      ref: { key: input.key, version: input.version },
    });
  } catch {
    return null;
  }
}

async function assertImportedBundle(input: {
  key: string;
  path: string;
  version: string;
}): Promise<void> {
  const artifact = await resolveBundleArtifact(input.path);
  if (artifact.descriptor.schemaVersion !== BUNDLE_DESCRIPTOR_SCHEMA_VERSION_V2) {
    throw new Error("downloaded bundle artifact must contain schemaVersion=2 descriptor metadata");
  }
  if (artifact.descriptor.key !== input.key || artifact.descriptor.version !== input.version) {
    throw new Error(
      `downloaded bundle descriptor ${artifact.descriptor.key}@${artifact.descriptor.version} must match ${input.key}@${input.version}`,
    );
  }
}

export async function fetchPackagedRemoteBundlePublication(publicationUrl: string): Promise<PackagedRemoteBundlePublication> {
  const content = await fetchText(publicationUrl);
  const expected = parseBundlePublicationDigest(await fetchText(publicationDigestUrl(publicationUrl)));
  const digest = bundlePublicationDigest(content);
  if (expected.value !== digest.value) {
    throw new Error(`bundle publication digest mismatch for ${publicationUrl}`);
  }
  return {
    digest,
    publication: validateBundlePublication(JSON.parse(content)),
  };
}

export async function fetchPackagedRemoteBundle(input: {
  hostEpoch: string;
  key: string;
  paths: PackagedNamespacePaths;
  platform: string;
  publicationUrl: string;
}): Promise<FetchedPackagedRemoteBundle> {
  const remote = await fetchPackagedRemoteBundlePublication(input.publicationUrl);
  const selected = selectBundlePublicationVariant({
    hostEpoch: input.hostEpoch,
    key: input.key,
    platform: input.platform,
    publication: remote.publication,
  });
  const ref = validateBundleRef({ key: input.key, version: selected.version });
  const presentation = presentationFromPublication(remote.publication);
  const versionOrTag = versionOrTagFromPublicationUrl(input.publicationUrl, remote.publication.metadata.version);
  const url = artifactUrl(input.publicationUrl, selected.artifact.url);
  const expectedSha256 = await expectedArtifactSha256({
    artifact: selected.artifact,
    publicationUrl: input.publicationUrl,
  });

  let imported = false;
  let resolved = await existingBundle({ key: ref.key, paths: input.paths, version: ref.version });
  let size = selected.artifact.size;
  if (resolved == null) {
    const tempRoot = await mkdtemp(join(tmpdir(), "od-packaged-bundle-fetch-"));
    try {
      const archivePath = join(tempRoot, "bundle.tar");
      const extractPath = join(tempRoot, "bundle");
      size = await downloadFile(url, archivePath);
      if (selected.artifact.size != null && selected.artifact.size !== size) {
        throw new Error(`bundle artifact size mismatch for ${url}: expected ${selected.artifact.size}, got ${size}`);
      }
      const actualSha256 = await sha256File(archivePath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(`bundle artifact sha256 mismatch for ${url}`);
      }
      await extractTarArchive({ archivePath, outputPath: extractPath });
      resolved = await addBundle({
        basePath: input.paths.bundleBasePath,
        ref,
        sourcePath: extractPath,
      }).catch(async (error: unknown) => {
        if (error instanceof BundleStoreError && error.code === "bundle-already-exists") {
          return await resolveBundle({ basePath: input.paths.bundleBasePath, ref });
        }
        throw error;
      });
      imported = true;
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }

  await assertImportedBundle({ key: ref.key, path: resolved.path, version: ref.version });
  const artifact = {
    digest: { algorithm: "sha256" as const, value: expectedSha256 },
    ...(size == null ? {} : { size }),
    url,
  };
  const record: PackagedBundleFetchedRecord = {
    artifact,
    importedAt: new Date().toISOString(),
    presentation,
    publication: {
      channel: remote.publication.metadata.channel,
      digest: remote.digest,
      pathKey: remote.publication.bundle.pathKey,
      url: input.publicationUrl,
      version: remote.publication.metadata.version,
      versionOrTag,
    },
    ref,
    selected: {
      platform: selected.platform,
      version: selected.version,
    },
  };
  await recordFetchedPackagedBundle(input.paths, record);

  return {
    fetch: {
      artifact,
      imported,
      local: {
        active: false,
        aliases: [
          {
            label: record.publication.version,
            path: `public/${record.ref.key}/${record.publication.channel}/${record.publication.version}`,
            publicationUrl: input.publicationUrl,
            version: record.ref.version,
          },
          ...(record.publication.versionOrTag === record.publication.version
            ? []
            : [{
                label: record.publication.versionOrTag,
                path: `public/${record.ref.key}/${record.publication.channel}/${record.publication.versionOrTag}`,
                publicationUrl: input.publicationUrl,
                version: record.ref.version,
              }]),
        ],
        createdAt: resolved.entry.createdAt,
        digest: resolved.entry.digest,
        key: record.ref.key,
        label: presentation.display.version,
        path: `public/${record.ref.key}/${record.ref.version}`,
        presentation,
        publication: {
          channel: record.publication.channel,
          digest: record.publication.digest,
          pathKey: record.publication.pathKey,
          url: record.publication.url,
          version: record.publication.version,
        },
        source: "public",
        version: record.ref.version,
      },
      publication: record.publication,
      selected: record.selected,
    },
    presentation,
    resolved,
  };
}
