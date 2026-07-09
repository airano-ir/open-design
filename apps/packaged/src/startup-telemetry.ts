// Main-process direct PostHog capture for daemon/web STARTUP failures.
//
// Why this exists separately from apps/daemon/src/analytics.ts: the daemon is
// the PostHog client's host. When the daemon never reports status (e.g. a
// missing native module — see issue #4638, where `better-sqlite3` vanished
// from the app bundle and the daemon died with ERR_MODULE_NOT_FOUND), the
// daemon/web sidecars are not running, so NOTHING emits telemetry and the
// whole "startup failed before the daemon came up" class is invisible on every
// dashboard. This module lets the packaged MAIN process emit one structured
// event on the fatal-exit path.
//
// ZERO startup side-effects by construction:
//  - No work at import time (pure helpers + one async fn; no client, no I/O).
//  - Invoked ONLY from index.ts's `main().catch(...)`, i.e. only when startup
//    has ALREADY failed and the process is about to exit(1). The happy path
//    never touches any of this.
//  - capture() is fetch-based (no posthog-node SDK, no new dependency), wrapped
//    in Promise.race with a hard timeout, and swallows every error — it can
//    neither block nor crash the exit.
//
// Consent: startup-crash telemetry follows the existing `captureSafety` policy
// in apps/daemon/src/analytics.ts — stability data is retained even for
// opted-out users (and the main process cannot read daemon consent anyway,
// since the daemon isn't up). The Settings → Privacy copy MUST call this out.
//
// Payload PII: the free-form fields (error_message, error_stack, sidecar_log_tail)
// and every path (log_path, native_module_path) run through `scrubUserPaths`.
// sidecar_log_tail is additionally WHITELISTED to error/stack-shaped lines
// (`extractSidecarErrorLines`), so config / connection / KEY=value lines — where
// the daemon's config/connector/MCP secrets live — are structurally excluded
// rather than chased by an ever-incomplete denylist. `scrubSecrets` then runs on
// all free-form fields as defense in depth (a token could still appear inside an
// error message), and the text is length-capped. This event is sent even for
// opted-out users, hence the layered structural + denylist controls.

import { readFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { release } from "node:os";

const DEFAULT_HOST = "https://us.i.posthog.com";
// Real-machine e2e (local packaged build → delete better-sqlite3 → launch →
// query PostHog) proved a 1.5s cap silently DROPPED the event: a cold DNS+TLS
// handshake to us.i.posthog.com from a fresh main process exceeds 1.5s, so the
// race timed out and process.exit(1) killed the in-flight POST before it
// landed. 5s gives the one request room to complete on a cold connection.
// A genuinely offline machine still exits fast — fetch rejects on DNS failure,
// so `send` resolves early and we don't burn the full bound; only a black-hole
// network pays the full 5s, which on an already-crashing exit is acceptable.
const DEFAULT_TIMEOUT_MS = 5000;
const LOG_TAIL_MAX_BYTES = 16_384;

export const STARTUP_FAILURE_EVENT = "packaged_runtime_failed";

// Shared safety-event envelope constants. `captureSafety` in
// apps/daemon/src/analytics.ts stamps these on every stability event; we mirror
// them here so env/schema-filtered dashboards bucket packaged_runtime_failed
// beside the rest of the analytics stream instead of dropping it.
//
// EVENT_SCHEMA_VERSION must stay in lockstep with
// packages/contracts/src/analytics/public-params.ts. It is replicated (not
// imported) because apps/packaged does not depend on @open-design/contracts and
// a single integer isn't worth a new cross-package dependency that also
// complicates the daemon-chunk externalization.
const EVENT_SCHEMA_VERSION = 2;
const CLIENT_TYPE = "packaged_main";
const CAPTURE_SOURCE = "packaged/startup";

// Replicates apps/daemon/src/telemetry-environment.ts (daemon src, not
// importable here) so the packaged main process resolves the same `env` bucket
// as daemon-emitted events for a given process environment.
function resolveTelemetryEnv(env: NodeJS.ProcessEnv = process.env): string {
  const explicit =
    env.OD_TELEMETRY_ENV?.trim() ||
    env.OPEN_DESIGN_ENV?.trim() ||
    env.POSTHOG_ENV?.trim() ||
    env.LANGFUSE_ENVIRONMENT?.trim();
  if (explicit) return explicit;
  if (env.NODE_ENV === "production") return "production";
  return "development";
}

// Mirrors apps/daemon/src/analytics.ts randomInsertId. $insert_id is PostHog's
// dedup key; event_id carries the same value.
function randomInsertId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type StartupFailureKind =
  | "daemon-start"
  | "web-start"
  | "path-access"
  | "unknown";

export interface StartupFailureClassification {
  failureKind: StartupFailureKind;
  exitCode: number | null;
  signal: string | null;
  logPath: string | null;
}

// `waitForStatus` (apps/packaged/src/sidecars.ts:206-208) throws:
//   "daemon exited before reporting status (code=1, signal=none); see <logPath> for details"
// The literal word is always "daemon" even for the web sidecar, so we
// distinguish daemon-vs-web by the LOG PATH segment, not the message text.
const EXIT_RE =
  /exited before reporting status \(code=(.*?), signal=(.*?)\); see (.*?) for details/;

export function classifyStartupFailure(
  error: unknown,
  isPathAccess: boolean,
): StartupFailureClassification {
  if (isPathAccess) {
    return { failureKind: "path-access", exitCode: null, signal: null, logPath: null };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = EXIT_RE.exec(message);
  if (!match) {
    return { failureKind: "unknown", exitCode: null, signal: null, logPath: null };
  }
  const rawCode = match[1];
  const rawSignal = match[2];
  const logPath = match[3] && match[3] !== "<no log path>" ? match[3] : null;
  const parsedCode = rawCode === "null" ? null : Number.parseInt(rawCode, 10);
  const exitCode = parsedCode == null || Number.isNaN(parsedCode) ? null : parsedCode;
  const signal = rawSignal === "none" ? null : rawSignal;
  // `startPackagedSidecars` builds the watched log path with path.join, which is
  // backslash-separated on Windows (`...\logs\web\latest.log`). Normalize before
  // the segment check so a web-sidecar failure isn't misreported as daemon-start
  // on Windows — exactly the platform split this field exists to capture.
  const normalizedLogPath = logPath?.replace(/\\/g, "/") ?? null;
  const failureKind: StartupFailureKind = normalizedLogPath?.includes("/web/")
    ? "web-start"
    : "daemon-start";
  return { failureKind, exitCode, signal, logPath };
}

// Pull the real error code + missing module out of a sidecar log tail. Pure
// function so it can be fed the #4638 log text verbatim in tests.
export function parseDaemonLogTail(logText: string): {
  errorCode?: string;
  missingModule?: string;
} {
  const out: { errorCode?: string; missingModule?: string } = {};
  const errMatch = /\bERR_[A-Z0-9_]+/.exec(logText);
  if (errMatch) out.errorCode = errMatch[0];
  const modMatch =
    /Cannot find package '([^']+)'|Cannot find module '([^']+)'/.exec(logText);
  if (modMatch) out.missingModule = modMatch[1] ?? modMatch[2];
  return out;
}

// apps/web/src/analytics/scrub.ts only rewrites paths containing an
// apps/|packages/|tools/ segment, so it does NOT touch a user's home dir
// (verified empirically against the #4638 log). The packaged main process
// can't import the web module anyway, so we ship a focused scrubber here.
export function scrubUserPaths(value: string): string {
  return value
    // Windows profile dirs FIRST, either separator style (`C:\Users\…` or the
    // slash-normalized `C:/Users/…` that JS/Electron/Node diagnostics commonly
    // emit). Consume the WHOLE segment up to the next slash/backslash — a
    // profile dir can contain spaces ("John Doe"), and a whitespace boundary
    // would leak the tail ("<redacted> Doe/…"). Anchored on `<drive>:` so it
    // only fires on a real Windows home path; `\r\n` in the class stops it from
    // running across lines in a multi-line stack. Runs before the POSIX rule
    // because that rule also matches the "/Users/" inside a `C:/Users/` path.
    .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\r\n]+/g, "$1<redacted>")
    // Any `…/Users/<name>`, `…/Profiles/<name>` or `…/home/<name>` segment
    // regardless of prefix — covers UNC shares (`\\CORP-FS\Profiles\jdoe\…`) and
    // roaming layouts that the drive-anchored rule above misses. Space-tolerant
    // (Windows names can contain spaces), line-bounded.
    .replace(/([\\/](?:Users|Profiles)[\\/])[^\\/\r\n]+/g, "$1<redacted>")
    // POSIX home dirs. Real macOS/Linux home segments cannot contain spaces, so
    // the whitespace boundary is correct here and avoids over-redacting a
    // following word in free-form crash text.
    .replace(/\/(Users|home)\/[^/\s]+/g, "/$1/<redacted>");
}

