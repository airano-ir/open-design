// Live (env-reading) resolver for the MCP install payload.
//
// buildMcpInstallPayload (mcp-install-info.ts) is intentionally pure; the
// probes it needs — fs existence checks, process.execPath, sidecar IPC
// detection, OD_WEB_PORT — live here so the two consumers resolve the
// exact same launch spec: the /api/mcp/install-info route (Settings → MCP
// panel, `od mcp install`) and the agent-plugin installer (which embeds
// the MCP entry next to the copied skills for skills-dir hosts). A
// divergence between those consumers would install a Cursor MCP entry
// that differs from the one the Settings panel renders.

import fs from 'node:fs';
import { SIDECAR_ENV } from '@open-design/sidecar-proto';
import { buildMcpInstallPayload, type McpInstallPayload } from './mcp-install-info.js';

export interface ComputeLiveMcpInstallPayloadOpts {
  /** Absolute path to the daemon's CLI entry (ctx.paths.OD_BIN). */
  odBin: string;
  /** Resolved daemon data root (RUNTIME_DATA_DIR). */
  dataDir: string;
  /** The daemon's live HTTP port. */
  port: number;
}

export function computeLiveMcpInstallPayload(
  opts: ComputeLiveMcpInstallPayloadOpts,
): McpInstallPayload {
  // The daemon was bootstrapped as a sidecar (tools-dev, packaged) iff
  // bootstrapSidecarRuntime stamped OD_SIDECAR_IPC_PATH into the env.
  // In sidecar mode the snippet omits --daemon-url and the spawned
  // `od mcp` discovers the live URL via the concrete IPC endpoint on
  // every spawn, so the client config survives ephemeral-port
  // restarts. For direct `od` / `od --port X` launches there is no
  // IPC socket; the helper bakes --daemon-url so custom ports keep
  // working.
  const sidecarIpcPath = process.env[SIDECAR_ENV.IPC_PATH];
  const isSidecarMode = sidecarIpcPath != null && sidecarIpcPath.length > 0;
  const sidecarEnv: Record<string, string> = {};
  if (isSidecarMode) {
    sidecarEnv[SIDECAR_ENV.IPC_PATH] = sidecarIpcPath;
  }
  // tools-dev / packaged launchers export OD_WEB_PORT so the daemon
  // knows where the browser-facing Open Design studio is running.
  // CLI-only / headless launches set neither and webBaseUrl falls
  // through as null — MCP clients then just omit the studio deep
  // link from their responses.
  const webPortRaw = process.env.OD_WEB_PORT;
  const webPortNum = webPortRaw ? Number(webPortRaw) : Number.NaN;
  const webBaseUrl = Number.isFinite(webPortNum) && webPortNum > 0
    ? `http://127.0.0.1:${webPortNum}`
    : null;
  return buildMcpInstallPayload({
    cliPath: opts.odBin,
    cliExists: fs.existsSync(opts.odBin),
    // process.execPath is the absolute path to the Node-compatible
    // runtime running the daemon RIGHT NOW. In packaged builds this
    // may be Electron with ELECTRON_RUN_AS_NODE=1 rather than a
    // separate bundled Node binary; the helper surfaces that env
    // requirement on the command so IDE-spawned MCP clients can
    // reproduce the same mode from a minimal OS launcher env.
    execPath: process.execPath,
    nodeExists: fs.existsSync(process.execPath),
    port: opts.port,
    platform: process.platform,
    dataDir: opts.dataDir,
    electronAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
    isSidecarMode,
    sidecarEnv,
    webBaseUrl,
  });
}
