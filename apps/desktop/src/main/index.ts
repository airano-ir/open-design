import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_ENV,
  SIDECAR_EVENTS,
  SIDECAR_MESSAGES,
  normalizeDesktopSidecarMessage,
  type DesktopClickInput,
  type DesktopEvalInput,
  type DesktopExportPdfInput,
  type DesktopScreenshotInput,
  type DesktopUpdateInput,
  type PackagedBundleLocalEntrySnapshot,
  type PackagedBundleOperationResult,
  type PackagedBundlePresentationSnapshot,
  type RegisterDesktopAuthResult,
  type SidecarEventMessage,
  type SidecarStamp,
  type WebStatusSnapshot,
} from "@open-design/sidecar-proto";
import {
  bootstrapSidecarRuntime,
  createJsonIpcServer,
  requestJsonIpc,
  resolveAppIpcPath,
  type JsonIpcServerHandle,
  type SidecarRuntimeContext,
} from "@open-design/sidecar";
import { readProcessStamp } from "@open-design/platform";

import { createDesktopRuntime, type DesktopRuntime } from "./runtime.js";
import { attachDesktopProcessErrorFilter } from "./uncaught-exception.js";
import { createDesktopUpdater, createDesktopUpdaterScheduler, type DesktopUpdater, type DesktopUpdaterScheduler } from "./updater.js";

// Re-export pure URL-policy helpers so the packaged workspace's
// vitest can pin their behaviour without spinning up a full Electron
// runtime. They are part of the security boundary for child-window
// navigation (see `setWindowOpenHandler` in `runtime.ts`), so
// pinning them is worth the small extra surface.
export { isAllowedChildWindowUrl, isHttpUrl, resolveDesktopStatusUrl } from "./runtime.js";

// Re-export the path-validation helpers for the same reason (#974).
// shell.openPath is privileged main-process behaviour; pinning the
// validation gate via tests is worth the extra surface.
//
// Round-5 (lefarcen P1, mrcfps) adds `pickAndImportFolder` and its
// types so the lazy-retry-on-DESKTOP_AUTH_PENDING flow is testable in
// the packaged workspace without booting Electron.
export {
  validateExistingDirectory,
  fetchResolvedProjectDir,
  isOpenPathAllowedForProject,
  signDesktopImportToken,
  pickAndImportFolder,
  type PathValidationResult,
  type ResolvedProjectDirContext,
  type PickAndImportFolderDeps,
  type PickAndImportFolderResult,
} from "./runtime.js";

const TOOLS_DEV_PARENT_PID_ENV = SIDECAR_ENV.TOOLS_DEV_PARENT_PID;

export type DesktopMainOptions = {
  beforeShutdown?: () => Promise<void>;
  discoverWebUrl?: () => Promise<string | null>;
  /**
   * Round-7 (lefarcen P2 @ runtime.ts:336): packaged builds report the
   * renderer URL (`od://app/`) over `discoverWebUrl`, but Node-side
   * fetch can't resolve a custom Electron protocol. Optional. When
   * provided, runtime API calls (`/api/import/folder`,
   * `/api/projects/:id`) target this URL instead. tools-dev callers
   * omit it because their web URL IS already an http://127.0.0.1 URL
   * Node fetch can hit.
   */
  discoverDaemonUrl?: () => Promise<string | null>;
  handleSidecarEvent?: (message: SidecarEventMessage) => Promise<unknown | undefined>;
  preloadPath?: string;
  update?: {
    currentVersion?: string | null;
    downloadRoot?: string | null;
  };
};

function isDirectEntry(): boolean {
  const entryPath = process.argv[1];
  if (entryPath == null || entryPath.length === 0 || entryPath.startsWith("--")) return false;

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function attachParentMonitor(stop: () => Promise<void>): void {
  const parentPid = Number(process.env[TOOLS_DEV_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) return;
    clearInterval(timer);
    void stop().finally(() => process.exit(0));
  }, 1000);
  timer.unref();
}