// Strip credentials/secrets from free-form telemetry text (daemon log tail,
// error message/stack). The daemon loads config/connector/MCP tokens before it
// reports ready, so a startup error can echo a connection string, an auth
// header, or a `KEY=value` secret — and this event is sent even for opted-out
// users, so the surface must be scrubbed, not just path-redacted. Best-effort
// (denylist, never complete), applied ON TOP of scrubUserPaths.
export function scrubSecrets(value: string): string {
  return value
    // Serialized object literals embedded in a message ("error parsing config:
    // {…}") — a common carrier of config/secret values inside an otherwise-legit
    // error line, and one the key=value/URL rules below can't reach through JSON
    // quoting. Redact the whole `{…}` (greedy within a line, so nested objects
    // go too). `[…]` is deliberately left alone — it's the shape of log prefixes
    // like `[daemon]`, not where secrets hide.
    .replace(/\{[^\r\n]*\}/g, "<redacted-object>")
    // Credentials embedded in a URL / connection string: scheme://user:pass@host.
    // The password may itself contain '@' (e.g. `user:p@ss@host`), so match the
    // whole userinfo greedily up to the LAST '@' before the host rather than
    // stopping at the first '@' (which left `…<redacted>@ss@host` leaking part
    // of the password). Requires a ':' so a plain `scheme://host` isn't touched.
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s@]*:[^/\s]*@/g, "$1<redacted>@")
    // Authorization header — redact the ENTIRE value (scheme + token) to
    // end-of-line. The generic key=value rule below would only consume the
    // scheme word ("Bearer"/"Basic") and leave the credential
    // ("Authorization: Bearer abc" -> "<redacted> abc"), so handle it first.
    .replace(/(\bAuthorization\s*[:=]\s*)\S[^\r\n]*/gi, "$1<redacted>")
    // `key = value` / `key: value` secrets (password, token, secret, api_key,
    // auth, …). `auth` is kept here for bare `auth=…` fields; it can't misfire on
    // "Authorization"/"author" because a `[=:]` separator must immediately follow
    // the matched word (the Authorization *header* is handled by the rule above).
    .replace(
      /\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth)(\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'&]+)/gi,
      "$1$2<redacted>",
    )
    // Inline Bearer/Basic token values not under an Authorization header.
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 <redacted>")
    // Provider API keys by well-known prefix (OpenAI/Anthropic, PostHog, GitHub, Slack, …).
    .replace(/\b(?:sk|pk|rk|phx|phc|ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, "<redacted-token>")
    // Bare email addresses.
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<redacted-email>");
}

