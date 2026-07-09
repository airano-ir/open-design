/**
 * Coverage for the packaged main-process startup-failure telemetry
 * (apps/packaged/src/startup-telemetry.ts).
 *
 * Background: when the daemon dies before reporting status (issue #4638:
 * `better-sqlite3` vanished from the bundle → ERR_MODULE_NOT_FOUND), the
 * daemon/web sidecars — which host the PostHog client — never run, so the
 * whole crash class emits ZERO telemetry. This module emits one event from the
 * main process on the fatal-exit path. These tests pin three guarantees:
 *   1. it extracts the real error code / missing module from the #4638 log,
 *   2. it scrubs the user's home dir out of anything it sends,
 *   3. it can NEVER block the exit (timeout wins over a hung fetch) and is a
 *      no-op without a PostHog key.
 *
 * @see apps/packaged/src/startup-telemetry.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  STARTUP_FAILURE_EVENT,
  captureStartupFailure,
  classifyStartupFailure,
  parseDaemonLogTail,
  reportStartupFailure,
  resolveStartupDistinctId,
  scrubUserPaths,
  scrubSecrets,
  extractSidecarErrorLines,
} from '../src/startup-telemetry.js';

// Verbatim daemon log tail from issue #4638.
const ISSUE_4638_LOG = `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3' imported from /Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/chunks/server-PULTSXNL.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:301:9)
[open-design packaged] exited app=daemon pid=45305 code=1 signal=none`;

// A daemon that exits 1 for a reason parseDaemonLogTail cannot classify: no
// ERR_* code, no "Cannot find module". This is the production code=1 bucket
// (13 win + 7 mac in 0.14.0) whose log we read but discarded. Includes a home
// dir to assert the tail is scrubbed.
const UNCLASSIFIED_DAEMON_LOG = `2026-07-09T10:00:00.000Z [daemon] booting namespace release-stable
2026-07-09T10:00:01.000Z [daemon] DATABASE_URL=postgres://od:s3cr3tpw@db.internal/open
TypeError: Cannot read properties of undefined (reading 'port')
    at resolveListenPort (/Users/liudetao/app/prebundled/server.mjs:1201:14)
[open-design packaged] exited app=daemon pid=51001 code=1 signal=none`;

// Verbatim shape of what waitForStatus throws (sidecars.ts:206-208).
const DAEMON_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/daemon/latest.log for details';
const WEB_EXIT_MESSAGE =
  'daemon exited before reporting status (code=1, signal=none); see /Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/web/latest.log for details';

describe('parseDaemonLogTail', () => {
  it('extracts the error code and missing module from the #4638 log', () => {
    expect(parseDaemonLogTail(ISSUE_4638_LOG)).toEqual({
      errorCode: 'ERR_MODULE_NOT_FOUND',
      missingModule: 'better-sqlite3',
    });
  });

  it('returns empty when the log carries no recognizable signal', () => {
    expect(parseDaemonLogTail('daemon started ok\nlistening on 17456')).toEqual({});
  });
});

describe('classifyStartupFailure', () => {
  it('classifies a daemon-start failure and pulls code/signal/logPath', () => {
    const c = classifyStartupFailure(new Error(DAEMON_EXIT_MESSAGE), false);
    expect(c.failureKind).toBe('daemon-start');
    expect(c.exitCode).toBe(1);
    expect(c.signal).toBeNull();
    expect(c.logPath).toContain('/logs/daemon/latest.log');
  });

  it('distinguishes a web-start failure by log-path segment, not message text', () => {
    // The thrown message still literally says "daemon" even for the web
    // sidecar; the log path is the only honest discriminator.
    const c = classifyStartupFailure(new Error(WEB_EXIT_MESSAGE), false);
    expect(c.failureKind).toBe('web-start');
  });

  it('classifies a Windows (backslash) web-start log path as web-start', () => {
    // startPackagedSidecars uses path.join, so on Windows the watched log path
    // is backslash-separated. A naive "/web/" check would misreport this as
    // daemon-start — the one platform split this field exists for.
    const winWebMessage =
      'daemon exited before reporting status (code=1, signal=none); see C:\\Users\\Alice\\AppData\\Roaming\\Open Design\\namespaces\\release-stable\\logs\\web\\latest.log for details';
    expect(classifyStartupFailure(new Error(winWebMessage), false).failureKind).toBe('web-start');
  });

  it('marks path-access failures without inventing a log path', () => {
    const c = classifyStartupFailure(new Error('whatever'), true);
    expect(c.failureKind).toBe('path-access');
    expect(c.logPath).toBeNull();
  });

  it('falls back to unknown for an unrecognized error', () => {
    expect(classifyStartupFailure(new Error('boom'), false).failureKind).toBe('unknown');
  });
});

describe('scrubUserPaths', () => {
  it('redacts the user home directory but keeps the rest of the path', () => {
    const scrubbed = scrubUserPaths(
      '/Users/liudetao/Library/Application Support/Open Design/namespaces/release-stable/logs/daemon/latest.log',
    );
    expect(scrubbed).not.toContain('liudetao');
    expect(scrubbed).toContain('/Users/<redacted>/Library/Application Support');
  });

  it('redacts Windows user dirs too', () => {
    expect(scrubUserPaths('C:\\Users\\Alice\\AppData\\Roaming')).toBe(
      'C:\\Users\\<redacted>\\AppData\\Roaming',
    );
  });

  it('redacts the FULL Windows profile segment even when it contains spaces', () => {
    // A Windows profile dir can contain whitespace ("John Doe"). The redaction
    // must consume the whole segment up to the next separator, not stop at the
    // first space and leak the surname.
    const scrubbed = scrubUserPaths('C:\\Users\\John Doe\\AppData\\Roaming');
    expect(scrubbed).toBe('C:\\Users\\<redacted>\\AppData\\Roaming');
    expect(scrubbed).not.toContain('Doe');
  });

  it('scrubs a spaced Windows profile embedded in a crash message/stack', () => {
    const raw =
      "Cannot find package 'better-sqlite3' imported from C:\\Users\\John Doe\\App\\Resources\\app\\daemon\\server.mjs";
    const scrubbed = scrubUserPaths(raw);
    expect(scrubbed).not.toContain('John Doe');
    expect(scrubbed).not.toContain('Doe');
    expect(scrubbed).toContain('C:\\Users\\<redacted>\\App\\Resources');
  });

  it('redacts SLASH-separated Windows home paths with spaces (forward-slash form)', () => {
    // JS/Electron/Node diagnostics frequently normalize Windows paths to forward
    // slashes; the profile segment can still contain a literal space. The POSIX
    // "/Users/" rule alone would stop at the space and leak the tail.
    expect(scrubUserPaths('C:/Users/John Doe/AppData/Roaming')).toBe(
      'C:/Users/<redacted>/AppData/Roaming',
    );
  });

  it('scrubs a slash-form spaced Windows profile embedded in a crash message', () => {
    const raw =
      "Cannot find package 'better-sqlite3' imported from C:/Users/John Doe/App/Resources/app/daemon/server.mjs";
    const scrubbed = scrubUserPaths(raw);
    expect(scrubbed).not.toContain('John Doe');
    expect(scrubbed).not.toContain('Doe');
    expect(scrubbed).toContain('C:/Users/<redacted>/App/Resources');
  });

  it('does not over-redact across lines in a multi-line stack', () => {
    const scrubbed = scrubUserPaths('a C:\\Users\\John Doe\\x\nb /Users/bob/y');
    expect(scrubbed).toBe('a C:\\Users\\<redacted>\\x\nb /Users/<redacted>/y');
  });

  it('redacts a UNC \\\\server\\Profiles\\<user> segment', () => {
    expect(scrubUserPaths('\\\\CORP-FS\\Profiles\\jdoe\\od\\config.json')).toBe(
      '\\\\CORP-FS\\Profiles\\<redacted>\\od\\config.json',
    );
    expect(scrubUserPaths('\\\\CORP-FS\\Profiles\\jdoe\\od\\config.json')).not.toContain('jdoe');
  });
});

describe('scrubSecrets', () => {
  it('redacts a password embedded in a connection string', () => {
    const out = scrubSecrets('DATABASE_URL=postgres://od:s3cr3tpw@db.internal:5432/open');
    expect(out).not.toContain('s3cr3tpw');
    expect(out).toContain('postgres://<redacted>@db.internal');
  });

  it('redacts a connection-string password that itself contains @, keeping the host', () => {
    // Greedy userinfo must consume up to the LAST @ before the host, or part of
    // the password ("ss") leaks and the host is rewritten.
    expect(scrubSecrets('postgres://user:p@ss@host/db')).toBe('postgres://<redacted>@host/db');
    expect(scrubSecrets('postgres://user:p@ss@host/db')).not.toContain('p@ss');
  });

  it('redacts the ENTIRE Authorization header value, not just the scheme word', () => {
    // Regression (nettee): the key=value branch consumed only "Bearer" and left
    // the token — "Authorization: Bearer abc" became "<redacted> abc".
    expect(scrubSecrets('Authorization: Bearer abc12345')).toBe('Authorization: <redacted>');
    expect(scrubSecrets('Authorization: Basic Zm9vOmJhcg==')).toBe('Authorization: <redacted>');
    expect(scrubSecrets('Authorization: Bearer abc12345')).not.toContain('abc12345');
    expect(scrubSecrets('Authorization: Basic Zm9vOmJhcg==')).not.toContain('Zm9vOmJhcg');
  });

  it('redacts inline provider api keys not under an Authorization header', () => {
    expect(scrubSecrets('using key sk-ant-api03-ABC123DEF456GHI789 now')).toContain('<redacted-token>');
    expect(scrubSecrets('using key sk-ant-api03-ABC123DEF456GHI789 now')).not.toContain('ABC123DEF456');
  });

  it('redacts a bare auth=… / auth: … field without misfiring on author or the header', () => {
    expect(scrubSecrets('auth=abc12345')).toBe('auth=<redacted>');
    expect(scrubSecrets('auth: abc12345')).toBe('auth: <redacted>');
    // A `[=:]` must follow the word, so "author"/"Authorization" don't misfire here.
    expect(scrubSecrets('author=jane')).toBe('author=jane');
    expect(scrubSecrets('Authorization: Bearer abc12345')).toBe('Authorization: <redacted>');
  });

  it('redacts key=value secrets and bare emails', () => {
    expect(scrubSecrets('password=hunter2 token: abc12345')).toBe('password=<redacted> token: <redacted>');
    expect(scrubSecrets('login failed for user ontf116@gmail.com')).toBe(
      'login failed for user <redacted-email>',
    );
  });

  it('redacts quoted secret values that contain spaces or special chars', () => {
    expect(scrubSecrets('password="hunter 2"')).toBe('password=<redacted>');
    expect(scrubSecrets('token="abc&def"')).toBe('token=<redacted>');
    expect(scrubSecrets('api_key: "abc def"')).toBe('api_key: <redacted>');
  });

  it('redacts secrets embedded in a serialized object inside an error message', () => {
    expect(scrubSecrets('error parsing config: {"x-api-key":"secret-value-123"}')).toBe(
      'error parsing config: <redacted-object>',
    );
    expect(scrubSecrets('error parsing config: {"access_token":"tok-123"}')).not.toContain('tok-123');
    expect(scrubSecrets('boot failed with {"a":{"client_secret":"hunter2"}}')).not.toContain('hunter2');
    // Log prefixes like [daemon] are left intact.
    expect(scrubSecrets('[daemon] starting up')).toBe('[daemon] starting up');
  });

  it('leaves ordinary diagnostic text (stack frames, module paths) intact', () => {
    const stack = "TypeError: Cannot read properties of undefined (reading 'port')\n    at resolveListenPort (server.mjs:1201:14)";
    expect(scrubSecrets(stack)).toBe(stack);
  });
});

describe('extractSidecarErrorLines', () => {
  it('keeps error/stack/exit lines and drops config/log-noise lines', () => {
    const log = [
      '[daemon] booting namespace release-stable',
      'DATABASE_URL=postgres://od:s3cr3tpw@db/x',
      "TypeError: Cannot read properties of undefined (reading 'port')",
      '    at resolveListenPort (server.mjs:1201:14)',
      'Error: listen EADDRINUSE: address already in use :::8080',
      '[open-design packaged] exited app=daemon pid=1 code=1 signal=none',
    ].join('\n');
    const out = extractSidecarErrorLines(log);
    expect(out).toContain('TypeError: Cannot read');
    expect(out).toContain('at resolveListenPort');
    expect(out).toContain('EADDRINUSE');
    expect(out).toContain('code=1');
    // Structural PII control: the secret-bearing config lines are excluded.
    expect(out).not.toContain('DATABASE_URL');
    expect(out).not.toContain('s3cr3tpw');
    expect(out).not.toContain('booting namespace');
  });

  it('keeps plain-English failure messages (failed to / could not / cannot / unable)', () => {
    const log = [
      '[daemon] booting',
      'DATABASE_URL=postgres://od:s3cr3tpw@db/x',
      '[od] daemon failed to resolve listening port 8080',
      'better-sqlite3 was found but could not be loaded',
      'cannot open config',
      'unable to bind socket',
    ].join('\n');
    const out = extractSidecarErrorLines(log);
    expect(out).toContain('failed to resolve listening port');
    expect(out).toContain('could not be loaded');
    expect(out).toContain('cannot open config');
    expect(out).toContain('unable to bind socket');
    // Broadening to failure verbs must not re-admit the secret-bearing config line.
    expect(out).not.toContain('s3cr3tpw');
    expect(out).not.toContain('DATABASE_URL');
  });

  it('excludes UPPER_CASE=… config assignments even when the key contains a failure word', () => {
    const log = [
      'ERROR_REPORT_EMAIL=alice@example.com',
      'SOME_ERROR_TOKEN=s3cr3tvalue',
      'DATABASE_URL=postgres://od:pw@db/x',
      "TypeError: boom",
    ].join('\n');
    const out = extractSidecarErrorLines(log);
    expect(out).toBe('TypeError: boom');
    expect(out).not.toContain('ERROR_REPORT_EMAIL');
    expect(out).not.toContain('alice@example.com');
    expect(out).not.toContain('s3cr3tvalue');
  });

  it('returns an empty string when nothing looks like an error', () => {
    expect(extractSidecarErrorLines('booting\nlistening on 8080\nready')).toBe('');
  });
});

describe('resolveStartupDistinctId', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.OD_INSTALLATION_DIR;
  });

  it('reads installationId from an explicit installationRoot (not the child-only env)', () => {
    const root = mkdtempSync(join(tmpdir(), 'od-install-'));
    dirs.push(root);
    writeFileSync(join(root, 'installation.json'), JSON.stringify({ installationId: 'inst-abc' }));
    // env is intentionally unset — proving the parent process resolves via the
    // explicit arg, the bug PerishCode flagged.
    expect(resolveStartupDistinctId('release-stable', root)).toBe('inst-abc');
  });

  it('falls back to a synthetic per-namespace id when no installation file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'od-install-'));
    dirs.push(root);
    expect(resolveStartupDistinctId('release-stable', root)).toBe('packaged-release-stable');
  });
});

describe('captureStartupFailure', () => {
  it('is a no-op (zero network) without a PostHog key', async () => {
    const fetchImpl = vi.fn();
    await captureStartupFailure(
      { posthogKey: null, posthogHost: null, distinctId: 'd', event: 'e', properties: {} },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs to /capture/ with the PostHog wire shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await captureStartupFailure(
      {
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
        distinctId: 'install-123',
        event: STARTUP_FAILURE_EVENT,
        properties: { failure_kind: 'daemon-start' },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => '2026-06-23T00:00:00.000Z' },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/capture/');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.api_key).toBe('phc_test');
    expect(body.event).toBe(STARTUP_FAILURE_EVENT);
    expect(body.distinct_id).toBe('install-123');
    expect((body.properties as Record<string, unknown>).failure_kind).toBe('daemon-start');
    expect((body.properties as Record<string, unknown>).$os).toBeDefined();
  });

  it('stamps the shared safety-event envelope so dashboards bucket it', async () => {
    // Mirrors captureSafety in apps/daemon/src/analytics.ts. Without these,
    // env/schema-filtered dashboards miss or mis-bucket the event even though
    // PostHog accepts the raw payload (PerishCode review on #4696).
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await captureStartupFailure(
      {
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'install-123',
        event: STARTUP_FAILURE_EVENT,
        properties: { failure_kind: 'daemon-start', app_version: '0.11.0' },
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => '2026-06-23T00:00:00.000Z',
        insertId: 'ins-fixed',
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const p = (JSON.parse(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(p.event_schema_version).toBe(2);
    expect(p.device_id).toBe('install-123');
    expect(p.client_type).toBe('packaged_main');
    expect(p.capture_source).toBe('packaged/startup');
    expect(p.ui_version).toBe('0.11.0');
    expect(p.event_id).toBe('ins-fixed');
    expect(p.$insert_id).toBe('ins-fixed');
    expect(typeof p.env).toBe('string');
  });

  it('never blocks past the timeout even if fetch hangs forever', async () => {
    // The critical guarantee for "no startup side-effect": a hung (offline)
    // request must not wedge the exit. Race must resolve via the timeout.
    const hung = new Promise<Response>(() => {
      /* never resolves */
    });
    const fetchImpl = vi.fn().mockReturnValue(hung);
    const start = Date.now();
    await captureStartupFailure(
      { posthogKey: 'phc_test', posthogHost: null, distinctId: 'd', event: 'e', properties: {} },
      { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 30 },
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('swallows a fetch that throws (analytics failure is not a product error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(
      captureStartupFailure(
        { posthogKey: 'phc_test', posthogHost: null, distinctId: 'd', event: 'e', properties: {} },
        { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('reportStartupFailure', () => {
  it('reads the log tail, enriches the event, scrubs paths, and sends once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'install-123',
        appVersion: '0.11.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => ISSUE_4638_LOG,
        now: () => '2026-06-23T00:00:00.000Z',
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.failure_kind).toBe('daemon-start');
    expect(props.error_code).toBe('ERR_MODULE_NOT_FOUND');
    expect(props.missing_module).toBe('better-sqlite3');
    expect(props.app_version).toBe('0.11.0');
    expect(props.exit_code).toBe(1);
    expect(props.log_path).not.toContain('liudetao');
    // The raw tail is forwarded alongside the extracted fields, scrubbed.
    expect(props.sidecar_log_tail).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('forwards the scrubbed raw daemon log tail when the cause is not an ERR_ code or missing module', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'install-123',
        appVersion: '0.14.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => UNCLASSIFIED_DAEMON_LOG,
        now: () => '2026-06-23T00:00:00.000Z',
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    // The two structured extractors classify nothing for this exit...
    expect(props.error_code).toBeNull();
    expect(props.missing_module).toBeNull();
    const tail = props.sidecar_log_tail as string;
    // ...but the error/stack lines are forwarded so the cause is diagnosable.
    expect(tail).toContain("TypeError: Cannot read properties of undefined (reading 'port')");
    expect(tail).toContain('at resolveListenPort');
    // The whitelist structurally excludes non-error lines — the DATABASE_URL
    // config line (and its password) never reaches telemetry at all.
    expect(tail).not.toContain('DATABASE_URL');
    expect(tail).not.toContain('s3cr3tpw');
    // A home dir inside a kept stack frame is still scrubbed (defense in depth).
    expect(tail).not.toContain('liudetao');
    expect(tail).toContain('<redacted>');
  });

  it('sends no sidecar_log_tail when the tail has no error-shaped line', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'd',
        appVersion: '0.14.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        // Pure config/log noise, no error shape — nothing diagnostically useful,
        // and nowhere for a secret to hide.
        readLogTail: async () =>
          'booting\nDATABASE_URL=postgres://od:s3cr3tpw@db/x\nlistening on 8080',
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    expect(props.sidecar_log_tail).toBeNull();
  });

  it('keeps the END of an oversized daemon log so the fatal error is not truncated away', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    // Many error-shaped lines (so the whitelist keeps them) exceeding the cap,
    // with the fatal marker last — the tail-truncation must preserve the END.
    const noise = Array.from({ length: 120 }, (_, i) => `Error: transient failure number ${i} at handler`).join('\n');
    const bigLog = `${noise}\nFATAL: daemon boot aborted at the very end`;
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'd',
        appVersion: '0.14.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, readLogTail: async () => bigLog },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> })
      .properties;
    const tail = props.sidecar_log_tail as string;
    expect(tail).toContain('FATAL: daemon boot aborted at the very end');
    expect(tail).toContain('chars]');
    expect(tail.length).toBeLessThan(bigLog.length);
  });

  it('never throws even when the log read blows up', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(
      reportStartupFailure(
        {
          error: new Error(DAEMON_EXIT_MESSAGE),
          isPathAccess: false,
          posthogKey: 'phc_test',
          posthogHost: null,
          distinctId: 'd',
          appVersion: '0.11.0',
          namespace: 'release-stable',
          source: 'packaged',
        },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          readLogTail: async () => {
            throw new Error('disk gone');
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('is a no-op without a PostHog key (fork builds)', async () => {
    const fetchImpl = vi.fn();
    await reportStartupFailure(
      {
        error: new Error(DAEMON_EXIT_MESSAGE),
        isPathAccess: false,
        posthogKey: null,
        posthogHost: null,
        distinctId: 'd',
        appVersion: '0.11.0',
        namespace: 'release-stable',
        source: 'packaged',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, readLogTail: async () => ISSUE_4638_LOG },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Why these exist: the field crash is a SUBSET of machines (verified 2026-07-06
  // — the shipped 0.13.0 DMG's better_sqlite3.node is present, signed, notarized,
  // and resolvable, so it is NOT a build defect). To learn WHY a given machine
  // can't load it, the event must carry on-machine evidence: the scrubbed error
  // message/stack (the only signal for the `unknown` bucket, which has no daemon
  // log to parse) and whether the native module file actually exists there.
  it('captures scrubbed error message/stack + native-module probe (on-machine evidence)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const error = new Error(
      "Cannot find package 'better-sqlite3' imported from /Users/liudetao/App/Contents/Resources/app/prebundled/daemon/server.mjs",
    );
    error.stack = `${error.message}\n    at file:///Users/liudetao/App/Contents/Resources/app/prebundled/daemon/server.mjs:1:1`;
    await reportStartupFailure(
      {
        error,
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'd',
        appVersion: '0.13.0',
        namespace: 'release-stable',
        source: 'packaged',
        nativeModulePath:
          '/Users/liudetao/App/Contents/Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => null,
        statNativeModule: (p) => (p.endsWith('better_sqlite3.node') ? { size: 1_234_567 } : null),
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> }).properties;
    // scrubbed message/stack: content kept, home dir gone.
    expect(props.error_message).toContain("Cannot find package 'better-sqlite3'");
    expect(props.error_message).not.toContain('liudetao');
    expect(String(props.error_stack)).not.toContain('liudetao');
    // native-module probe answers "is the .node actually on THIS machine".
    expect(props.native_module_present).toBe(true);
    expect(props.native_module_size).toBe(1_234_567);
    expect(props.native_module_path).not.toContain('liudetao');
  });

  it('reports native_module_present=false when the .node is missing on the machine', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await reportStartupFailure(
      {
        error: new Error('boom'),
        isPathAccess: false,
        posthogKey: 'phc_test',
        posthogHost: null,
        distinctId: 'd',
        appVersion: '0.13.0',
        namespace: 'release-stable',
        source: 'packaged',
        nativeModulePath: '/a/b/better_sqlite3.node',
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        readLogTail: async () => null,
        statNativeModule: () => null,
      },
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const props = (JSON.parse(init.body as string) as { properties: Record<string, unknown> }).properties;
    expect(props.native_module_present).toBe(false);
    expect(props.native_module_size).toBeNull();
  });
});