function createWebDiscovery(runtime: SidecarRuntimeContext<SidecarStamp>): () => Promise<string | null> {
  return async () => {
    const webIpc = resolveAppIpcPath({
      app: APP_KEYS.WEB,
      contract: OPEN_DESIGN_SIDECAR_CONTRACT,
      namespace: runtime.namespace,
    });
    const web = await requestJsonIpc<WebStatusSnapshot>(webIpc, { type: SIDECAR_MESSAGES.STATUS }, { timeoutMs: 600 }).catch(() => null);
    return web?.url ?? null;
  };
}

function buildUpdateMenuItems(updater: DesktopUpdater): MenuItemConstructorOptions[] {
  const status = updater.snapshot();
  const busy = status.state === "checking" || status.state === "downloading" || status.state === "installing";
  return [
    {
      enabled: status.enabled && !busy,
      label: status.state === "downloading" ? "Downloading Update..." : "Check for Updates...",
      async click() {
        const next = await updater.checkForUpdates();
        await showUpdateResultDialog(updater, next);
      },
    },
    {
      enabled: status.enabled && status.state === "downloaded",
      label: "Install Update...",
      async click() {
        const next = await updater.installUpdate();
        if (next.state === "error") {
          dialog.showErrorBox("Open Design update failed", next.error?.message ?? "Could not open the downloaded installer.");
        }
      },
    },
  ];
}

const DESKTOP_WEB_BUNDLE_KEY = "od:sidecar:web";

type DesktopBundleMenuController = {
  clear(key: string): Promise<PackagedBundleOperationResult>;
  fetch(key: string): Promise<PackagedBundleOperationResult>;
  local(key: string): Promise<PackagedBundleOperationResult>;
  reset(key: string): Promise<PackagedBundleOperationResult>;
  status(key: string): Promise<PackagedBundleOperationResult>;
  switch(input: {
    key: string;
    presentation?: PackagedBundlePresentationSnapshot;
    version: string;
  }): Promise<PackagedBundleOperationResult>;
};

type DesktopBundleMenuState = {
  busy: boolean;
  error: string | null;
  result: PackagedBundleOperationResult | null;
};

function createDesktopBundleMenuController(
  handler: DesktopMainOptions["handleSidecarEvent"],
): DesktopBundleMenuController | null {
  if (handler == null) return null;
  const sidecarHandler = handler;

  async function request(message: SidecarEventMessage): Promise<PackagedBundleOperationResult> {
    const result = await sidecarHandler(message);
    if (result == null || typeof result !== "object") {
      throw new Error("packaged bundle IPC did not return a result");
    }
    return result as PackagedBundleOperationResult;
  }

  return {
    clear: (key) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_CLEAR,
      payload: { key },
      type: SIDECAR_MESSAGES.EVENT,
    }),
    fetch: (key) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_FETCH,
      payload: { key },
      type: SIDECAR_MESSAGES.EVENT,
    }),
    local: (key) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_LOCAL,
      payload: { key },
      type: SIDECAR_MESSAGES.EVENT,
    }),
    reset: (key) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_RESET,
      payload: { key },
      type: SIDECAR_MESSAGES.EVENT,
    }),
    status: (key) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_STATUS,
      payload: { key },
      type: SIDECAR_MESSAGES.EVENT,
    }),
    switch: (input) => request({
      key: SIDECAR_EVENTS.PACKAGED_BUNDLE_SWITCH,
      payload: {
        key: input.key,
        ...(input.presentation == null ? {} : { presentation: input.presentation }),
        source: "bundle",
        version: input.version,
      },
      type: SIDECAR_MESSAGES.EVENT,
    }),
  };
}

function bundleStatusDetail(result: PackagedBundleOperationResult): string {
  const runtime = result.runtime;
  const local = result.local;
  const publicCount = local?.entries.filter((entry) => entry.source === "public").length ?? 0;
  return [
    `Source: ${runtime.source}`,
    `State: ${runtime.state}`,
    `Version: ${runtime.version ?? "internal"}`,
    `Host epoch: ${runtime.hostEpoch ?? "unknown"}`,
    `PID: ${runtime.pid ?? "none"}`,
    `URL: ${runtime.url ?? "unavailable"}`,
    `Local public bundles: ${publicCount}`,
    ...(runtime.fallbackReason == null ? [] : [`Fallback: ${runtime.fallbackReason}`]),
  ].join("\n");
}