// A line is "diagnostically relevant" if it looks like a thrown error, a stack
// frame, a Node error code, an exit marker, OR a plain-English failure message
// ("failed to …", "could not …", "unable to …"). The failure-verb phrasings are
// how much of our own startup code reports problems (e.g. "daemon failed to
// resolve listening port", "… was found but could not …"); including them keeps
// the diagnostic value without re-opening the secret surface, because config /
// connection / KEY=value lines don't contain those verbs.
const ERROR_LINE_RE =
  /(error|exception|fatal|\bpanic\b|assert|\bthrow|unhandled|reject|abort|failed|fail(?:ing|ure)|could ?n['’]?t|could not|cannot|unable|\bERR_[A-Z0-9_]+|^\s+at\s|\bE[A-Z]{2,}\b|\b(?:code|signal)\s*[=:]|exited|not found|refused|denied|timed?\s*out)/i;

// Keep ONLY error/stack-shaped lines from a log tail. This is the primary PII
// control for `sidecar_log_tail`: rather than trying to scrub every secret shape
// out of arbitrary log text (a denylist that kept leaking — connection strings,
// auth headers, KEY=value, quoted values), we structurally exclude the config
// and connection lines where secrets live, since they don't match an error
// shape. scrubUserPaths + scrubSecrets still run on what remains as defense in
// depth (a token could appear inside an error message).
// An `UPPER_CASE_ENV=value` assignment at line start — the shape of a config /
// env dump. Excluded even when it matches ERROR_LINE_RE, because a config KEY or
// value can contain a broad failure substring (`ERROR_REPORT_EMAIL=…`,
// `SOME_ERROR_TOKEN=…`) and would otherwise re-admit the very secret-bearing
// lines the whitelist exists to keep out. Real error/stack/exit lines are not
// `UPPER=…` assignments (`code=1` is lowercase; `TypeError:`/`at …` have no
// leading `KEY=`).
const CONFIG_ASSIGNMENT_RE = /^\s*[A-Z][A-Z0-9_]{2,}\s*=/;

export function extractSidecarErrorLines(logText: string): string {
  return logText
    .split(/\r?\n/)
    .filter((line) => ERROR_LINE_RE.test(line) && !CONFIG_ASSIGNMENT_RE.test(line))
    .join("\n");
}

function osName(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "Mac OS X";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

// Stable-ish distinct id for the crash event. Best-effort reads the persistent
// installationId (survives a namespace data reset); falls back to a synthetic
// per-namespace id. Person identity is not critical for crash-distribution
// analysis — we segment on os/version/channel, not per-user funnels.
//
// `installationRoot` must be passed explicitly from `paths.installationRoot`:
// OD_INSTALLATION_DIR is only set in the daemon CHILD env, never in the packaged
// main process, so relying on the env here would always fall through to the
// synthetic id. The env is kept as a secondary fallback only.
export function resolveStartupDistinctId(
  namespace: string,
  installationRoot?: string | null,
): string {
  const dir = installationRoot?.trim() || process.env.OD_INSTALLATION_DIR?.trim();
  try {
    if (dir) {
      const raw = readFileSync(join(dir, "installation.json"), "utf8");
      const parsed = JSON.parse(raw) as { installationId?: unknown };
      if (typeof parsed.installationId === "string" && parsed.installationId.length > 0) {
        return parsed.installationId;
      }
    }
  } catch {
    // fall through to synthetic
  }
  return `packaged-${namespace}`;
}

async function defaultReadLogTail(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return buf.length > LOG_TAIL_MAX_BYTES
      ? buf.subarray(buf.length - LOG_TAIL_MAX_BYTES).toString("utf8")
      : buf.toString("utf8");
  } catch {
    return null;
  }
}

// Keep the message/stack payload bounded (a stack can be arbitrarily long).
const ERROR_MESSAGE_MAX = 1000;
const ERROR_STACK_MAX = 2000;
// The raw daemon log tail we forward. defaultReadLogTail already reads the last
// 16KB of the file; this bounds what we actually ship to the fatal error and
// its stack.
const SIDECAR_LOG_TAIL_MAX = 2500;

function truncateForTelemetry(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[+${value.length - max} chars]` : value;
}

// A log TAIL's most useful lines — the fatal error and its stack — sit at the
// END, so keep the end when trimming, unlike truncateForTelemetry which keeps
// the head of a single message/stack.
function truncateTailForTelemetry(value: string, max: number): string {
  return value.length > max
    ? `…[+${value.length - max} chars]${value.slice(value.length - max)}`
    : value;
}

// Best-effort probe: does the native module actually exist on THIS machine, and
// how big is it? The field crash is a subset of machines rather than a build
// defect (the shipped .node is present + signed + resolvable), so per-machine
// existence/size is the signal that separates "file missing" from "file present
// but unloadable (arch/quarantine/AV)".
function defaultStatNativeModule(path: string): { size: number } | null {
  try {
    const s = statSync(path);
    return s.isFile() ? { size: s.size } : null;
  } catch {
    return null;
  }
}

export interface CaptureDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => string;
  insertId?: string;
}

// Fire a single PostHog capture over plain HTTPS. No-op without a key; never
// throws; never blocks longer than `timeoutMs`.
export async function captureStartupFailure(
  args: {
    posthogKey: string | null;
    posthogHost: string | null;
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  },
  deps: CaptureDeps = {},
): Promise<void> {
  const key = args.posthogKey?.trim();
  if (!key) return; // fork builds / no key → no-op, zero network
  const host = (args.posthogHost?.trim() || DEFAULT_HOST).replace(/\/+$/, "");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? (() => new Date().toISOString());
  const insertId = deps.insertId ?? randomInsertId();
  const appVersion =
    typeof args.properties.app_version === "string" ? args.properties.app_version : null;
  const body = JSON.stringify({
    api_key: key,
    event: args.event,
    distinct_id: args.distinctId,
    properties: {
      ...args.properties,
      // Shared safety-event envelope, mirroring captureSafety in
      // apps/daemon/src/analytics.ts. posthog-node-style manual enrichment:
      // the SDK auto-fills $os/$insert_id for posthog-js but not for server
      // emits, and dashboards filter on env / event_schema_version.
      event_id: insertId,
      event_schema_version: EVENT_SCHEMA_VERSION,
      env: resolveTelemetryEnv(),
      device_id: args.distinctId,
      client_type: CLIENT_TYPE,
      capture_source: CAPTURE_SOURCE,
      ui_version: appVersion,
      $os: osName(),
      $os_version: release(),
      $insert_id: insertId,
    },
    timestamp: now(),
  });

  const send = (async () => {
    try {
      await fetchImpl(`${host}/capture/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch {
      // analytics failure must never look like a product error
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([send, timeout]);
  if (timer) clearTimeout(timer);
}

export interface ReportStartupFailureArgs {
  error: unknown;
  isPathAccess: boolean;
  posthogKey: string | null;
  posthogHost: string | null;
  distinctId: string;
  appVersion: string | null;
  namespace: string;
  source: string;
  // Absolute path to the daemon's better-sqlite3 native binding, so the report
  // can probe whether that .node exists on this machine. Optional: null skips
  // the probe (fields report null).
  nativeModulePath?: string | null;
}

export interface ReportDeps extends CaptureDeps {
  readLogTail?: (path: string) => Promise<string | null>;
  statNativeModule?: (path: string) => { size: number } | null;
}

// The single entry point index.ts's fatal-exit catch calls. Orchestrates
// classify → read log tail → parse error code → scrub → capture. Wrapped so it
// can NEVER become a new startup-failure source.
export async function reportStartupFailure(
  args: ReportStartupFailureArgs,
  deps: ReportDeps = {},
): Promise<void> {
  try {
    const classification = classifyStartupFailure(args.error, args.isPathAccess);
    let errorCode: string | undefined;
    let missingModule: string | undefined;
    let sidecarLogTail: string | null = null;
    if (classification.logPath) {
      const tail = await (deps.readLogTail ?? defaultReadLogTail)(classification.logPath);
      if (tail) {
        const parsed = parseDaemonLogTail(tail);
        errorCode = parsed.errorCode;
        missingModule = parsed.missingModule;
        // parseDaemonLogTail only recognises ERR_* and missing-module lines, so
        // it captures nothing for the majority of code=1 sidecar exits (a plain
        // Error, a config parse failure, a port bind, an assertion). Emit the
        // error/stack-shaped lines of the tail so ANY exit reason is diagnosable,
        // not just those two shapes — but WHITELISTED to error shapes so config /
        // connection / KEY=value lines (where secrets live) are structurally
        // excluded, then scrubbed as defense in depth. Null when the tail had no
        // error-shaped line. Carries whichever sidecar failed — partition on
        // failure_kind.
        const errorLines = extractSidecarErrorLines(tail);
        sidecarLogTail = errorLines
          ? truncateTailForTelemetry(scrubSecrets(scrubUserPaths(errorLines)), SIDECAR_LOG_TAIL_MAX)
          : null;
      }
    }
    const rawMessage =
      args.error instanceof Error
        ? args.error.message
        : args.error == null
          ? ""
          : String(args.error);
    const rawStack =
      args.error instanceof Error && typeof args.error.stack === "string"
        ? args.error.stack
        : null;
    // Probe the native module on THIS machine (existence + size). This is the
    // signal the `unknown` bucket (no daemon log to parse) otherwise lacks, and
    // it distinguishes "file missing" from "file present but unloadable".
    let nativeModulePresent: boolean | null = null;
    let nativeModuleSize: number | null = null;
    let nativeModulePath: string | null = null;
    if (args.nativeModulePath) {
      const stat = (deps.statNativeModule ?? defaultStatNativeModule)(args.nativeModulePath);
      nativeModulePresent = stat != null;
      nativeModuleSize = stat?.size ?? null;
      nativeModulePath = scrubUserPaths(args.nativeModulePath);
    }
    const properties: Record<string, unknown> = {
      failure_kind: classification.failureKind,
      exit_code: classification.exitCode,
      signal: classification.signal,
      error_name: args.error instanceof Error ? args.error.name : "unknown",
      error_code: errorCode ?? null,
      missing_module: missingModule ?? null,
      // Scrub every path we send (message/stack/log/native path) so a user's
      // home dir never reaches PostHog; truncate free-form text to bound the
      // payload. These crash-scene fields are why the mac subset can't resolve
      // the module and what the Windows `unknown` bucket actually threw.
      error_message: rawMessage
        ? truncateForTelemetry(scrubSecrets(scrubUserPaths(rawMessage)), ERROR_MESSAGE_MAX)
        : null,
      error_stack: rawStack
        ? truncateForTelemetry(scrubSecrets(scrubUserPaths(rawStack)), ERROR_STACK_MAX)
        : null,
      native_module_present: nativeModulePresent,
      native_module_size: nativeModuleSize,
      native_module_path: nativeModulePath,
      log_path: classification.logPath ? scrubUserPaths(classification.logPath) : null,
      sidecar_log_tail: sidecarLogTail,
      app_version: args.appVersion,
      namespace: args.namespace,
      source: args.source,
      platform: process.platform,
    };
    await captureStartupFailure(
      {
        posthogKey: args.posthogKey,
        posthogHost: args.posthogHost,
        distinctId: args.distinctId,
        event: STARTUP_FAILURE_EVENT,
        properties,
      },
      { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, now: deps.now },
    );
  } catch {
    // Reporting a startup failure must NEVER itself break the exit path.
  }
}