async function showBundleStatusDialog(result: PackagedBundleOperationResult): Promise<void> {
  await dialog.showMessageBox({
    buttons: ["OK"],
    detail: bundleStatusDetail(result),
    message: "Open Design bundle status",
    type: "info",
  });
}

function publicBundleLabel(entry: Extract<PackagedBundleLocalEntrySnapshot, { source: "public" }>): string {
  const alias = entry.aliases.find((candidate) => candidate.label === "latest") ?? entry.aliases[0];
  const prefix = entry.active ? "✓ " : "";
  return `${prefix}${alias?.path ?? entry.path}`;
}

function buildBundleMenuItems(input: {
  action: (run: () => Promise<PackagedBundleOperationResult>, options?: { dialog?: "status" }) => void;
  controller: DesktopBundleMenuController;
  refresh: () => void;
  state: DesktopBundleMenuState;
}): MenuItemConstructorOptions[] {
  const localEntries = input.state.result?.local?.entries ?? [];
  const publicEntries = localEntries.filter((entry): entry is Extract<PackagedBundleLocalEntrySnapshot, { source: "public" }> =>
    entry.source === "public",
  );
  const internal = localEntries.find((entry) => entry.source === "internal");
  const busy = input.state.busy || input.state.result?.runtime.operation != null;
  return [
    {
      enabled: !busy,
      label: "Status",
      click() {
        input.action(() => input.controller.status(DESKTOP_WEB_BUNDLE_KEY), { dialog: "status" });
      },
    },
    {
      enabled: !busy,
      label: "Fetch",
      click() {
        input.action(() => input.controller.fetch(DESKTOP_WEB_BUNDLE_KEY));
      },
    },
    {
      enabled: !busy,
      label: "Local",
      submenu: [
        {
          enabled: !busy,
          label: `${internal?.active === true ? "✓ " : ""}internal`,
          click() {
            input.action(() => input.controller.reset(DESKTOP_WEB_BUNDLE_KEY));
          },
        },
        { type: "separator" },
        ...(
          publicEntries.length === 0
            ? [{ enabled: false, label: "No public bundles" } satisfies MenuItemConstructorOptions]
            : publicEntries.flatMap((entry): MenuItemConstructorOptions[] => [
                {
                  enabled: !busy,
                  label: publicBundleLabel(entry),
                  click() {
                    input.action(() => input.controller.switch({
                      key: DESKTOP_WEB_BUNDLE_KEY,
                      ...(entry.presentation == null ? {} : { presentation: entry.presentation }),
                      version: entry.version,
                    }));
                  },
                },
                ...entry.aliases.map((alias): MenuItemConstructorOptions => ({
                  enabled: false,
                  label: `  ${alias.path}`,
                })),
              ])
        ),
      ],
    },
    { type: "separator" },
    {
      enabled: !busy,
      label: "Reset",
      click() {
        input.action(() => input.controller.reset(DESKTOP_WEB_BUNDLE_KEY));
      },
    },
    {
      enabled: !busy,
      label: `Clear ${DESKTOP_WEB_BUNDLE_KEY}`,
      click() {
        input.action(() => input.controller.clear(DESKTOP_WEB_BUNDLE_KEY));
      },
    },
    ...(input.state.error == null
      ? []
      : [
          { type: "separator" as const },
          {
            enabled: false,
            label: input.state.error,
          },
        ]),
    { type: "separator" },
    {
      enabled: !busy,
      label: "Refresh",
      click() {
        input.refresh();
      },
    },
  ];
}

async function showUpdateResultDialog(updater: DesktopUpdater, status = updater.snapshot()): Promise<void> {
  if (!status.enabled) return;
  if (status.state === "downloaded") {
    const result = await dialog.showMessageBox({
      buttons: ["Install Update", "Later"],
      defaultId: 0,
      message: "A new Open Design version has been downloaded.",
      detail: "Open the installer to update Open Design. You may need to quit the app and replace the existing copy.",
      type: "info",
    });
    if (result.response === 0) await updater.installUpdate();
    return;
  }
  if (status.state === "not-available") {
    await dialog.showMessageBox({
      buttons: ["OK"],
      message: "Open Design is up to date.",
      type: "info",
    });
    return;
  }
  if (status.state === "unsupported") {
    await dialog.showMessageBox({
      buttons: ["OK"],
      detail: status.error?.message,
      message: "Updates are not available for this Open Design build.",
      type: "info",
    });
    return;
  }
  if (status.state === "error") {
    dialog.showErrorBox("Open Design update failed", status.error?.message ?? "Could not check for updates.");
  }
}

function installDesktopMenu(updater: DesktopUpdater, bundleController: DesktopBundleMenuController | null): () => void {
  const bundleState: DesktopBundleMenuState = {
    busy: false,
    error: null,
    result: null,
  };
  let disposed = false;

  const rebuild = () => {
    const updateItems = buildUpdateMenuItems(updater);
    const bundleItems = bundleController == null
      ? []
      : buildBundleMenuItems({
          action(run, options) {
            bundleState.busy = true;
            bundleState.error = null;
            rebuild();
            void run()
              .then(async (result) => {
                bundleState.result = result;
                if (options?.dialog === "status") await showBundleStatusDialog(result);
              })
              .catch((error: unknown) => {
                bundleState.error = error instanceof Error ? error.message : String(error);
                dialog.showErrorBox("Open Design bundle action failed", bundleState.error);
              })
              .finally(() => {
                bundleState.busy = false;
                rebuild();
              });
          },
          controller: bundleController,
          refresh() {
            bundleState.busy = true;
            bundleState.error = null;
            rebuild();
            void bundleController.local(DESKTOP_WEB_BUNDLE_KEY)
              .then((result) => {
                bundleState.result = result;
              })
              .catch((error: unknown) => {
                bundleState.error = error instanceof Error ? error.message : String(error);
              })
              .finally(() => {
                bundleState.busy = false;
                rebuild();
              });
          },
          state: bundleState,
        });
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin"
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                ...updateItems,
                { type: "separator" as const },
                { role: "services" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : [
            {
              label: "File",
              submenu: [
                ...updateItems,
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          ...(process.platform === "darwin"
            ? [{ type: "separator" as const }, { role: "front" as const }]
            : [{ role: "close" as const }]),
        ],
      },
      ...(bundleController == null
        ? []
        : [
            {
              label: "Bundle",
              submenu: bundleItems,
            },
          ]),
      {
        label: "Help",
        submenu: [
          {
            label: "Open Design",
            click() {
              void shell.openExternal("https://github.com/nexu-io/open-design");
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  rebuild();
  if (bundleController != null) {
    bundleState.busy = true;
    void bundleController.local(DESKTOP_WEB_BUNDLE_KEY)
      .then((result) => {
        if (disposed) return;
        bundleState.result = result;
      })
      .catch((error: unknown) => {
        if (disposed) return;
        bundleState.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (disposed) return;
        bundleState.busy = false;
        rebuild();
      });
  }
  const unsubscribeUpdater = updater.subscribe(rebuild);
  return () => {
    disposed = true;
    unsubscribeUpdater();
  };
}

const REGISTER_DESKTOP_AUTH_RETRY_DELAYS_MS = [120, 240, 480, 960, 1500];
const REGISTER_DESKTOP_AUTH_TIMEOUT_MS = 800;

/**
 * Sends a fresh, per-process secret to the daemon over its sidecar IPC
 * before any BrowserWindow is created. The daemon stores the secret
 * and from this point on requires every `POST /api/import/folder`
 * request to carry an HMAC token signed with it (PR #974). On a clean
 * orchestrator startup the daemon is already up — but desktop and
 * daemon are sibling processes spawned by `tools-dev` / `tools-pack`,
 * so we retry the IPC call a few times before giving up. A failed
 * registration is *not* a hard error: the desktop runtime continues
 * and the import-folder bridge will simply refuse pickAndImport calls
 * (because no secret is in scope), instead of opening a renderer-
 * bypassable path. We log the failure so the operator can investigate.
 */
async function registerDesktopAuthWithDaemon(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  secret: Buffer,
): Promise<boolean> {
  const daemonIpc = resolveAppIpcPath({
    app: APP_KEYS.DAEMON,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    namespace: runtime.namespace,
  });
  const message = {
    input: { secret: secret.toString("base64") },
    type: SIDECAR_MESSAGES.REGISTER_DESKTOP_AUTH,
  };
  const delays = REGISTER_DESKTOP_AUTH_RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const result = await requestJsonIpc<RegisterDesktopAuthResult>(
        daemonIpc,
        message,
        { timeoutMs: REGISTER_DESKTOP_AUTH_TIMEOUT_MS },
      );
      if (result?.accepted === true) return true;
    } catch {
      // Daemon not yet listening on the IPC socket, or message rejected.
      // Fall through to the retry sleep below.
    }
    if (attempt >= delays.length) break;
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, delays[attempt]);
    });
  }
  return false;
}

export async function runDesktopMain(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  options: DesktopMainOptions = {},
): Promise<void> {
  // Install the defensive uncaughtException filter BEFORE awaiting
  // app.whenReady, so a setTypeOfService EINVAL thrown by undici during
  // the renderer's first fetch is intercepted rather than surfacing as
  // Electron's "JavaScript error in main process" dialog (issue #647).
  // The packaged entry has the parallel filter wired in
  // apps/packaged/src/logging.ts; both must stay in sync until the
  // helper is promoted to a shared workspace package.
  attachDesktopProcessErrorFilter();

  await app.whenReady();

  // PR #974: mint a per-process auth secret and hand it to the daemon
  // BEFORE the BrowserWindow loads. The daemon uses it to verify the
  // HMAC tokens that the `dialog:pick-and-import` IPC mints for
  // `POST /api/import/folder`. Doing this before the window load is
  // load-bearing: it closes the race where a compromised renderer
  // races to call /api/import/folder with an arbitrary baseDir before
  // the gate is armed.
  //
  // Round-5 (lefarcen P1, mrcfps): if the initial registration fails
  // (daemon slow to listen, missed startup window, or daemon restarted
  // mid-session), we still pass the secret to the runtime so the lazy
  // re-registration path inside `dialog:pick-and-import` can recover.
  // The runtime's first import attempt under a daemon that doesn't yet
  // know the secret gets a `503 DESKTOP_AUTH_PENDING`, the runtime
  // re-invokes the registration callback below, and the import retries
  // once with a fresh token. A persistent failure surfaces in the
  // renderer toast rather than silently dropping forever.
  const desktopAuthSecret = randomBytes(32);
  const registered = await registerDesktopAuthWithDaemon(runtime, desktopAuthSecret);
  if (!registered) {
    console.warn(
      "[open-design desktop] initial import-token handshake with daemon did not complete; " +
        "first folder-import attempt will lazily retry registration before failing",
    );
  }

  const updater = createDesktopUpdater(
    {
      currentVersion: options.update?.currentVersion,
      downloadRoot: options.update?.downloadRoot,
      runtimeBase: runtime.base,
      source: runtime.source,
    },
    { openPath: (path) => shell.openPath(path) },
  );
  let desktop: DesktopRuntime | null = null;
  let disposeMenu: () => void = () => undefined;
  let updateScheduler: DesktopUpdaterScheduler | null = null;
  let ipcServer: JsonIpcServerHandle | null = null;
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await options.beforeShutdown?.().catch((error: unknown) => {
      console.error("desktop beforeShutdown failed", error);
    });
    updateScheduler?.stop("shutdown");
    disposeMenu();
    await ipcServer?.close().catch(() => undefined);
    await desktop?.close().catch(() => undefined);
    app.quit();
  }

  function shutdownAndExit(): void {
    void shutdown().finally(() => process.exit(0));
  }

  desktop = await createDesktopRuntime({
    desktopAuthSecret,
    discoverUrl: options.discoverWebUrl ?? createWebDiscovery(runtime),
    discoverDaemonUrl: options.discoverDaemonUrl,
    preloadPath: options.preloadPath,
    // Round-5 (lefarcen P1, mrcfps): runtime hands this back to itself
    // on `503 DESKTOP_AUTH_PENDING` to re-handshake with the daemon
    // (after a daemon restart, or after a missed startup window). The
    // runtime then mints a FRESH token (new nonce + new exp — replay
    // protection still works) and POSTs once more.
    registerDesktopAuthWithDaemon: () => registerDesktopAuthWithDaemon(runtime, desktopAuthSecret),
    requestQuit: shutdownAndExit,
    updater,
  });
  const bundleMenuController = createDesktopBundleMenuController(options.handleSidecarEvent);
  disposeMenu = installDesktopMenu(updater, bundleMenuController);
  updateScheduler = createDesktopUpdaterScheduler(updater, {
    backoffInitialMs: updater.config.checkBackoffInitialMs,
    backoffMaxMs: updater.config.checkBackoffMaxMs,
    initialDelayMs: updater.config.checkInitialDelayMs,
    intervalMs: updater.config.checkIntervalMs,
  });
  if (updater.shouldAutoCheck()) updateScheduler.start();

  attachParentMonitor(shutdown);

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void shutdown().finally(() => process.exit(0));
  });

  ipcServer = await createJsonIpcServer({
    socketPath: runtime.ipc,
    handler: async (message: unknown) => {
      const request = normalizeDesktopSidecarMessage(message);
      const activeDesktop = desktop;
      if (activeDesktop == null) {
        throw new Error("desktop runtime is not initialized");
      }
      switch (request.type) {
        case SIDECAR_MESSAGES.EVENT:
          switch (request.key) {
            case SIDECAR_EVENTS.INSPECT_STATUS:
              return { ...activeDesktop.status(), update: await updater.status() };
            case SIDECAR_EVENTS.INSPECT_EVAL:
              return await activeDesktop.eval(request.payload);
            case SIDECAR_EVENTS.INSPECT_SCREENSHOT:
              return await activeDesktop.screenshot(request.payload);
            case SIDECAR_EVENTS.INSPECT_CONSOLE:
              return activeDesktop.console();
            case SIDECAR_EVENTS.INSPECT_CLICK:
              return await activeDesktop.click(request.payload);
            case SIDECAR_EVENTS.INSPECT_UPDATE:
              return await updater.handle(request.payload.action);
            case SIDECAR_EVENTS.DESKTOP_EXPORT_PDF:
              return await activeDesktop.exportPdf(request.payload);
            default:
              if (options.handleSidecarEvent != null) {
                const delegated = await options.handleSidecarEvent(request);
                if (delegated !== undefined) return delegated;
              }
              throw new Error("unsupported desktop sidecar event");
          }
        case SIDECAR_MESSAGES.STATUS:
          return { ...activeDesktop.status(), update: await updater.status() };
        case SIDECAR_MESSAGES.EVAL:
          return await activeDesktop.eval(request.input as DesktopEvalInput);
        case SIDECAR_MESSAGES.SCREENSHOT:
          return await activeDesktop.screenshot(request.input as DesktopScreenshotInput);
        case SIDECAR_MESSAGES.CONSOLE:
          return activeDesktop.console();
        case SIDECAR_MESSAGES.CLICK:
          return await activeDesktop.click(request.input as DesktopClickInput);
        case SIDECAR_MESSAGES.EXPORT_PDF:
          return await activeDesktop.exportPdf(request.input as DesktopExportPdfInput);
        case SIDECAR_MESSAGES.UPDATE:
          return await updater.handle((request.input as DesktopUpdateInput).action);
        case SIDECAR_MESSAGES.SHUTDOWN:
          setImmediate(() => {
            shutdownAndExit();
          });
          return { accepted: true };
      }
    },
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shutdownAndExit();
  });

  app.on("window-all-closed", () => {
    shutdownAndExit();
  });

  app.on("activate", () => {
    desktop?.show();
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      shutdownAndExit();
    });
  }
}

if (isDirectEntry()) {
  const stamp = readProcessStamp(process.argv.slice(2), OPEN_DESIGN_SIDECAR_CONTRACT);
  if (stamp == null) throw new Error("sidecar stamp is required");

  const runtime = bootstrapSidecarRuntime(stamp, process.env, {
    app: APP_KEYS.DESKTOP,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
  });

  void runDesktopMain(runtime).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
