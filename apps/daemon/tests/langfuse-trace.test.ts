import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFeedbackPayload,
  buildTelemetryIdempotencyKey,
  canDeliverRunFeedback,
  canDeliverRunTelemetry,
  feedbackIngestionRevision,
  buildTracePayload,
  deriveLangfuseDeliveryState,
  readAnonymousTelemetrySinkConfig,
  readLangfuseConfig,
  readLegacyAnonymousAcceptedSinkConfig,
  readTelemetrySinkConfig,
  readTelemetrySinkConfigForChannel,
  clearRunAwaitingFinalAcceptance,
  configureDeferredFeedbackDataDir,
  hasPendingRunFeedbackForTests,
  markRunAwaitingFinalAcceptance,
  rememberAcceptedFinalTraceBodyId,
  reportRunCompleted,
  reportRunFeedback,
  resetAcceptedFinalTraceBodyIdsForTests,
  resetPendingRunFeedbackForTests,
  resolveFeedbackTraceId,
  scopedTelemetryBodyId,
  setLiveTelemetryPrefsReaderForTests,
  shouldDeferRunFeedback,
  stableIngestionEventId,
  TERMINAL_FALLBACK_LATE_FINAL_FEEDBACK_MS,
  toVelaTelemetryEnvelope,
  velaSinkIdentityFingerprint,
  type FeedbackReportContext,
  type LangfuseConfig,
  type ReportContext,
  type TelemetrySinkConfig,
} from '../src/langfuse-trace.js';
import { buildPromptStackTelemetry } from '../src/prompt-telemetry.js';

function makeCtx(overrides: Partial<ReportContext> = {}): ReportContext {
  const base: ReportContext = {
    installationId: 'install-uuid-1',
    projectId: 'proj-1',
    conversationId: 'conv-uuid-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    agentId: 'claude',
    run: {
      runId: 'run-1',
      status: 'succeeded',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_004_500,
    },
    message: {
      messageId: 'msg-1',
      prompt: 'Make a landing page for a coffee shop.',
      output: 'Here is a landing page draft …',
      usage: {
        inputTokens: 1234,
        inputTokensProvider: 1234,
        inputTokensEffective: 1484,
        outputTokens: 567,
        totalTokens: 2051,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 50,
        uncachedInputTokens: 1234,
        estimatedContextTokens: 1350,
        cacheHitRatio: 0.1347708894878706,
        cacheTokenSource: 'anthropic',
      },
    },
    artifacts: [],
    tools: [
      {
        id: 'tool-1',
        name: 'Bash',
        startedAt: 1_700_000_001_000,
        endedAt: 1_700_000_001_800,
        input: '{"command":"ls -la"}',
        output: 'total 0',
      },
      {
        id: 'tool-2',
        name: 'Write',
        startedAt: 1_700_000_002_000,
        endedAt: 1_700_000_002_900,
        input: '{"path":"index.html"}',
        output: 'wrote index.html',
      },
    ],
    eventsSummary: { toolCalls: 2, errors: 0, durationMs: 4500 },
    prefs: { metrics: true, content: false, artifactManifest: false },
  };
  return { ...base, ...overrides };
}

const TEST_CONFIG: LangfuseConfig = {
  authHeader: 'Basic dGVzdA==',
  baseUrl: 'https://us.cloud.langfuse.com',
  timeoutMs: 20_000,
  retries: 0,
};

function bodyOf(
  batch: unknown[],
  type: string,
  name?: string,
): Record<string, any> {
  const event = (batch as Array<{ type: string; body: Record<string, any> }>).find(
    (item) => item.type === type && (name === undefined || item.body.name === name),
  );
  expect(event).toBeTruthy();
  return event!.body;
}

describe('readLangfuseConfig', () => {
  it('returns null when keys are missing', () => {
    expect(readLangfuseConfig({})).toBeNull();
    expect(readLangfuseConfig({ LANGFUSE_PUBLIC_KEY: 'pk' })).toBeNull();
    expect(readLangfuseConfig({ LANGFUSE_SECRET_KEY: 'sk' })).toBeNull();
  });

  it('returns null when keys are whitespace-only', () => {
    expect(
      readLangfuseConfig({
        LANGFUSE_PUBLIC_KEY: '   ',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBeNull();
  });

  it('builds Basic auth header from public:secret', () => {
    const cfg = readLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk-lf-abc',
      LANGFUSE_SECRET_KEY: 'sk-lf-xyz',
    });
    expect(cfg).not.toBeNull();
    const expected =
      'Basic ' + Buffer.from('pk-lf-abc:sk-lf-xyz').toString('base64');
    expect(cfg!.authHeader).toBe(expected);
  });

  it('uses default US base URL when LANGFUSE_BASE_URL is absent', () => {
    const cfg = readLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    expect(cfg!.baseUrl).toBe('https://us.cloud.langfuse.com');
  });

  it('honours LANGFUSE_BASE_URL and strips trailing slashes', () => {
    const cfg = readLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com//',
    });
    expect(cfg!.baseUrl).toBe('https://cloud.langfuse.com');
  });

  it('reads optional timeout and retry tuning from env', () => {
    const cfg = readLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_TIMEOUT_MS: '45000',
      LANGFUSE_RETRIES: '2',
    });
    expect(cfg!.timeoutMs).toBe(45_000);
    expect(cfg!.retries).toBe(2);
  });

  it('falls back when timeout and retry env values are invalid', () => {
    const cfg = readLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_TIMEOUT_MS: '-1',
      LANGFUSE_RETRIES: '-2',
    });
    expect(cfg!.timeoutMs).toBe(20_000);
    expect(cfg!.retries).toBe(1);
  });
});

describe('readTelemetrySinkConfig', () => {
  it('prefers the Vela authenticated sink when a Control Key is present', () => {
    const cfg = readTelemetrySinkConfig({
      VELA_CONTROL_KEY: 'ck_test_key',
      VELA_API_URL: 'https://amr-api.example.com//',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    expect(cfg).toEqual({
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 1,
      profile: 'prod',
      authSource: 'env',
    });
  });

  it('uses app-config AMR profile/API URL when resolving the Vela sink', () => {
    const cfg = readTelemetrySinkConfig(
      {
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      },
      {
        OPEN_DESIGN_AMR_PROFILE: 'test',
        VELA_CONTROL_KEY: 'ck_from_app_config',
        VELA_API_URL: 'https://amr-api-test.example.com//',
      },
    );
    expect(cfg).toEqual({
      kind: 'vela',
      apiUrl: 'https://amr-api-test.example.com',
      controlKey: 'ck_from_app_config',
      timeoutMs: 20_000,
      retries: 1,
      profile: 'test',
      authSource: 'env',
    });
  });

  it('can disable the Vela sink for gray rollback', () => {
    const cfg = readTelemetrySinkConfig({
      OPEN_DESIGN_VELA_TELEMETRY: '0',
      VELA_CONTROL_KEY: 'ck_test_key',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse//',
    });
    expect(cfg).toEqual({
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 1,
    });
  });

  it('prefers the Open Design telemetry relay when configured', () => {
    const cfg = readTelemetrySinkConfig({
      // Force anonymous path even if the developer machine has a local Control Key.
      OPEN_DESIGN_VELA_TELEMETRY: '0',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse//',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    expect(cfg).toEqual({
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 1,
    });
  });

  it('uses relay-specific timeout and retry tuning when present', () => {
    const cfg = readTelemetrySinkConfig({
      OPEN_DESIGN_VELA_TELEMETRY: '0',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      OPEN_DESIGN_TELEMETRY_TIMEOUT_MS: '30000',
      OPEN_DESIGN_TELEMETRY_RETRIES: '3',
      LANGFUSE_TIMEOUT_MS: '1',
      LANGFUSE_RETRIES: '0',
    });
    expect(cfg).toMatchObject({
      kind: 'relay',
      timeoutMs: 30_000,
      retries: 3,
    });
  });

  it('falls back to direct Langfuse config for local smoke tests', () => {
    const cfg = readTelemetrySinkConfig({
      OPEN_DESIGN_VELA_TELEMETRY: '0',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    expect(cfg).toMatchObject({
      kind: 'langfuse',
      baseUrl: 'https://us.cloud.langfuse.com',
    });
  });

  it('exposes an anonymous-only resolver that never returns Vela', () => {
    const cfg = readAnonymousTelemetrySinkConfig({
      VELA_CONTROL_KEY: 'ck_test_key',
      OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
    });
    expect(cfg).toMatchObject({ kind: 'relay' });
  });
});

describe('readLegacyAnonymousAcceptedSinkConfig', () => {
  it('returns null when both relay and direct Langfuse are viable', () => {
    // Ambiguous pre-migration channel: cannot know which backend accepted.
    expect(
      readLegacyAnonymousAcceptedSinkConfig({
        OPEN_DESIGN_TELEMETRY_RELAY_URL:
          'https://telemetry.open-design.ai/api/langfuse',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      }),
    ).toBeNull();
  });

  it('selects relay when only the relay is configured', () => {
    expect(
      readLegacyAnonymousAcceptedSinkConfig({
        OPEN_DESIGN_TELEMETRY_RELAY_URL:
          'https://telemetry.open-design.ai/api/langfuse',
        VELA_CONTROL_KEY: 'ck_test_key',
      }),
    ).toMatchObject({
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
    });
  });

  it('selects direct Langfuse when only Langfuse credentials are configured', () => {
    expect(
      readLegacyAnonymousAcceptedSinkConfig({
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
        VELA_CONTROL_KEY: 'ck_test_key',
      }),
    ).toMatchObject({
      kind: 'langfuse',
      baseUrl: 'https://us.cloud.langfuse.com',
    });
  });

  it('returns null when neither anonymous backend is configured', () => {
    expect(
      readLegacyAnonymousAcceptedSinkConfig({
        VELA_CONTROL_KEY: 'ck_test_key',
      }),
    ).toBeNull();
  });
});

describe('readTelemetrySinkConfigForChannel', () => {
  const bothSinksEnv = {
    VELA_CONTROL_KEY: 'ck_test_key',
    VELA_API_URL: 'https://amr-api.example.com',
    OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
    LANGFUSE_PUBLIC_KEY: 'pk',
    LANGFUSE_SECRET_KEY: 'sk',
  } as const;

  it('returns the preferred sink when no sticky channel is set', () => {
    expect(readTelemetrySinkConfigForChannel(null, bothSinksEnv)).toMatchObject({
      kind: 'vela',
    });
  });

  it('selects relay even when Vela is preferred globally', () => {
    expect(readTelemetrySinkConfigForChannel('relay', bothSinksEnv)).toEqual({
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 1,
    });
  });

  it('selects direct Langfuse even when relay is preferred anonymously', () => {
    expect(readTelemetrySinkConfigForChannel('langfuse', bothSinksEnv)).toMatchObject({
      kind: 'langfuse',
      baseUrl: 'https://us.cloud.langfuse.com',
    });
  });

  it('selects Vela when the sticky channel is Vela', () => {
    expect(readTelemetrySinkConfigForChannel('vela', bothSinksEnv)).toMatchObject({
      kind: 'vela',
      controlKey: 'ck_test_key',
    });
  });

  it('returns null when the sticky channel is unavailable', () => {
    expect(
      readTelemetrySinkConfigForChannel('relay', {
        VELA_CONTROL_KEY: 'ck_test_key',
      }),
    ).toBeNull();
    expect(
      readTelemetrySinkConfigForChannel('langfuse', {
        OPEN_DESIGN_TELEMETRY_RELAY_URL:
          'https://telemetry.open-design.ai/api/langfuse',
      }),
    ).toBeNull();
  });
});

describe('canDeliverRunFeedback', () => {
  const velaSink: TelemetrySinkConfig = {
    kind: 'vela',
    apiUrl: 'https://amr-api.example.com',
    controlKey: 'ck_test_key',
    timeoutMs: 20_000,
    retries: 1,
    profile: 'prod',
    authSource: 'env',
  };
  const relaySink: TelemetrySinkConfig = {
    kind: 'relay',
    relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
    timeoutMs: 20_000,
    retries: 1,
  };

  it('rejects a null sink', () => {
    expect(canDeliverRunFeedback(null, 'install-1')).toBe(false);
  });

  it('accepts anonymous sinks without an installation id', () => {
    expect(canDeliverRunFeedback(relaySink, null)).toBe(true);
    expect(canDeliverRunFeedback(relaySink, undefined)).toBe(true);
  });

  it('accepts Vela when installationId is present', () => {
    expect(canDeliverRunFeedback(velaSink, 'install-1', {})).toBe(true);
  });

  it('rejects Vela without installationId when no anonymous sink exists', () => {
    expect(canDeliverRunFeedback(velaSink, null, {})).toBe(false);
    expect(canDeliverRunFeedback(velaSink, '   ', {})).toBe(false);
  });

  it('accepts Vela without installationId when anonymous fallback exists', () => {
    expect(
      canDeliverRunFeedback(velaSink, null, {
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      }),
    ).toBe(true);
  });

  it('rejects anonymous fallback when the accepted channel is Vela', () => {
    expect(
      canDeliverRunFeedback(
        relaySink,
        'install-1',
        {},
        { requireChannel: 'vela' },
      ),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(velaSink, null, {
        OPEN_DESIGN_TELEMETRY_RELAY_URL: 'https://telemetry.open-design.ai/api/langfuse',
      }, { requireChannel: 'vela' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(velaSink, 'install-1', {}, { requireChannel: 'vela' }),
    ).toBe(true);
  });

  it('requires exact channel match for every accepted delivery channel', () => {
    const langfuseSink: TelemetrySinkConfig = {
      kind: 'langfuse',
      authHeader: 'Basic dGVzdA==',
      baseUrl: 'https://langfuse.example',
      timeoutMs: 1_000,
      retries: 0,
    };
    // Accepted relay must not post through Vela or direct Langfuse.
    expect(
      canDeliverRunFeedback(velaSink, 'install-1', {}, { requireChannel: 'relay' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(langfuseSink, 'install-1', {}, { requireChannel: 'relay' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(relaySink, null, {}, { requireChannel: 'relay' }),
    ).toBe(true);
    // Accepted langfuse must not post through relay/vela.
    expect(
      canDeliverRunFeedback(relaySink, null, {}, { requireChannel: 'langfuse' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(velaSink, 'install-1', {}, { requireChannel: 'langfuse' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(langfuseSink, null, {}, { requireChannel: 'langfuse' }),
    ).toBe(true);
    // Accepted vela must not post through relay/langfuse.
    expect(
      canDeliverRunFeedback(relaySink, 'install-1', {}, { requireChannel: 'vela' }),
    ).toBe(false);
    expect(
      canDeliverRunFeedback(langfuseSink, 'install-1', {}, { requireChannel: 'vela' }),
    ).toBe(false);
  });

  it('rejects Vela feedback when the accepting account fingerprint mismatches', () => {
    const identity = velaSinkIdentityFingerprint('prod', 'ck_test_key');
    expect(identity).toBeTruthy();
    expect(
      canDeliverRunFeedback(velaSink, 'install-1', {}, {
        requireChannel: 'vela',
        requireVelaIdentity: identity,
      }),
    ).toBe(true);
    expect(
      canDeliverRunFeedback(velaSink, 'install-1', {}, {
        requireChannel: 'vela',
        requireVelaIdentity: 'prod:deadbeefdeadbeef',
      }),
    ).toBe(false);
    const otherKeySink: TelemetrySinkConfig = {
      ...velaSink,
      controlKey: 'ck_other_account',
      profile: 'prod',
    };
    expect(
      canDeliverRunFeedback(otherKeySink, 'install-1', {}, {
        requireChannel: 'vela',
        requireVelaIdentity: identity,
      }),
    ).toBe(false);
  });
});

describe('deriveLangfuseDeliveryState', () => {
  it('marks traces not expected when metrics consent is off', () => {
    expect(
      deriveLangfuseDeliveryState(
        { metrics: false, content: true, artifactManifest: true },
        { kind: 'langfuse', ...TEST_CONFIG },
      ),
    ).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'metrics_consent_off',
    });
  });

  it('marks traces not expected when content consent is off', () => {
    expect(
      deriveLangfuseDeliveryState(
        { metrics: true, content: false, artifactManifest: true },
        { kind: 'langfuse', ...TEST_CONFIG },
      ),
    ).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'content_consent_off',
    });
  });

  it('marks traces not expected when no sink is configured', () => {
    expect(
      deriveLangfuseDeliveryState(
        { metrics: true, content: true, artifactManifest: true },
        null,
      ),
    ).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'missing_sink_config',
    });
  });

  it('marks eligible traces as queued at run-finished time', () => {
    expect(
      deriveLangfuseDeliveryState(
        { metrics: true, content: true, artifactManifest: true },
        { kind: 'langfuse', ...TEST_CONFIG },
      ),
    ).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'queued',
    });
  });

  it('marks Vela without installationId and no anonymous fallback as failed missing_sink_config', () => {
    const velaSink: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 1,
      profile: 'prod',
      authSource: 'env',
    };
    expect(
      deriveLangfuseDeliveryState(
        { metrics: true, content: true, artifactManifest: true },
        velaSink,
        { installationId: null, env: {} },
      ),
    ).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'missing_sink_config',
    });
    expect(canDeliverRunTelemetry(velaSink, null, {})).toBe(false);
  });

  it('keeps Vela queued when installationId is present', () => {
    const velaSink: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 1,
      profile: 'prod',
      authSource: 'env',
    };
    expect(
      deriveLangfuseDeliveryState(
        { metrics: true, content: true, artifactManifest: true },
        velaSink,
        { installationId: 'install-1', env: {} },
      ),
    ).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'queued',
    });
  });
});

describe('resolveFeedbackTraceId', () => {
  afterEach(() => {
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
  });

  it('defaults to the canonical runId', () => {
    expect(resolveFeedbackTraceId({ runId: 'run-a' })).toBe('run-a');
  });

  it('keeps the canonical id when failed/canceled but no accepted fallback anchor exists', () => {
    // Immediate thumbs-up/down after a failed run must not invent runId:tf
    // before terminal_fallback is accepted (or while late finalization may
    // still cancel the fallback and publish only the canonical trace).
    expect(
      resolveFeedbackTraceId({
        runId: 'run-failed',
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe('run-failed');
    expect(
      resolveFeedbackTraceId({
        runId: 'run-canceled',
        runStatus: 'canceled',
      }),
    ).toBe('run-canceled');
  });

  it('keeps the canonical id when the message was telemetry-finalized', () => {
    expect(
      resolveFeedbackTraceId({
        runId: 'run-finalized',
        runStatus: 'failed',
        telemetryFinalized: true,
      }),
    ).toBe('run-finalized');
  });

  it('uses a remembered terminal_fallback body id only after acceptance', () => {
    expect(
      resolveFeedbackTraceId({
        runId: 'run-tf-accept',
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe('run-tf-accept');
    rememberAcceptedFinalTraceBodyId(
      'run-tf-accept',
      'run-tf-accept:tf',
      'terminal_fallback',
    );
    expect(
      resolveFeedbackTraceId({
        runId: 'run-tf-accept',
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe('run-tf-accept:tf');
  });

  it('prefers the accepted final_message body id over a prior terminal_fallback memory', () => {
    rememberAcceptedFinalTraceBodyId('run-mem', 'run-mem:tf', 'terminal_fallback');
    rememberAcceptedFinalTraceBodyId('run-mem', 'run-mem', 'final_message');
    expect(resolveFeedbackTraceId({ runId: 'run-mem' })).toBe('run-mem');
    // Late fallback must not demote the canonical anchor.
    rememberAcceptedFinalTraceBodyId('run-mem', 'run-mem:tf', 'terminal_fallback');
    expect(resolveFeedbackTraceId({ runId: 'run-mem' })).toBe('run-mem');
  });

  it('prefers a persisted accepted :tf body over telemetry_finalized after cold start', () => {
    // Simulates daemon restart: process-local memory empty, but DB recorded that
    // terminal_fallback was accepted while a later final_message failed.
    expect(
      resolveFeedbackTraceId({
        runId: 'run-restart',
        runStatus: 'failed',
        telemetryFinalized: true,
        acceptedTraceBodyId: 'run-restart:tf',
      }),
    ).toBe('run-restart:tf');
  });
});

describe('buildTracePayload', () => {
  it('emits a trace with nested agent + generation observations', () => {
    const batch = buildTracePayload(makeCtx());
    const types = (batch as Array<{ type: string }>).map((e) => e.type);
    expect(types).toEqual([
      'trace-create',
      'span-create',
      'generation-create',
      'span-create',
      'span-create',
    ]);
    const span = bodyOf(batch, 'span-create', 'agent-run');
    const gen = bodyOf(batch, 'generation-create', 'llm');
    const bash = bodyOf(batch, 'span-create', 'tool:Bash');
    const write = bodyOf(batch, 'span-create', 'tool:Write');
    expect(span.id).toBe('run-1-agent');
    expect(span.traceId).toBe('run-1');
    expect(gen.traceId).toBe('run-1');
    expect(gen.parentObservationId).toBe('run-1-agent');
    expect(bash.parentObservationId).toBe('run-1-agent');
    expect(bash.input).toBeUndefined();
    expect(bash.output).toBeUndefined();
    expect(bash.metadata.toolName).toBe('Bash');
    expect(write.parentObservationId).toBe('run-1-agent');
  });

  it('omits prompt + output when content gate is off', () => {
    const batch = buildTracePayload(makeCtx());
    const trace = (batch[0] as any).body;
    const span = bodyOf(batch, 'span-create', 'agent-run');
    const gen = bodyOf(batch, 'generation-create', 'llm');
    const tool = bodyOf(batch, 'span-create', 'tool:Bash');
    expect(trace.input).toBeUndefined();
    expect(trace.output).toBeUndefined();
    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
    expect(gen.input).toBeUndefined();
    expect(gen.output).toBeUndefined();
    expect(tool.input).toBeUndefined();
    expect(tool.output).toBeUndefined();
  });

  it('includes prompt + output when content gate is on', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        message: {
          messageId: 'msg-1',
          prompt: 'Make a landing page for a coffee shop.',
          output:
            'Built it.\n<artifact identifier="demo" type="text/html"><!doctype html><html>heavy</html></artifact>',
        },
      }),
    );
    const trace = (batch[0] as any).body;
    const tool = bodyOf(batch, 'span-create', 'tool:Bash');
    const write = bodyOf(batch, 'span-create', 'tool:Write');
    expect(trace.input).toMatch(/coffee shop/);
    expect(trace.output).toContain('[REDACTED:artifact_content]');
    expect(trace.output).not.toContain('<!doctype html>');
    expect(tool.input).toMatch(/ls -la/);
    expect(tool.output).toBe('total 0');
    expect(write.input).toBe('[REDACTED:tool_input:content_tool:Write]');
    expect(write.output).toBe('[REDACTED:tool_output:content_tool:Write]');
  });

  it('adds full prompt-stack content once on generation input and flat metadata elsewhere', () => {
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt:
        '# Instructions\n\nWork in /Users/alice/project\n\n---\n# User request\n\nBuild a card',
      sections: [
        { kind: 'daemonSystemPrompt', content: 'Work in /Users/alice/project' },
        { kind: 'userRequest', content: 'Build a card' },
        { kind: 'attachments', metadata: ['src/App.tsx'] },
      ],
    });
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        promptTelemetry,
      }),
    );

    const trace = bodyOf(batch, 'trace-create');
    const generation = bodyOf(batch, 'generation-create', 'llm');
    expect(trace.input).toBe('Make a landing page for a coffee shop.');
    expect(generation.input).toMatchObject({
      type: 'open-design.prompt-stack',
      redactionVersion: 'prompt-stack-redaction-v1',
      sectionCount: 3,
      sections: [
        expect.objectContaining({
          kind: 'daemonSystemPrompt',
          redactedContent: expect.stringContaining('[REDACTED:path]'),
        }),
        expect.objectContaining({
          kind: 'userRequest',
          redactedContent: 'Build a card',
        }),
        expect.objectContaining({
          kind: 'attachments',
          contentMode: 'metadata-only',
        }),
      ],
    });
    expect(trace.metadata.promptStack).toBeUndefined();
    expect(generation.metadata.promptStack).toBeUndefined();
    expect(trace.metadata.promptStack_section_daemonSystemPrompt_present).toBeUndefined();
    expect(trace.metadata.promptStack_section_attachments_present).toBeUndefined();
    expect(trace.metadata.promptStack_section_daemonSystemPrompt_rawBytes).toBeUndefined();
    expect(trace.metadata.promptStack_promptFingerprint).toMatch(/^sha256:/);
    expect(generation.metadata.promptStack_promptFingerprint).toBe(
      trace.metadata.promptStack_promptFingerprint,
    );
  });

  it('adds prompt-stack byte and cache-token blame metadata for TTFT diagnosis', () => {
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt: ['a'.repeat(1000), 'b'.repeat(500), 'c'.repeat(100)].join('\n'),
      sections: [
        { kind: 'daemonSystemPrompt', content: 'a'.repeat(1000) },
        { kind: 'pluginStagePrompt', content: 'b'.repeat(500) },
        { kind: 'userRequest', content: 'c'.repeat(100) },
      ],
    });
    const ctx = makeCtx({
      prefs: { metrics: true, content: true, artifactManifest: false },
      promptTelemetry,
    });
    ctx.run = {
      ...ctx.run,
      timings: {
        tool_call_count: 0,
        total_duration_ms: 89_162,
        time_to_first_token_ms: 26_613,
        spawn_to_first_token_ms: 26_491,
      },
    };

    const batch = buildTracePayload(ctx);
    const trace = bodyOf(batch, 'trace-create');
    const generation = bodyOf(batch, 'generation-create', 'llm');

    expect(trace.metadata.promptStack_topSectionsByBytes).toEqual([
      expect.objectContaining({
        kind: 'daemonSystemPrompt',
        rawBytes: 1000,
        redactedBytes: 1000,
        attributionBytes: 1000,
        attributionShare: 0.625,
        estimatedInputEffectiveTokens: 929,
        estimatedCacheCreationInputTokens: 32,
        estimatedCacheReadInputTokens: 126,
        estimatedUncachedInputTokens: 772,
      }),
      expect.objectContaining({
        kind: 'pluginStagePrompt',
        rawBytes: 500,
        attributionShare: 0.3125,
        estimatedCacheCreationInputTokens: 15,
      }),
      expect.objectContaining({
        kind: 'userRequest',
        rawBytes: 100,
        attributionShare: 0.0625,
        estimatedCacheCreationInputTokens: 3,
      }),
    ]);
    expect(trace.metadata.cacheCreationTokensBySection).toEqual([
      {
        kind: 'daemonSystemPrompt',
        ordinal: 0,
        attributionBytes: 1000,
        estimatedCacheCreationInputTokens: 32,
      },
      {
        kind: 'pluginStagePrompt',
        ordinal: 1,
        attributionBytes: 500,
        estimatedCacheCreationInputTokens: 15,
      },
      {
        kind: 'userRequest',
        ordinal: 2,
        attributionBytes: 100,
        estimatedCacheCreationInputTokens: 3,
      },
    ]);
    expect(trace.metadata.promptStack_ttftAttribution).toMatchObject({
      method: 'proportional_by_prompt_section_redacted_bytes',
      time_to_first_token_ms: 26_613,
      spawn_to_first_token_ms: 26_491,
      totalAttributionBytes: 1600,
      sectionCount: 3,
      primarySectionKind: 'daemonSystemPrompt',
      primarySectionAttributionShare: 0.625,
      primarySectionEstimatedCacheCreationInputTokens: 32,
      cacheTokenSource: 'anthropic',
    });
    expect(generation.metadata.promptStack_topSectionsByBytes).toEqual(
      trace.metadata.promptStack_topSectionsByBytes,
    );
    expect(generation.metadata.promptStack_ttftAttribution).toEqual(
      trace.metadata.promptStack_ttftAttribution,
    );
  });

  it('omits prompt-stack redactedContent when metrics or content consent is off', () => {
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt: '# User request\n\nBuild a card',
      sections: [{ kind: 'userRequest', content: 'Build a card' }],
    });

    for (const prefs of [
      { metrics: true, content: false, artifactManifest: false },
      { metrics: false, content: true, artifactManifest: false },
    ]) {
      const batch = buildTracePayload(makeCtx({ prefs, promptTelemetry }));
      const trace = bodyOf(batch, 'trace-create');
      const generation = bodyOf(batch, 'generation-create', 'llm');
      expect(trace.input).toBeUndefined();
      expect(trace.metadata.promptStack).toBeUndefined();
      expect(trace.metadata.promptStack_redactedContentBytes).toBe(0);
      expect(generation.input).toMatchObject({
        type: 'open-design.prompt-stack',
        redactedContentBytes: 0,
        sections: [expect.not.objectContaining({ redactedContent: expect.any(String) })],
      });
    }
  });

  it('truncates ASCII prompt and output at 64 KB (bytes == chars)', () => {
    const longPrompt = 'a'.repeat(80_000);
    const longOutput = 'b'.repeat(80_000);
    const batch = buildTracePayload(
      makeCtx({
        message: {
          messageId: 'msg-1',
          prompt: longPrompt,
          output: longOutput,
        },
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    );
    const trace = (batch[0] as any).body;
    expect(Buffer.byteLength(trace.input, 'utf8')).toBe(64 * 1024);
    expect(Buffer.byteLength(trace.output, 'utf8')).toBe(64 * 1024);
  });

  it('truncates by UTF-8 bytes, not by JS string length, for multi-byte text', () => {
    // Each CJK character is 3 bytes in UTF-8 but 1 unit in String.length.
    // 30_000 chars × 3 bytes = 90_000 bytes, well over the 64 KB input cap.
    const longCJK = '设'.repeat(30_000);
    expect(longCJK.length).toBe(30_000);
    expect(Buffer.byteLength(longCJK, 'utf8')).toBe(90_000);
    const batch = buildTracePayload(
      makeCtx({
        message: { messageId: 'msg-1', prompt: longCJK, output: '' },
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    );
    const trace = (batch[0] as any).body;
    expect(Buffer.byteLength(trace.input, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    // Boundary safety: the trimmed result must still be valid UTF-8 (no
    // half-encoded characters). Round-tripping through Buffer should be
    // lossless if the cut landed correctly.
    expect(Buffer.from(trace.input as string, 'utf8').toString('utf8')).toBe(
      trace.input,
    );
    // And every character is still '设', i.e. we didn't mangle the encoding.
    expect(/^设+$/.test(trace.input as string)).toBe(true);
  });

  it('omits artifacts when manifest gate is off', () => {
    const batch = buildTracePayload(
      makeCtx({
        artifacts: [
          { slug: 'a', type: 'html', sizeBytes: 100 },
          { slug: 'b', type: 'jsx', sizeBytes: 200 },
        ],
        attachmentManifest: [
          {
            attachment_id: 'att-1',
            object_class: 'attachment',
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1',
            status: 'ok',
            project_id: 'proj-1',
            run_id: 'run-1',
            workspace_id: null,
            size_bytes: 100,
            redacted: false,
            truncated: false,
            stored_in_open_design: true,
            retention_policy: 'project_lifetime',
            access_scope: 'project',
            sensitivity: 'private',
            source: 'user_upload',
            expires_at: null,
            approved_by: null,
          },
        ],
        artifactManifest: [
          {
            artifact_id: 'art-1',
            object_class: 'artifact',
            type: 'html',
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-1',
            status: 'ok',
            project_id: 'proj-1',
            run_id: 'run-1',
            workspace_id: null,
            size_bytes: 200,
            redacted: false,
            truncated: false,
            stored_in_open_design: true,
            retention_policy: 'project_lifetime',
            access_scope: 'project',
            sensitivity: 'private',
            source: 'agent_generated',
            expires_at: null,
            approved_by: null,
          },
        ],
        manifestCompleteness: 'complete',
      }),
    );
    const trace = (batch[0] as any).body;
    expect(trace.metadata.artifacts).toBeUndefined();
    expect(trace.metadata.artifactsTruncated).toBeUndefined();
    expect(trace.metadata.attachment_manifest).toBeUndefined();
    expect(trace.metadata.artifact_manifest).toBeUndefined();
    expect(trace.metadata.manifest_completeness).toBeUndefined();
  });

  it('includes trace-safe object manifests when content telemetry is on', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true },
        attachmentManifest: [
          {
            attachment_id: 'att-1',
            object_class: 'attachment',
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1',
            status: 'ok',
            project_id: 'proj-1',
            run_id: 'run-1',
            workspace_id: null,
            size_bytes: 1024,
            sha256: 'sha256:abc',
            mime_type: 'application/pdf',
            extension: 'pdf',
            redacted: false,
            truncated: false,
            stored_in_open_design: true,
            retention_policy: 'project_lifetime',
            access_scope: 'project',
            sensitivity: 'private',
            source: 'user_upload',
            expires_at: null,
            approved_by: null,
          },
        ],
        artifactManifest: [
          {
            artifact_id: 'art-1',
            object_class: 'artifact',
            type: 'html',
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-1',
            status: 'partial',
            reason: 'size_unavailable',
            project_id: 'proj-1',
            run_id: 'run-1',
            workspace_id: null,
            build_status: 'complete',
            preview_status: 'unavailable',
            export_status: 'available',
            redacted: false,
            truncated: false,
            stored_in_open_design: true,
            retention_policy: 'project_lifetime',
            access_scope: 'project',
            sensitivity: 'private',
            source: 'agent_generated',
            expires_at: null,
            approved_by: null,
          },
        ],
        manifestCompleteness: 'partial',
      }),
    );
    const trace = (batch[0] as any).body;
    expect(trace.metadata.attachment_manifest).toEqual([
      expect.objectContaining({
        attachment_id: 'att-1',
        object_class: 'attachment',
        storage_ref: expect.stringContaining('/attachment/att-1'),
        size_bytes: 1024,
        sha256: 'sha256:abc',
        retention_policy: 'project_lifetime',
        access_scope: 'project',
        sensitivity: 'private',
        source: 'user_upload',
      }),
    ]);
    expect(trace.metadata.artifact_manifest).toEqual([
      expect.objectContaining({
        artifact_id: 'art-1',
        object_class: 'artifact',
        type: 'html',
        storage_ref: expect.stringContaining('/artifact/art-1'),
        status: 'partial',
        reason: 'size_unavailable',
        build_status: 'complete',
        export_status: 'available',
        source: 'agent_generated',
      }),
    ]);
    expect(trace.metadata.manifest_completeness).toBe('partial');
  });

  it('caps artifacts at 50 entries with a truncation flag', () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      slug: `art-${i}`,
      type: 'html',
      sizeBytes: 1,
    }));
    const batch = buildTracePayload(
      makeCtx({
        artifacts: many,
        prefs: { metrics: true, content: true },
      }),
    );
    const trace = (batch[0] as any).body;
    expect(trace.metadata.artifacts).toHaveLength(50);
    expect(trace.metadata.artifactsTruncated).toBe(true);
  });

  it('caps artifact manifests at 50 entries with a truncation flag', () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      artifact_id: `art-${i}`,
      object_class: 'artifact' as const,
      type: 'html',
      storage_ref: `od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-${i}`,
      status: 'ok' as const,
      project_id: 'proj-1',
      run_id: 'run-1',
      workspace_id: null,
      size_bytes: 1,
      redacted: false,
      truncated: false,
      stored_in_open_design: true,
      retention_policy: 'project_lifetime' as const,
      access_scope: 'project' as const,
      sensitivity: 'private' as const,
      source: 'agent_generated' as const,
      expires_at: null,
      approved_by: null,
    }));
    const batch = buildTracePayload(
      makeCtx({
        artifactManifest: many,
        manifestCompleteness: 'complete',
        prefs: { metrics: true, content: true },
      }),
    );
    const trace = (batch[0] as any).body;
    expect(trace.metadata.artifact_manifest).toHaveLength(50);
    expect(trace.metadata.artifact_manifest_truncated).toBe(true);
  });

  it('caps attachment manifests and prompt-build refs at 50 entries', () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      attachment_id: `att-${i}`,
      object_class: 'attachment' as const,
      storage_ref: `od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-${i}`,
      status: 'ok' as const,
      project_id: 'proj-1',
      run_id: 'run-1',
      workspace_id: null,
      size_bytes: i + 1,
      sha256: `sha256:att-${i}`,
      mime_type: 'application/pdf',
      extension: 'pdf',
      redacted: false,
      truncated: false,
      stored_in_open_design: true,
      retention_policy: 'project_lifetime' as const,
      access_scope: 'project' as const,
      sensitivity: 'private' as const,
      source: 'user_upload' as const,
      expires_at: null,
      approved_by: null,
    }));
    const batch = buildTracePayload(
      makeCtx({
        attachmentManifest: many,
        manifestCompleteness: 'complete',
        prefs: { metrics: true, content: true },
        run: {
          runId: 'run-1',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_500,
          timingMarks: {
            promptBuildStartAt: 1_700_000_000_100,
            promptBuildEndAt: 1_700_000_000_200,
          },
        },
      }),
    );
    const trace = (batch[0] as any).body;
    const promptBuild = bodyOf(batch, 'span-create', 'prompt-build');

    expect(trace.metadata.attachment_manifest).toHaveLength(50);
    expect(trace.metadata.attachment_manifest_truncated).toBe(true);
    expect(promptBuild.input.ingredients.attachment_refs).toHaveLength(50);
    expect(promptBuild.input.ingredients.attachment_refs_truncated).toBe(true);
    expect(promptBuild.input.ingredients.attachment_refs.at(-1)).toMatchObject({
      attachment_id: 'att-49',
      sha256: 'sha256:att-49',
    });
  });

  it('keeps eventsSummary metadata regardless of content / artifact gates', () => {
    const batch = buildTracePayload(makeCtx());
    const trace = (batch[0] as any).body;
    expect(trace.metadata.eventsSummary).toEqual({
      toolCalls: 2,
      errors: 0,
      durationMs: 4500,
    });
  });

  it('records token counts in metadata.tokens and generation.usage', () => {
    const batch = buildTracePayload(makeCtx());
    const trace = (batch[0] as any).body;
    const gen = bodyOf(batch, 'generation-create', 'llm');
    expect(trace.metadata.tokens).toEqual({
      input: 1234,
      inputProvider: 1234,
      inputEffective: 1484,
      output: 567,
      total: 2051,
      cacheReadInput: 200,
      cacheCreationInput: 50,
      uncachedInput: 1234,
      estimatedContext: 1350,
      cacheHitRatio: 0.1347708894878706,
      cacheTokenSource: 'anthropic',
    });
    expect(gen.usage).toEqual({
      input: 1484,
      output: 567,
      total: 2051,
      unit: 'TOKENS',
    });
  });

  it('uses conversationId as sessionId when within length limit', () => {
    const batch = buildTracePayload(makeCtx());
    expect((batch[0] as any).body.sessionId).toBe(
      'conv-uuid-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });

  it('drops sessionId when conversationId exceeds 200 chars', () => {
    const batch = buildTracePayload(
      makeCtx({ conversationId: 'x'.repeat(201) }),
    );
    expect((batch[0] as any).body.sessionId).toBeUndefined();
  });

  it('builds tag list with project + agent + extras', () => {
    const batch = buildTracePayload(
      makeCtx({ extraTags: ['legacy:tag'] }),
    );
    expect((batch[0] as any).body.tags).toEqual([
      'open-design',
      'project:proj-1',
      'agent:claude',
      'legacy:tag',
    ]);
  });

  it('adds turn-level tags (model / skill / DS) and runtime tags (os / client)', () => {
    const batch = buildTracePayload(
      makeCtx({
        turn: {
          model: 'gpt-4o',
          reasoning: 'high',
          skillId: 'landing-page',
          designSystemId: 'mission-control',
        },
        runtime: {
          os: 'darwin',
          arch: 'arm64',
          nodeVersion: 'v22.22.0',
          appVersion: '0.5.0',
          clientType: 'desktop',
        },
      }),
    );
    expect((batch[0] as any).body.tags).toEqual([
      'open-design',
      'project:proj-1',
      'agent:claude',
      'model:gpt-4o',
      'skill:landing-page',
      'ds:mission-control',
      'os:darwin',
      'client:desktop',
    ]);
  });

  it('promotes model + reasoning to first-class generation fields', () => {
    const batch = buildTracePayload(
      makeCtx({
        turn: { model: 'claude-sonnet-4-5', reasoning: 'high' },
      }),
    );
    const gen = bodyOf(batch, 'generation-create', 'llm');
    expect(gen.model).toBe('claude-sonnet-4-5');
    expect(gen.modelParameters).toEqual({ reasoning: 'high' });
  });

  it('omits modelParameters entirely when reasoning is unset', () => {
    const batch = buildTracePayload(
      makeCtx({ turn: { model: 'gpt-4o' } }),
    );
    const gen = bodyOf(batch, 'generation-create', 'llm');
    expect(gen.model).toBe('gpt-4o');
    expect(gen.modelParameters).toBeUndefined();
  });

  it('mirrors runtime + turn fields into trace metadata for query / export', () => {
    const batch = buildTracePayload(
      makeCtx({
        turn: { model: 'claude-sonnet-4-5', skillId: 'landing-page' },
        runtime: {
          os: 'linux',
          arch: 'x64',
          nodeVersion: 'v22.22.0',
          appVersion: '0.5.0',
          appChannel: 'beta',
          packaged: true,
          clientType: 'web',
        },
      }),
    );
    const m = (batch[0] as any).body.metadata;
    expect(m.model).toBe('claude-sonnet-4-5');
    expect(m.skillId).toBe('landing-page');
    expect(m.os).toBe('linux');
    expect(m.arch).toBe('x64');
    expect(m.nodeVersion).toBe('v22.22.0');
    expect(m.appVersion).toBe('0.5.0');
    expect(m.appChannel).toBe('beta');
    expect(m.packaged).toBe(true);
    expect(m.clientType).toBe('web');
    expect(m.projectId).toBe('proj-1');
    expect(m.agent).toBe('claude');
  });

  it('marks generation.level=ERROR when run failed', () => {
    const batch = buildTracePayload(
      makeCtx({
        run: {
          runId: 'run-1',
          status: 'failed',
          startedAt: 1,
          endedAt: 2,
          error: 'boom',
        },
      }),
    );
    const span = bodyOf(batch, 'span-create', 'agent-run');
    const gen = bodyOf(batch, 'generation-create', 'llm');
    expect(gen.level).toBe('ERROR');
    expect(gen.statusMessage).toBe('boom');
    expect(span.level).toBe('ERROR');
    expect(span.statusMessage).toBe('boom');
    expect(bodyOf(batch, 'event-create', 'run-error').statusMessage).toBe('boom');
    expect((batch[0] as any).body.metadata.error).toBe('boom');
    expect((batch[0] as any).body.metadata.success).toBe(false);
  });

  it('uses an agent-runtime span instead of an llm generation for session-init failures with no model usage', () => {
    const batch = buildTracePayload(
      makeCtx({
        run: {
          runId: 'run-auth',
          status: 'failed',
          startedAt: 1,
          endedAt: 2,
          error: 'Not logged in · Please run /login',
          errorCode: 'AGENT_AUTH_REQUIRED',
          failure: {
            failure_category: 'auth',
            failure_detail: 'auth_required',
            failure_stage: 'session_init',
            retryable: false,
            user_action: 'login',
          },
          timingMarks: {
            modelCallStartAt: 1,
          },
        },
        message: {
          messageId: 'msg-auth',
          prompt: 'make an artifact',
          output: 'Not logged in · Please run /login',
          usage: {
            inputTokens: 0,
            inputTokensProvider: 0,
            inputTokensEffective: 0,
            outputTokens: 0,
            totalTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            uncachedInputTokens: 0,
            estimatedContextTokens: 0,
            cacheTokenSource: 'anthropic',
          },
        },
        tools: [],
        eventsSummary: { toolCalls: 0, errors: 1, durationMs: 2 },
      }),
    );
    expect(
      (batch as Array<{ type: string; body: Record<string, any> }>).find(
        (item) => item.type === 'generation-create' && item.body.name === 'llm',
      ),
    ).toBeUndefined();
    const runtime = bodyOf(batch, 'span-create', 'agent-runtime');
    expect(runtime.level).toBe('ERROR');
    expect(runtime.statusMessage).toBe('Not logged in · Please run /login');
    expect(runtime.metadata.reason).toBe('no_model_generation');
    expect(bodyOf(batch, 'span-create', 'runtime-call').parentObservationId).toBe(
      'run-auth-runtime',
    );
    const metadata = (batch[0] as any).body.metadata;
    expect(metadata.status).toBe('failed');
    expect(metadata.success).toBe(false);
    expect(metadata.error_code).toBe('AGENT_AUTH_REQUIRED');
    expect(metadata.failure_category).toBe('auth');
  });

  it('mirrors structured failure fields into trace metadata', () => {
    const batch = buildTracePayload(
      makeCtx({
        run: {
          runId: 'run-rate-limit',
          status: 'failed',
          startedAt: 1,
          endedAt: 2,
          error: 'session limit reached',
          errorCode: 'RATE_LIMITED',
          failure: {
            failure_category: 'rate_limit',
            failure_detail: 'hard_quota',
            failure_stage: 'session_init',
            retryable: false,
            user_action: 'none',
          },
        },
      }),
    );
    const metadata = (batch[0] as any).body.metadata;
    expect(metadata.error_code).toBe('RATE_LIMITED');
    expect(metadata.langfuse_trace_id).toBe('run-rate-limit');
    expect(metadata.langfuse_expected).toBe(false);
    expect(metadata.langfuse_delivery_status).toBe('not_expected');
    expect(metadata.langfuse_drop_reason).toBe('content_consent_off');
    expect(metadata.failure_category).toBe('rate_limit');
    expect(metadata.failure_detail).toBe('hard_quota');
    expect(metadata.failure_stage).toBe('session_init');
    expect(metadata.retryable).toBe(false);
    expect(metadata.user_action).toBe('none');
  });

  it('mirrors run timing fields into trace metadata', () => {
    const batch = buildTracePayload(
      makeCtx({
        run: {
          runId: 'run-timing',
          status: 'succeeded',
          startedAt: 1,
          endedAt: 2,
          timings: {
            queue_duration_ms: 10,
            pre_spawn_duration_ms: 20,
            process_spawn_duration_ms: 30,
            time_to_first_token_ms: 40,
            spawn_to_first_token_ms: 50,
            generation_duration_ms: 60,
            tool_call_count: 2,
            tool_duration_ms: 70,
            finalize_duration_ms: 5,
            total_duration_ms: 100,
          },
        },
      }),
    );
    const metadata = (batch[0] as any).body.metadata;
    expect(metadata.queue_duration_ms).toBe(10);
    expect(metadata.process_spawn_duration_ms).toBe(30);
    expect(metadata.time_to_first_token_ms).toBe(40);
    expect(metadata.tool_call_count).toBe(2);
    expect(metadata.total_duration_ms).toBe(100);
  });

  it('adds duration spans for run timing marks', () => {
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt:
        '# System\n\nUse /Users/alice/project safely\n\n---\n# User request\n\nBuild the card\n\n---\n# Attachments\n\nbrand.pdf',
      sections: [
        {
          kind: 'daemonSystemPrompt',
          content: 'Use /Users/alice/project safely',
        },
        { kind: 'userRequest', content: 'Build the card' },
        {
          kind: 'attachments',
          metadata: [{ name: 'brand.pdf', size: 1024, mime: 'application/pdf' }],
        },
      ],
    });
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: true },
        promptTelemetry,
        attachmentManifest: [
          {
            attachment_id: 'att-1',
            object_class: 'attachment',
            storage_ref: 'od://objects/workspaces/unknown/projects/proj-1/runs/run-spans/attachment/att-1',
            status: 'ok',
            project_id: 'proj-1',
            run_id: 'run-spans',
            workspace_id: null,
            size_bytes: 1024,
            sha256: 'sha256:attachment',
            mime_type: 'application/pdf',
            extension: 'pdf',
            redacted: false,
            truncated: false,
            stored_in_open_design: true,
            retention_policy: 'project_lifetime',
            access_scope: 'project',
            sensitivity: 'private',
            source: 'user_upload',
            expires_at: null,
            approved_by: null,
          },
        ],
        run: {
          runId: 'run-spans',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_500,
          timingMarks: {
            startChatRunStartedAt: 1_700_000_000_100,
            promptBuildStartAt: 1_700_000_000_200,
            promptBuildEndAt: 1_700_000_000_260,
            processSpawnStartedAt: 1_700_000_000_300,
            processSpawnedAt: 1_700_000_000_380,
            modelCallStartAt: 1_700_000_000_420,
            firstTokenAt: 1_700_000_001_000,
            finalizeStartAt: 1_700_000_004_200,
          },
        },
      }),
    );

    const spans = (batch as any[])
      .filter((item) => item.type === 'span-create')
      .map((item) => item.body);
    expect(spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'queue',
        'prompt-build',
        'spawn',
        'agent-call',
        'stream-output',
        'finalize',
      ]),
    );
    expect(bodyOf(batch, 'span-create', 'prompt-build')).toMatchObject({
      input: {
        phase: 'prompt-build',
        ingredients: {
          agent: 'claude',
          model: 'unknown',
          skill_id: null,
          design_system_id: null,
          user_request_available: true,
          attachment_refs: [
            expect.objectContaining({
              attachment_id: 'att-1',
              storage_ref: expect.stringContaining('/attachment/att-1'),
              sha256: 'sha256:attachment',
              sensitivity: 'private',
            }),
          ],
        },
      },
      output: {
        status: 'prompt_stack_ready',
        content_policy: 'redacted_prompt_stack_on_generation_input_with_object_refs',
        prompt_stack_available: true,
        section_count: 3,
        stack_fingerprint: expect.stringMatching(/^sha256:/),
      },
    });
    expect(bodyOf(batch, 'span-create', 'prompt-build').input.prompt_stack).toBeUndefined();
    expect(bodyOf(batch, 'span-create', 'prompt-build').output.prompt_stack).toBeUndefined();
    expect(bodyOf(batch, 'span-create', 'spawn')).toMatchObject({
      id: 'run-spans-phase-spawn',
      parentObservationId: 'run-spans-gen',
      input: {
        phase: 'spawn',
        agent: 'claude',
        cwd_ref: 'project',
        raw_path_included: false,
      },
      output: {
        duration_ms: 80,
        status: 'process_spawned',
      },
      metadata: {
        durationMs: 80,
        boundary: 'processSpawnStartedAt -> processSpawnedAt',
      },
    });
    expect(bodyOf(batch, 'span-create', 'agent-call')).toMatchObject({
      input: {
        phase: 'agent-call',
        model: 'unknown',
        tool_call_count: 2,
        generation_observation: true,
      },
      output: {
        status: 'succeeded',
        tool_call_count: 2,
        token_usage: {
          input: 1234,
          input_effective: 1484,
          output: 567,
          total: 2051,
        },
      },
    });
    expect(bodyOf(batch, 'span-create', 'finalize')).toMatchObject({
      input: {
        phase: 'finalize',
        artifact_manifest_enabled: true,
      },
      output: {
        status: 'succeeded',
        artifact_count: 0,
        attachment_count: 1,
        manifest_completeness: 'unavailable',
      },
    });
    expect(bodyOf(batch, 'span-create', 'tool:Bash').parentObservationId).toBe(
      'run-spans-phase-agent-call',
    );
  });

  it('nests agent status and usage events under agent-call', () => {
    const batch = buildTracePayload(
      makeCtx({
        // Content consent required for agent-event free-text `output`.
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId: 'run-agent-events',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_500,
          timingMarks: {
            modelCallStartAt: 1_700_000_000_420,
          },
        },
        agentEvents: [
          {
            id: 'status-initializing-0',
            name: 'agent-status:initializing',
            timestamp: 1_700_000_000_500,
            input: { source: 'claude-code-stream', event_type: 'status' },
            output: { label: 'initializing', model: 'claude-opus-4-8[1m]' },
          },
          {
            id: 'thinking-start-0',
            name: 'agent-thinking-start',
            timestamp: 1_700_000_000_800,
            input: {
              source: 'claude-code-stream',
              event_type: 'thinking_start',
            },
            output: { status: 'started' },
          },
          {
            id: 'usage-0',
            name: 'agent-usage',
            timestamp: 1_700_000_004_000,
            input: { source: 'claude-code-stream', event_type: 'usage' },
            output: {
              usage: { input_tokens: 10, output_tokens: 20 },
              cost_usd: 0.01,
              stop_reason: 'end_turn',
            },
          },
        ],
      }),
    );

    expect(bodyOf(batch, 'event-create', 'agent-status:initializing')).toMatchObject({
      parentObservationId: 'run-agent-events-phase-agent-call',
      input: {
        source: 'claude-code-stream',
        event_type: 'status',
      },
      output: {
        label: 'initializing',
        model: 'claude-opus-4-8[1m]',
      },
    });
    expect(bodyOf(batch, 'event-create', 'agent-thinking-start')).toMatchObject({
      parentObservationId: 'run-agent-events-phase-agent-call',
      input: {
        source: 'claude-code-stream',
        event_type: 'thinking_start',
      },
      output: { status: 'started' },
    });
    expect(bodyOf(batch, 'event-create', 'agent-usage')).toMatchObject({
      parentObservationId: 'run-agent-events-phase-agent-call',
      input: {
        source: 'claude-code-stream',
        event_type: 'usage',
      },
      output: {
        usage: { input_tokens: 10, output_tokens: 20 },
        cost_usd: 0.01,
        stop_reason: 'end_turn',
      },
    });
  });

  it('nests agent diagnostics under agent-call without requiring message content', () => {
    const batch = buildTracePayload(
      makeCtx({
        // Content consent required for diagnostic free-text `output` payloads.
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId: 'run-agent-diagnostics',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_500,
          timingMarks: {
            modelCallStartAt: 1_700_000_000_420,
          },
        },
        agentEvents: [
          {
            id: 'diagnostic-acp_artifact_text_suppression-0',
            name: 'agent-diagnostic:acp_artifact_text_suppression',
            timestamp: 1_700_000_003_000,
            input: { source: 'amr', event_type: 'diagnostic' },
            output: {
              name: 'acp_artifact_text_suppression',
              source: 'acp-json-rpc',
              reason: 'artifact_echo',
              suppressed_chars: 4096,
              opened_blocks: 1,
              closed_blocks: 1,
            },
            metadata: {
              diagnostic_name: 'acp_artifact_text_suppression',
            },
          },
        ],
      }),
    );

    expect(
      bodyOf(batch, 'event-create', 'agent-diagnostic:acp_artifact_text_suppression'),
    ).toMatchObject({
      parentObservationId: 'run-agent-diagnostics-phase-agent-call',
      input: {
        source: 'amr',
        event_type: 'diagnostic',
      },
      output: {
        name: 'acp_artifact_text_suppression',
        source: 'acp-json-rpc',
        reason: 'artifact_echo',
        suppressed_chars: 4096,
        opened_blocks: 1,
        closed_blocks: 1,
      },
      metadata: {
        diagnostic_name: 'acp_artifact_text_suppression',
      },
    });
  });

  it('emits cost and performance diagnostics for cost governance', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: true },
        artifacts: [
          { slug: 'index.html', type: 'html', sizeBytes: 4096 },
          { slug: 'brand-spec.md', type: 'text', sizeBytes: 1024 },
        ],
        run: {
          runId: 'run-cost-perf',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_006_000,
          timings: {
            generation_duration_ms: 5000,
            tool_call_count: 2,
            tool_duration_ms: 1700,
            total_duration_ms: 6000,
          },
          timingMarks: {
            promptBuildStartAt: 1_700_000_000_100,
            promptBuildEndAt: 1_700_000_000_200,
            modelCallStartAt: 1_700_000_000_300,
            firstTokenAt: 1_700_000_001_000,
            finalizeStartAt: 1_700_000_005_500,
          },
        },
        agentEvents: [
          {
            id: 'usage-0',
            name: 'agent-usage',
            timestamp: 1_700_000_005_400,
            input: { source: 'claude-code-stream', event_type: 'usage' },
            output: {
              usage: { input_tokens: 100, output_tokens: 200 },
              cost_usd: 0.1234,
              duration_ms: 5400,
            },
          },
        ],
      }),
    );

    const trace = bodyOf(batch, 'trace-create');
    const generation = bodyOf(batch, 'generation-create', 'llm');
    const agentCall = bodyOf(batch, 'span-create', 'agent-call');
    const bash = bodyOf(batch, 'span-create', 'tool:Bash');
    const write = bodyOf(batch, 'span-create', 'tool:Write');
    const artifacts = bodyOf(batch, 'event-create', 'artifact-summary');

    expect(trace.metadata).toMatchObject({
      cost_usd: 0.1234,
      currency: 'USD',
      pricing_version: 'provider_reported',
      cost_source: 'agent_usage_event',
      cost_status: 'available',
      cost_breakdown: {
        cost_usd: 0.1234,
        currency: 'USD',
        phase_costs: {
          prompt_build: {
            phase: 'prompt-build',
            cost_usd: null,
            cost_status: 'not_metered',
          },
          agent_call: {
            phase: 'agent-call',
            cost_usd: 0.1234,
            cost_status: 'available',
          },
          artifact_generation: {
            phase: 'artifact-generation',
            cost_status: 'included_in_agent_call',
          },
          verification: {
            phase: 'verification',
            cost_status: 'not_instrumented',
          },
        },
      },
      performance_diagnostics: {
        tool_performance: {
          tool_call_count: 2,
          total_tool_duration_ms: 1700,
          retry_count_available: false,
          retry_count: null,
          by_tool: expect.arrayContaining([
            expect.objectContaining({
              tool_name: 'Bash',
              call_count: 1,
              total_duration_ms: 800,
              failure_types: ['none'],
            }),
            expect.objectContaining({
              tool_name: 'Write',
              call_count: 1,
              total_duration_ms: 900,
              failure_types: ['none'],
            }),
          ]),
        },
        artifact_write: {
          artifact_count: 2,
          total_artifact_size_bytes: 5120,
          write_tool_count: 1,
          write_tool_duration_ms: 900,
          correlation_status: 'heuristic_by_write_tool_total',
        },
        preview_verify: {
          status: 'not_instrumented',
          screenshot_check: 'not_reported',
          responsive_check: 'not_reported',
        },
        semantic_phases: {
          semantic_phase_timing_status: 'partial',
          missing_semantic_phases: expect.arrayContaining([
            'route-task-kind',
            'preview-verify',
            'evaluator',
          ]),
        },
      },
    });
    expect(generation.metadata.cost_usd).toBe(0.1234);
    expect(generation.metadata.performance_diagnostics.preview_verify.status).toBe(
      'not_instrumented',
    );
    expect(agentCall.output.cost).toMatchObject({
      phase: 'agent-call',
      cost_usd: 0.1234,
      cost_status: 'available',
    });
    expect(bash.metadata).toMatchObject({
      durationMs: 800,
      failureType: 'none',
      retryCount: null,
      retryDetection: 'not_instrumented',
    });
    expect(write.metadata).toMatchObject({
      durationMs: 900,
      failureType: 'none',
    });
    expect(artifacts.metadata.artifact_write_diagnostics).toMatchObject({
      total_artifact_size_bytes: 5120,
      write_tool_duration_ms: 900,
    });
  });

  it('marks cost unavailable when the runtime does not report provider cost', () => {
    const batch = buildTracePayload(makeCtx());
    const trace = bodyOf(batch, 'trace-create');
    expect(trace.metadata).toMatchObject({
      cost_usd: null,
      currency: 'USD',
      pricing_version: 'unavailable',
      cost_source: 'unavailable',
      cost_status: 'unavailable',
      cost_breakdown: {
        unavailable_reason: 'agent runtime did not report total_cost_usd',
        phase_costs: {
          agent_call: {
            cost_usd: null,
            cost_status: 'unavailable',
          },
        },
      },
    });
  });

  it('keeps prompt-build ingredient keys stable when optional inputs are absent', () => {
    const batch = buildTracePayload(
      makeCtx({
        run: {
          runId: 'run-prompt-ingredients',
          status: 'succeeded',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
          timingMarks: {
            promptBuildStartAt: 1_700_000_000_100,
            promptBuildEndAt: 1_700_000_000_200,
          },
        },
      }),
    );

    expect(bodyOf(batch, 'span-create', 'prompt-build').input).toMatchObject({
      phase: 'prompt-build',
      ingredients: {
        agent: 'claude',
        model: 'unknown',
        skill_id: null,
        design_system_id: null,
        user_request_available: true,
        attachment_refs: [],
      },
    });
  });

  it('passes through anonymous installationId as userId', () => {
    const batch = buildTracePayload(makeCtx({ installationId: null }));
    expect((batch[0] as any).body.userId).toBeUndefined();
  });

  it('stamps anonymous installation identity metadata without client-claimed account fields', () => {
    const batch = buildTracePayload(
      makeCtx({
        installationId: 'install-uuid-1',
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    );
    const trace = bodyOf(batch, 'trace-create');
    expect(trace.userId).toBe('install-uuid-1');
    expect(trace.metadata.identity_type).toBe('anonymous_installation');
    expect(trace.metadata.installation_id).toBe('install-uuid-1');
    expect(trace.metadata.app_user_id).toBeUndefined();
    expect(trace.metadata.user_email).toBeUndefined();
  });

  it('uses stable ingestion event ids derived from body ids', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    ) as Array<{ id: string; body: { id: string } }>;
    for (const event of batch) {
      expect(event.id).toBe(stableIngestionEventId(event.body.id, 'final'));
    }
    const again = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    ) as Array<{ id: string }>;
    expect(again.map((event) => event.id)).toEqual(batch.map((event) => event.id));
  });

  it('uses distinct stable ids and omits turn content for object-registration', () => {
    const streamRun = {
      runId: 'run-1',
      status: 'failed' as const,
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_004_500,
      error: 'provider failed',
      stderr: {
        tail: 'CLI stream tail with secret-redacted provider noise',
        lineCount: 8,
        truncated: true,
      },
      stdout: {
        tail: 'partial assistant stream text',
        lineCount: 3,
        truncated: false,
      },
      diagnostics: { stage: 'agent_stream', raw: 'turn content' },
    };
    const agentEvents = [
      {
        id: 'diagnostic-plain_stream_artifacts_persist_failed-0',
        name: 'agent-diagnostic:plain_stream_artifacts_persist_failed',
        timestamp: 1_700_000_003_000,
        input: { source: 'daemon-run-finalize', event_type: 'diagnostic' },
        output: {
          name: 'plain_stream_artifacts_persist_failed',
          message: 'Failed to persist plain-stream artifact(s): disk full',
        },
        statusMessage: 'Failed to persist plain-stream artifact(s): disk full',
        level: 'ERROR' as const,
        metadata: {
          diagnostic_name: 'plain_stream_artifacts_persist_failed',
        },
      },
    ];
    const finalBatch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: streamRun,
        agentEvents,
      }),
      'final',
    ) as Array<{ id: string; body: Record<string, any> }>;
    const regBatch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: streamRun,
        agentEvents,
      }),
      'object-registration',
    ) as Array<{ id: string; body: Record<string, any> }>;
    expect(regBatch[0]!.id).toBe(`${finalBatch[0]!.id}:reg`);
    expect(regBatch[0]!.body.input).toBeUndefined();
    expect(regBatch[0]!.body.output).toBeUndefined();
    expect(regBatch[0]!.body.metadata.telemetry_delivery_purpose).toBe(
      'object-registration',
    );
    // Object-registration must not carry stream tails / diagnostics either —
    // those are turn content the final Vela path owns.
    expect(regBatch[0]!.body.metadata.stderr).toBeUndefined();
    expect(regBatch[0]!.body.metadata.stdout).toBeUndefined();
    expect(regBatch[0]!.body.metadata.diagnostics).toBeUndefined();
    // Agent/runtime error text must also stay off the anonymous registration
    // relay (metadata.error + statusMessage on spans / run-error event).
    expect(regBatch[0]!.body.metadata.error).toBeUndefined();
    expect(
      regBatch.find((e) => e.body?.name === 'agent-run')?.body.statusMessage,
    ).toBeUndefined();
    expect(
      regBatch.find((e) => e.body?.name === 'llm')?.body.statusMessage,
    ).toBeUndefined();
    expect(
      regBatch.find((e) => e.body?.name === 'run-error')?.body.statusMessage,
    ).toBeUndefined();
    // Agent-event diagnostic payloads (output/statusMessage) must not leak
    // into the anonymous registration relay either.
    const regAgentDiagnostic = regBatch.find(
      (e) => e.body?.name === 'agent-diagnostic:plain_stream_artifacts_persist_failed',
    );
    expect(regAgentDiagnostic).toBeDefined();
    expect(regAgentDiagnostic!.body.output).toBeUndefined();
    expect(regAgentDiagnostic!.body.statusMessage).toBeUndefined();
    expect(regAgentDiagnostic!.body.input).toEqual({
      source: 'daemon-run-finalize',
      event_type: 'diagnostic',
    });
    const finalAgentDiagnostic = finalBatch.find(
      (e) => e.body?.name === 'agent-diagnostic:plain_stream_artifacts_persist_failed',
    );
    expect(finalAgentDiagnostic!.body.output).toEqual(agentEvents[0]!.output);
    expect(finalAgentDiagnostic!.body.statusMessage).toBe(
      agentEvents[0]!.statusMessage,
    );
    expect(finalBatch[0]!.body.input).toBe('Make a landing page for a coffee shop.');
    expect(finalBatch[0]!.body.metadata.error).toBe('provider failed');
    expect(finalBatch[0]!.body.metadata.stderr).toEqual(streamRun.stderr);
    expect(finalBatch[0]!.body.metadata.stdout).toEqual(streamRun.stdout);
    expect(finalBatch[0]!.body.metadata.diagnostics).toEqual(streamRun.diagnostics);
    expect(
      finalBatch.find((e) => e.body?.name === 'agent-run')?.body.statusMessage,
    ).toBe('provider failed');
    expect(
      finalBatch.find((e) => e.body?.name === 'run-error')?.body.statusMessage,
    ).toBe('provider failed');
  });

  it('keeps authority manifests on object-registration but omits artifact filename summaries', () => {
    const artifactSlug = 'prompt-derived-landing-page.html';
    const ctx = makeCtx({
      prefs: { metrics: true, content: true, artifactManifest: true },
      artifacts: [
        { slug: artifactSlug, type: 'html', sizeBytes: 2048 },
      ],
      artifactManifest: [
        {
          artifact_id: 'art-1',
          object_class: 'artifact',
          type: 'html',
          storage_ref:
            'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/artifact/art-1',
          status: 'ok',
          project_id: 'proj-1',
          run_id: 'run-1',
          workspace_id: null,
          build_status: 'complete',
          preview_status: 'unavailable',
          export_status: 'available',
          redacted: false,
          truncated: false,
          stored_in_open_design: true,
          retention_policy: 'project_lifetime',
          access_scope: 'project',
          sensitivity: 'private',
          source: 'agent_generated',
          expires_at: null,
          approved_by: null,
        },
      ],
      attachmentManifest: [
        {
          attachment_id: 'att-1',
          object_class: 'attachment',
          storage_ref:
            'od://objects/workspaces/unknown/projects/proj-1/runs/run-1/attachment/att-1',
          status: 'ok',
          project_id: 'proj-1',
          run_id: 'run-1',
          workspace_id: null,
          size_bytes: 128,
          sha256: 'sha256:abc',
          mime_type: 'application/pdf',
          extension: 'pdf',
          redacted: false,
          truncated: false,
          stored_in_open_design: true,
          retention_policy: 'project_lifetime',
          access_scope: 'project',
          sensitivity: 'private',
          source: 'user_upload',
          expires_at: null,
          approved_by: null,
        },
      ],
      manifestCompleteness: 'complete',
    });
    const regBatch = buildTracePayload(ctx, 'object-registration') as Array<{
      type: string;
      body: Record<string, any>;
    }>;
    const finalBatch = buildTracePayload(ctx, 'final') as Array<{
      type: string;
      body: Record<string, any>;
    }>;
    const regTrace = regBatch.find((e) => e.type === 'trace-create')!.body;
    const finalTrace = finalBatch.find((e) => e.type === 'trace-create')!.body;

    // Authority manifests stay on registration for object-scope upload.
    expect(regTrace.metadata.artifact_manifest).toEqual(
      finalTrace.metadata.artifact_manifest,
    );
    expect(regTrace.metadata.attachment_manifest).toEqual(
      finalTrace.metadata.attachment_manifest,
    );
    expect(regTrace.metadata.manifest_completeness).toBe('complete');

    // Filename/slug summaries must not leak on the anonymous registration pass.
    expect(regTrace.metadata.artifacts).toBeUndefined();
    expect(
      regTrace.metadata.performance_diagnostics?.artifact_write?.artifacts,
    ).toBeUndefined();
    expect(
      regTrace.metadata.performance_diagnostics?.artifact_write?.artifact_count,
    ).toBe(1);
    expect(
      regBatch.find((e) => e.body?.name === 'artifact-summary'),
    ).toBeUndefined();

    // Final delivery still carries the content-bearing summaries.
    expect(finalTrace.metadata.artifacts).toEqual([
      { slug: artifactSlug, type: 'html', sizeBytes: 2048 },
    ]);
    expect(
      finalTrace.metadata.performance_diagnostics?.artifact_write?.artifacts,
    ).toEqual([
      { slug: artifactSlug, type: 'html', size_bytes: 2048 },
    ]);
    expect(
      finalBatch.find((e) => e.body?.name === 'artifact-summary'),
    ).toBeDefined();
  });

  it('uses distinct body and event ids for terminal_fallback vs final_message', () => {
    const ctx = makeCtx({
      prefs: { metrics: true, content: true, artifactManifest: false },
    });
    const fallbackBatch = buildTracePayload(
      ctx,
      'final',
      'terminal_fallback',
    ) as Array<{ id: string; type: string; body: Record<string, any> }>;
    const finalizedBatch = buildTracePayload(
      ctx,
      'final',
      'final_message',
    ) as Array<{ id: string; type: string; body: Record<string, any> }>;
    const fallbackRetry = buildTracePayload(
      ctx,
      'final',
      'terminal_fallback',
    ) as Array<{ id: string; body: { id: string } }>;

    // Body ids must differ so a late fallback cannot overwrite the canonical
    // finalized Langfuse entities for the same run.
    expect(fallbackBatch[0]!.body.id).toBe(
      scopedTelemetryBodyId(String(finalizedBatch[0]!.body.id), 'final', 'terminal_fallback'),
    );
    expect(fallbackBatch[0]!.body.id).toBe(`${finalizedBatch[0]!.body.id}:tf`);
    expect(fallbackBatch[0]!.body.id).not.toBe(finalizedBatch[0]!.body.id);
    // Correlation metadata still points at the original run id.
    expect(fallbackBatch[0]!.body.metadata.langfuse_trace_id).toBe(ctx.run.runId);
    expect(finalizedBatch[0]!.body.metadata.langfuse_trace_id).toBe(ctx.run.runId);

    for (const event of fallbackBatch) {
      expect(String(event.body.id)).toMatch(/:tf$/);
      if ('traceId' in event.body) {
        expect(event.body.traceId).toBe(fallbackBatch[0]!.body.id);
      }
      expect(event.id).toBe(
        stableIngestionEventId(event.body.id, 'final', 'terminal_fallback'),
      );
    }
    expect(fallbackBatch[0]!.id).toBe(`${finalizedBatch[0]!.id}:tf`);
    expect(fallbackBatch.map((event) => event.id)).not.toEqual(
      finalizedBatch.map((event) => event.id),
    );
    // True transport retries of the same logical delivery stay stable.
    expect(fallbackRetry.map((event) => event.id)).toEqual(
      fallbackBatch.map((event) => event.id),
    );
    expect(fallbackRetry.map((event) => event.body.id)).toEqual(
      fallbackBatch.map((event) => event.body.id),
    );
    expect(fallbackBatch[0]!.body.metadata.telemetry_report_trigger).toBe(
      'terminal_fallback',
    );
    expect(finalizedBatch[0]!.body.metadata.telemetry_report_trigger).toBe(
      'final_message',
    );

    const fallbackKey = buildTelemetryIdempotencyKey(
      fallbackBatch,
      String(fallbackBatch[0]!.body.id),
      'final',
      'terminal_fallback',
    );
    const finalizedKey = buildTelemetryIdempotencyKey(
      finalizedBatch,
      String(finalizedBatch[0]!.body.id),
      'final',
      'final_message',
    );
    const fallbackRetryKey = buildTelemetryIdempotencyKey(
      fallbackRetry,
      String(fallbackBatch[0]!.body.id),
      'final',
      'terminal_fallback',
    );
    expect(fallbackKey).not.toBe(finalizedKey);
    expect(fallbackKey).toBe(fallbackRetryKey);
  });
});

describe('vela telemetry envelope helpers', () => {
  it('builds a stable idempotency key from trace id + sorted event ids', () => {
    const keyA = buildTelemetryIdempotencyKey(
      [{ id: 'b' }, { id: 'a' }],
      'run-1',
    );
    const keyB = buildTelemetryIdempotencyKey(
      [{ id: 'a' }, { id: 'b' }],
      'run-1',
    );
    const keyC = buildTelemetryIdempotencyKey(
      [{ id: 'a' }, { id: 'b' }],
      'run-2',
    );
    expect(keyA).toBe(keyB);
    expect(keyA).toMatch(/^od-telemetry-[a-f0-9]{64}$/);
    expect(keyA).not.toBe(keyC);
  });

  it('includes report trigger so terminal_fallback and final_message keys differ', () => {
    const keyFallback = buildTelemetryIdempotencyKey(
      [{ id: 'run-1:tf' }],
      'run-1',
      'final',
      'terminal_fallback',
    );
    const keyFinal = buildTelemetryIdempotencyKey(
      [{ id: 'run-1' }],
      'run-1',
      'final',
      'final_message',
    );
    const keyFallbackRetry = buildTelemetryIdempotencyKey(
      [{ id: 'run-1:tf' }],
      'run-1',
      'final',
      'terminal_fallback',
    );
    expect(keyFallback).not.toBe(keyFinal);
    expect(keyFallback).toBe(keyFallbackRetry);
  });

  it('converts Langfuse batch events into the vendor-neutral Vela envelope', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
    );
    const envelope = toVelaTelemetryEnvelope(batch, 'install-uuid-1');
    expect(envelope.version).toBe(1);
    expect(envelope.installationId).toBe('install-uuid-1');
    expect(envelope.events.length).toBeGreaterThan(0);
    expect(envelope.events[0]).toMatchObject({
      kind: 'trace',
      data: {
        id: 'run-1',
        name: 'open-design-turn',
        userId: 'install-uuid-1',
      },
    });
    expect(envelope.events.some((event) => event.kind === 'generation')).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('user_email');
    expect(JSON.stringify(envelope)).not.toContain('app_user_id');
  });
});

describe('reportRunCompleted', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('does nothing when metrics gate is off', async () => {
    const fetchSpy = vi.fn();
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: false, content: true, artifactManifest: true },
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'metrics_consent_off',
    });
  });

  it('does nothing when content gate is off', async () => {
    const fetchSpy = vi.fn();
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: false },
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'content_consent_off',
    });
  });

  it('does nothing when no Langfuse config is available', async () => {
    const fetchSpy = vi.fn();
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: null,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      langfuse_expected: false,
      langfuse_delivery_status: 'not_expected',
      langfuse_drop_reason: 'missing_sink_config',
    });
  });

  it('POSTs to /api/public/ingestion with Basic auth and a JSON batch body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit & { headers: Record<string, string> };
    expect(url).toBe('https://us.cloud.langfuse.com/api/public/ingestion');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic dGVzdA==');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.batch)).toBe(true);
    expect(body.batch.map((item: any) => item.type)).toEqual([
      'trace-create',
      'span-create',
      'generation-create',
      'span-create',
      'span-create',
    ]);
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
  });

  it('keeps a max-budget prompt stack under the hard batch cap', async () => {
    const maxBudgetSection = 'x'.repeat(64 * 1024);
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt: maxBudgetSection.repeat(8),
      sections: [
        { kind: 'daemonSystemPrompt', content: maxBudgetSection.repeat(2) },
        { kind: 'runtimeToolPrompt', content: maxBudgetSection },
        { kind: 'clientSystemPrompt', content: maxBudgetSection },
        { kind: 'skillPrompt', content: maxBudgetSection },
        { kind: 'designSystemPrompt', content: maxBudgetSection },
        { kind: 'pluginStagePrompt', content: maxBudgetSection },
        { kind: 'researchCommandContract', content: maxBudgetSection },
      ],
    });
    expect(promptTelemetry.redactedContentBytes).toBe(512 * 1024);

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        promptTelemetry,
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const serialized = init.body as string;
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(1024 * 1024);
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
  });

  it('keeps stderr out of trace input/output and stores only a redacted metadata tail', () => {
    const batch = buildTracePayload(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId: 'run-err',
          status: 'failed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_500,
          error: 'provider failed',
          stderr: {
            tail: 'HTTP 429 OPENAI_API_KEY=[REDACTED:openai_key]',
            lineCount: 12,
            truncated: true,
          },
        },
      }),
    ) as any[];

    const trace = bodyOf(batch, 'trace-create');
    const generation = bodyOf(batch, 'generation-create', 'llm');

    expect(trace.input).toBe('Make a landing page for a coffee shop.');
    expect(trace.output).toBe('Here is a landing page draft …');
    expect(generation.input).toBe('Make a landing page for a coffee shop.');
    expect(generation.output).toBe('Here is a landing page draft …');
    expect(trace.metadata.stderr).toEqual({
      tail: 'HTTP 429 OPENAI_API_KEY=[REDACTED:openai_key]',
      lineCount: 12,
      truncated: true,
    });
    expect(JSON.stringify(batch)).not.toContain('sk-raw');
  });

  it('POSTs serialized ingestion batches to the Open Design telemetry relay', async () => {
    const relayConfig: TelemetrySinkConfig = {
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: relayConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit & { headers: Record<string, string> };
    expect(url).toBe('https://telemetry.open-design.ai/api/langfuse');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Open-Design-Telemetry']).toBe('langfuse-ingestion-v1');
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.batch)).toBe(true);
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'relay',
    });
  });

  it('warns when the relay returns per-event errors', async () => {
    const relayConfig: TelemetrySinkConfig = {
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ successes: [], errors: [{ id: 'bad', status: 400 }] }),
        { status: 207 },
      ),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: relayConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Relay per-event errors (1)'),
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'langfuse_4xx',
    });
  });


  it('classifies relay 413 responses as relay_413', async () => {
    const relayConfig: TelemetrySinkConfig = {
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('payload too large', { status: 413 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: relayConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'relay_413',
    });
  });

  it('classifies relay 5xx responses as relay_5xx', async () => {
    const relayConfig: TelemetrySinkConfig = {
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('upstream unavailable', { status: 503 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: relayConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'relay_5xx',
    });
  });

  it('classifies direct Langfuse 5xx responses as langfuse_5xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('server error', { status: 503 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'langfuse_5xx',
    });
  });

  function velaSink(
    overrides: Partial<Extract<TelemetrySinkConfig, { kind: 'vela' }>> = {},
  ): Extract<TelemetrySinkConfig, { kind: 'vela' }> {
    return {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
      ...overrides,
    };
  }

  it('POSTs the vendor-neutral envelope to Vela with Control Key + idempotency key', async () => {
    const velaConfig = velaSink();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: velaConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'vela',
      langfuse_vela_identity: velaSinkIdentityFingerprint(
        velaConfig.profile,
        velaConfig.controlKey,
      ),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://amr-api.example.com/api/v1/open-design/telemetry');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ck_test_key');
    expect(headers['Idempotency-Key']).toMatch(/^od-telemetry-[a-f0-9]{64}$/);
    const body = JSON.parse(init.body as string);
    expect(body.version).toBe(1);
    expect(body.installationId).toBe('install-uuid-1');
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events[0].kind).toBe('trace');
    expect(body.events[0].data.metadata.identity_type).toBe('anonymous_installation');
    expect(JSON.stringify(body)).not.toContain('user@');
  });

  it('reuses the same Vela idempotency key across retries', async () => {
    const velaConfig = velaSink({ retries: 1 });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: velaConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result.langfuse_delivery_status).toBe('accepted');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const key1 = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const key2 = (fetchSpy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(key1['Idempotency-Key']).toBe(key2['Idempotency-Key']);
  });

  it('uses distinct Vela body ids, event ids, and idempotency keys for terminal_fallback vs final_message', async () => {
    const velaConfig = velaSink();
    const ctx = makeCtx({
      prefs: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );

    const fallbackResult = await reportRunCompleted(ctx, {
      config: velaConfig,
      fetchImpl: fetchSpy as any,
      deliveryPurpose: 'final',
      reportTrigger: 'terminal_fallback',
    });
    const finalizedResult = await reportRunCompleted(ctx, {
      config: velaConfig,
      fetchImpl: fetchSpy as any,
      deliveryPurpose: 'final',
      reportTrigger: 'final_message',
    });
    // Same logical delivery re-posted (transport retry) keeps the final key.
    const finalizedRetry = await reportRunCompleted(ctx, {
      config: velaConfig,
      fetchImpl: fetchSpy as any,
      deliveryPurpose: 'final',
      reportTrigger: 'final_message',
    });

    expect(fallbackResult.langfuse_delivery_status).toBe('accepted');
    expect(finalizedResult.langfuse_delivery_status).toBe('accepted');
    expect(finalizedRetry.langfuse_delivery_status).toBe('accepted');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const fallbackInit = fetchSpy.mock.calls[0]![1] as RequestInit;
    const finalizedInit = fetchSpy.mock.calls[1]![1] as RequestInit;
    const retryInit = fetchSpy.mock.calls[2]![1] as RequestInit;
    const fallbackHeaders = fallbackInit.headers as Record<string, string>;
    const finalizedHeaders = finalizedInit.headers as Record<string, string>;
    const retryHeaders = retryInit.headers as Record<string, string>;

    expect(fallbackHeaders['Idempotency-Key']).not.toBe(
      finalizedHeaders['Idempotency-Key'],
    );
    expect(finalizedHeaders['Idempotency-Key']).toBe(retryHeaders['Idempotency-Key']);

    const fallbackBody = JSON.parse(String(fallbackInit.body));
    const finalizedBody = JSON.parse(String(finalizedInit.body));
    expect(fallbackBody.events[0].id).toMatch(/:tf$/);
    expect(finalizedBody.events[0].id).not.toMatch(/:tf$/);
    expect(fallbackBody.events[0].id).not.toBe(finalizedBody.events[0].id);
    // Distinct Langfuse body ids so out-of-order fallback cannot clobber final.
    expect(fallbackBody.events[0].data.id).toBe(`${finalizedBody.events[0].data.id}:tf`);
    expect(fallbackBody.events[0].data.id).not.toBe(finalizedBody.events[0].data.id);
  });

  it('keeps finalized Langfuse body ids winning when fallback transport finishes later', async () => {
    const ctx = makeCtx({
      prefs: { metrics: true, content: true, artifactManifest: false },
    });
    let releaseFallback!: () => void;
    const fallbackGate = new Promise<void>((resolve) => {
      releaseFallback = resolve;
    });
    const posted: Array<{ reportTrigger: 'terminal_fallback' | 'final_message'; body: any }> =
      [];

    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const firstBodyId = String(payload.batch?.[0]?.body?.id ?? '');
      const isFallback = firstBodyId.endsWith(':tf');
      if (isFallback) {
        await fallbackGate;
      }
      posted.push({
        reportTrigger: isFallback ? 'terminal_fallback' : 'final_message',
        body: payload,
      });
      return new Response(JSON.stringify({ successes: [], errors: [] }), {
        status: 200,
      });
    });

    const fallbackPromise = reportRunCompleted(ctx, {
      config: TEST_CONFIG,
      fetchImpl: fetchSpy as any,
      deliveryPurpose: 'final',
      reportTrigger: 'terminal_fallback',
    });
    // Let the fallback request reach its delayed transport gate.
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const finalizedResult = await reportRunCompleted(ctx, {
      config: TEST_CONFIG,
      fetchImpl: fetchSpy as any,
      deliveryPurpose: 'final',
      reportTrigger: 'final_message',
    });
    expect(finalizedResult.langfuse_delivery_status).toBe('accepted');
    // Finalized payload has already been delivered while fallback is still gated.
    expect(posted).toHaveLength(1);
    expect(posted[0]!.reportTrigger).toBe('final_message');
    expect(posted[0]!.body.batch[0].body.id).toBe(ctx.run.runId);
    expect(posted[0]!.body.batch[0].body.output).toBe(
      'Here is a landing page draft …',
    );

    releaseFallback();
    const fallbackResult = await fallbackPromise;
    expect(fallbackResult.langfuse_delivery_status).toBe('accepted');
    expect(posted).toHaveLength(2);
    expect(posted[1]!.reportTrigger).toBe('terminal_fallback');
    // Late fallback writes a separate entity namespace and cannot replace the
    // canonical run-scoped observations that final_message already sent.
    expect(posted[1]!.body.batch[0].body.id).toBe(`${ctx.run.runId}:tf`);
    expect(posted[1]!.body.batch[0].body.id).not.toBe(
      posted[0]!.body.batch[0].body.id,
    );
    // Canonical finalized record still holds the completed payload.
    expect(posted[0]!.body.batch[0].body.id).toBe(ctx.run.runId);
    expect(posted[0]!.body.batch[0].body.output).toBe(
      'Here is a landing page draft …',
    );
  });

  it('does not anonymous-fallback on Vela 429/5xx or network errors', async () => {
    const velaConfig = velaSink();
    const prevRelay = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    try {
      const fetchSpy = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
      const result = await reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
        }),
        {
          config: velaConfig,
          fetchImpl: fetchSpy as any,
        },
      );
      expect(result).toEqual({
        langfuse_expected: true,
        langfuse_delivery_status: 'failed',
        langfuse_drop_reason: 'vela_5xx',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/open-design/telemetry');
    } finally {
      if (prevRelay === undefined) delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      else process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = prevRelay;
    }
  });

  it('does not anonymous-fallback on Vela 400 protocol errors', async () => {
    const velaConfig = velaSink();
    const prevRelay = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    try {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_open_design_telemetry_payload' }), {
          status: 400,
        }),
      );
      const result = await reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
        }),
        {
          config: velaConfig,
          fetchImpl: fetchSpy as any,
        },
      );
      expect(result).toEqual({
        langfuse_expected: true,
        langfuse_delivery_status: 'failed',
        langfuse_drop_reason: 'vela_400',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (prevRelay === undefined) delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      else process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = prevRelay;
    }
  });

  it('reports timeout drop reason when Vela fetch aborts after retries', async () => {
    const velaConfig = velaSink({ retries: 0 });
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const fetchSpy = vi.fn().mockRejectedValue(timeoutError);
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: velaConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'timeout',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Vela telemetry fetch error: timeout'),
    );
  });

  it('reports network_error drop reason for non-timeout Vela fetch failures', async () => {
    const velaConfig = velaSink({ retries: 0 });
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: velaConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'network_error',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Vela telemetry fetch error: network_error'),
    );
  });

  it('falls back to anonymous relay on Vela 401/403', async () => {
    const velaConfig = velaSink({ controlKey: 'ck_expired' });
    const prevRelay = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    const prevVela = process.env.OPEN_DESIGN_VELA_TELEMETRY;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    process.env.OPEN_DESIGN_VELA_TELEMETRY = '0';
    try {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));
      const result = await reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
        }),
        {
          config: velaConfig,
          fetchImpl: fetchSpy as any,
        },
      );
      expect(result).toEqual({
        langfuse_expected: true,
        langfuse_delivery_status: 'accepted',
        // Vela auth failure fell back to anonymous relay.
        langfuse_delivery_channel: 'relay',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/open-design/telemetry');
      expect(String(fetchSpy.mock.calls[1]![0])).toBe(
        'https://telemetry.open-design.ai/api/langfuse',
      );
      const relayHeaders = fetchSpy.mock.calls[1]![1].headers as Record<string, string>;
      expect(relayHeaders['X-Open-Design-Telemetry']).toBe('langfuse-ingestion-v1');
    } finally {
      if (prevRelay === undefined) delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      else process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = prevRelay;
      if (prevVela === undefined) delete process.env.OPEN_DESIGN_VELA_TELEMETRY;
      else process.env.OPEN_DESIGN_VELA_TELEMETRY = prevVela;
    }
  });

  /**
   * File-backed Vela sink fixtures: resolve the live sink via
   * `readTelemetrySinkConfig()` against a seeded `~/.amr` profile.
   * Telemetry 401/403 must fall back anonymously without mutating login.
   */
  async function withSeededAmrHome<T>(
    profiles: Record<string, Record<string, unknown>>,
    run: (helpers: {
      configPath: string;
      readProfiles: () => Record<string, Record<string, unknown>>;
      writeProfiles: (next: Record<string, Record<string, unknown>>) => void;
    }) => Promise<T>,
  ): Promise<T> {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalAmrProfile = process.env.OPEN_DESIGN_AMR_PROFILE;
    const originalVelaControlKey = process.env.VELA_CONTROL_KEY;
    const originalVelaApiUrl = process.env.VELA_API_URL;
    const originalVelaTelemetry = process.env.OPEN_DESIGN_VELA_TELEMETRY;
    const originalRelay = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    const tmpHome = mkdtempSync(path.join(tmpdir(), 'od-langfuse-amr-'));
    const configDir = path.join(tmpHome, '.amr');
    const configPath = path.join(configDir, 'config.json');
    mkdirSync(configDir, { recursive: true });
    const writeProfiles = (next: Record<string, Record<string, unknown>>) => {
      writeFileSync(
        configPath,
        JSON.stringify({ version: 1, profiles: next }, null, 2),
        'utf8',
      );
    };
    const readProfiles = (): Record<string, Record<string, unknown>> => {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
        profiles?: Record<string, Record<string, unknown>>;
      };
      return parsed.profiles ?? {};
    };
    writeProfiles(profiles);
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.VELA_CONTROL_KEY;
    delete process.env.VELA_API_URL;
    delete process.env.OPEN_DESIGN_VELA_TELEMETRY;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    try {
      return await run({ configPath, readProfiles, writeProfiles });
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalAmrProfile === undefined) delete process.env.OPEN_DESIGN_AMR_PROFILE;
      else process.env.OPEN_DESIGN_AMR_PROFILE = originalAmrProfile;
      if (originalVelaControlKey === undefined) delete process.env.VELA_CONTROL_KEY;
      else process.env.VELA_CONTROL_KEY = originalVelaControlKey;
      if (originalVelaApiUrl === undefined) delete process.env.VELA_API_URL;
      else process.env.VELA_API_URL = originalVelaApiUrl;
      if (originalVelaTelemetry === undefined) delete process.env.OPEN_DESIGN_VELA_TELEMETRY;
      else process.env.OPEN_DESIGN_VELA_TELEMETRY = originalVelaTelemetry;
      if (originalRelay === undefined) delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      else process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = originalRelay;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }

  it.each([401, 403] as const)(
    'preserves file-backed login and falls back anonymously on Vela %s',
    async (status) => {
      await withSeededAmrHome(
        {
          local: {
            controlKey: 'ck_local_expired',
            runtimeKey: 'rt_local',
            apiUrl: 'https://amr-api.example.com',
            user: { id: 'u-local', email: 'local@example.com' },
          },
          prod: {
            controlKey: 'ck_prod_keep',
            runtimeKey: 'rt_prod',
            user: { id: 'u-prod', email: 'prod@example.com' },
          },
        },
        async ({ readProfiles }) => {
          process.env.OPEN_DESIGN_AMR_PROFILE = 'local';
          const sink = readTelemetrySinkConfig(process.env);
          expect(sink).toMatchObject({
            kind: 'vela',
            authSource: 'file',
            profile: 'local',
            controlKey: 'ck_local_expired',
          });

          const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ error: status === 401 ? 'unauthenticated' : 'forbidden' }), {
                status,
              }),
            )
            .mockResolvedValueOnce(new Response('{}', { status: 200 }));

          const result = await reportRunCompleted(
            makeCtx({
              prefs: { metrics: true, content: true, artifactManifest: false },
            }),
            {
              // Leave config undefined so delivery re-resolves via
              // readTelemetrySinkConfig() (file-backed path under test).
              fetchImpl: fetchSpy as any,
              configuredEnv: { OPEN_DESIGN_AMR_PROFILE: 'local' },
            },
          );

          expect(result).toEqual({
            langfuse_expected: true,
            langfuse_delivery_status: 'accepted',
            // Vela auth failure fell back to anonymous relay.
            langfuse_delivery_channel: 'relay',
          });
          expect(fetchSpy).toHaveBeenCalledTimes(2);
          expect(String(fetchSpy.mock.calls[0]![0])).toContain(
            '/api/v1/open-design/telemetry',
          );
          expect(String(fetchSpy.mock.calls[1]![0])).toBe(
            'https://telemetry.open-design.ai/api/langfuse',
          );

          const profiles = readProfiles();
          // Telemetry auth failure must not revoke product credentials.
          expect(profiles.local?.controlKey).toBe('ck_local_expired');
          expect(profiles.local?.runtimeKey).toBe('rt_local');
          expect(profiles.local?.user).toEqual({
            id: 'u-local',
            email: 'local@example.com',
          });
          expect(profiles.local?.apiUrl).toBe('https://amr-api.example.com');
          expect(profiles.prod?.controlKey).toBe('ck_prod_keep');
          expect(profiles.prod?.runtimeKey).toBe('rt_prod');
        },
      );
    },
  );

  it('forces object-registration onto the anonymous relay even when Vela is configured', async () => {
    const prevRelay = process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    try {
      const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
        }),
        {
          config: velaSink(),
          deliveryPurpose: 'object-registration',
          fetchImpl: fetchSpy as any,
        },
      );
      expect(result.langfuse_delivery_status).toBe('accepted');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://telemetry.open-design.ai/api/langfuse',
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
      expect(body.batch[0].id).toMatch(/:reg$/);
      expect(body.batch[0].body.input).toBeUndefined();
      expect(body.batch[0].body.metadata.telemetry_delivery_purpose).toBe(
        'object-registration',
      );
    } finally {
      if (prevRelay === undefined) delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      else process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = prevRelay;
    }
  });

  it('classifies relay per-event 429s separately from generic 4xx', async () => {
    const relayConfig: TelemetrySinkConfig = {
      kind: 'relay',
      relayUrl: 'https://telemetry.open-design.ai/api/langfuse',
      timeoutMs: 20_000,
      retries: 0,
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ successes: [], errors: [{ id: 'throttled', status: 429 }] }),
        { status: 207 },
      ),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: relayConfig,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'relay_429',
    });
  });

  it('classifies direct Langfuse per-event 5xx responses as langfuse_5xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ successes: [], errors: [{ id: 'lf-down', status: 503 }] }),
        { status: 207 },
      ),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'langfuse_5xx',
    });
  });

  it('warns and drops when serialized batch exceeds the hard cap', async () => {
    // Per-field truncation already caps prompt/output, so we overflow the
    // hard cap by stuffing 50 artifact entries with very long slugs while
    // artifactManifest is on (50 × 30 KB ≈ 1.5 MB > 1 MB cap).
    const fetchSpy = vi.fn();
    const fatArtifacts = Array.from({ length: 50 }, (_, i) => ({
      slug: 'a'.repeat(30_000) + i,
      type: 'html',
      sizeBytes: 1,
    }));
    const result = await reportRunCompleted(
      makeCtx({
        artifacts: fatArtifacts,
        prefs: { metrics: true, content: true, artifactManifest: true },
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Batch too large'),
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'payload_too_large',
    });
  });

  it('only warns (does not throw) when fetch rejects', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(
      reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
        }),
        {
          config: TEST_CONFIG,
          fetchImpl: fetchSpy as any,
        },
      ),
    ).resolves.toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'network_error',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Fetch error'),
    );
  });

  it('retries once when fetch rejects before warning', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('{}', { status: 207 }));
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: { ...TEST_CONFIG, retries: 1 },
        fetchImpl: fetchSpy as any,
      },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
  });

  it('only warns (does not throw) when ingestion responds non-2xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ingestion failed 429'),
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'langfuse_4xx',
    });
  });

  it('warns when 207 Multi-Status body lists per-event errors', async () => {
    // Langfuse legacy ingestion always responds with 207. response.ok is
    // true, but malformed events show up in body.errors instead of as a
    // top-level non-2xx. Without parsing them they'd be silently dropped.
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          successes: [{ id: 'a', status: 201 }],
          errors: [
            {
              id: 'b',
              status: 400,
              message: 'invalid generation usage shape',
            },
          ],
        }),
        { status: 207 },
      ),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Per-event errors (1)'),
    );
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed',
      langfuse_drop_reason: 'langfuse_4xx',
    });
  });

  it('does not warn when 207 body has empty errors array', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          successes: [
            { id: 'a', status: 201 },
            { id: 'b', status: 201 },
          ],
          errors: [],
        }),
        { status: 207 },
      ),
    );
    const result = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
      },
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
  });
});

function makeFeedbackCtx(
  overrides: Partial<FeedbackReportContext> = {},
): FeedbackReportContext {
  return {
    runId: 'run-feedback-1',
    installationId: 'install-uuid-1',
    prefs: { metrics: true, content: true },
    rating: 'positive',
    reasonCodes: ['matched_request'],
    hasCustomReason: false,
    customReason: '',
    ...overrides,
  };
}

describe('buildFeedbackPayload', () => {
  afterEach(() => {
    resetAcceptedFinalTraceBodyIdsForTests();
  });

  it('emits a numeric user_rating score plus per-reason categorical scores', () => {
    const batch = buildFeedbackPayload(
      makeFeedbackCtx({
        rating: 'negative',
        reasonCodes: ['missed_request', 'weak_visual'],
        hasCustomReason: true,
        customReason: 'It got the layout wrong on tablet',
      }),
    ) as Array<Record<string, any>>;
    expect(batch).toHaveLength(3);
    const ratingScore = batch[0]!;
    expect(ratingScore.type).toBe('score-create');
    expect(ratingScore.body.traceId).toBe('run-feedback-1');
    expect(ratingScore.body.name).toBe('user_rating');
    expect(ratingScore.body.value).toBe(-1);
    expect(ratingScore.body.dataType).toBe('NUMERIC');
    expect(ratingScore.body.comment).toBe('negative');
    expect(ratingScore.body.metadata).toMatchObject({
      reasonCount: 2,
      customReason: 'It got the layout wrong on tablet',
      hasCustomReason: true,
    });
    for (const reasonScore of batch.slice(1)) {
      expect(reasonScore.body.name).toBe('user_rating_reason');
      expect(reasonScore.body.dataType).toBe('CATEGORICAL');
      expect(reasonScore.body.comment).toBe('negative');
      expect(reasonScore.body.traceId).toBe('run-feedback-1');
    }
    expect(batch[1]!.body.value).toBe('missed_request');
    expect(batch[2]!.body.value).toBe('weak_visual');
  });

  it('keeps scores on the canonical id for failed runs without an accepted fallback anchor', () => {
    const batch = buildFeedbackPayload(
      makeFeedbackCtx({
        runId: 'run-fallback-only',
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ) as Array<Record<string, any>>;
    // Status alone must not invent :tf; only accepted delivery memory does.
    expect(batch[0]!.body.traceId).toBe('run-fallback-only');
    expect(batch[0]!.body.id).toBe('run-fallback-only-rating');
  });

  it('uses the remembered accepted body id when present', () => {
    rememberAcceptedFinalTraceBodyId(
      'run-remembered',
      'run-remembered:tf',
      'terminal_fallback',
    );
    const batch = buildFeedbackPayload(
      makeFeedbackCtx({ runId: 'run-remembered' }),
    ) as Array<Record<string, any>>;
    expect(batch[0]!.body.traceId).toBe('run-remembered:tf');
  });

  it('does not emit reason scores when no codes were submitted', () => {
    const batch = buildFeedbackPayload(
      makeFeedbackCtx({ reasonCodes: [] }),
    ) as Array<Record<string, any>>;
    expect(batch).toHaveLength(1);
    expect(batch[0]!.body.name).toBe('user_rating');
    expect(batch[0]!.body.value).toBe(1);
  });

  it('keeps score body.id stable but changes event ids when feedback payload edits', () => {
    const positive = makeFeedbackCtx({
      rating: 'positive',
      reasonCodes: ['matched_request'],
    });
    const negative = makeFeedbackCtx({
      rating: 'negative',
      reasonCodes: ['matched_request'],
    });
    const positiveBatch = buildFeedbackPayload(positive) as Array<Record<string, any>>;
    const negativeBatch = buildFeedbackPayload(negative) as Array<Record<string, any>>;
    const positiveRetry = buildFeedbackPayload(positive) as Array<Record<string, any>>;

    expect(positiveBatch[0]!.body.id).toBe('run-feedback-1-rating');
    expect(negativeBatch[0]!.body.id).toBe('run-feedback-1-rating');
    expect(positiveBatch[1]!.body.id).toBe('run-feedback-1-reason-matched_request');
    expect(negativeBatch[1]!.body.id).toBe('run-feedback-1-reason-matched_request');

    expect(positiveBatch[0]!.id).not.toBe(negativeBatch[0]!.id);
    expect(positiveBatch[1]!.id).not.toBe(negativeBatch[1]!.id);
    expect(positiveBatch[0]!.id).toBe(positiveRetry[0]!.id);

    const revisionPos = feedbackIngestionRevision(positive);
    const revisionNeg = feedbackIngestionRevision(negative);
    expect(revisionPos).not.toBe(revisionNeg);
    expect(positiveBatch[0]!.id).toBe(
      stableIngestionEventId(`run-feedback-1-rating:${revisionPos}`),
    );
    expect(negativeBatch[0]!.id).toBe(
      stableIngestionEventId(`run-feedback-1-rating:${revisionNeg}`),
    );

    const keyPos = buildTelemetryIdempotencyKey(
      positiveBatch as Array<{ id: string }>,
      'run-feedback-1',
    );
    const keyNeg = buildTelemetryIdempotencyKey(
      negativeBatch as Array<{ id: string }>,
      'run-feedback-1',
    );
    const keyRetry = buildTelemetryIdempotencyKey(
      positiveRetry as Array<{ id: string }>,
      'run-feedback-1',
    );
    expect(keyPos).not.toBe(keyNeg);
    expect(keyPos).toBe(keyRetry);
  });
});

describe('reportRunFeedback', () => {
  const TEST_CONFIG: LangfuseConfig = {
    baseUrl: 'https://us.cloud.langfuse.com',
    authHeader: 'Basic Zm9vOmJhcg==',
    retries: 0,
    timeoutMs: 1000,
  };

  beforeEach(() => {
    vi.useRealTimers();
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    // Default live consent on so deferred flushes are not fail-closed when
    // no OD_DATA_DIR / configured data root is present in unit tests.
    setLiveTelemetryPrefsReaderForTests(() => ({
      metrics: true,
      content: true,
    }));
  });

  afterEach(() => {
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
  });

  it('skips when metrics consent is off', async () => {
    const fetchSpy = vi.fn();
    await reportRunFeedback(makeFeedbackCtx({ prefs: { metrics: false, content: true } }), {
      config: TEST_CONFIG,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips when content consent is off', async () => {
    const fetchSpy = vi.fn();
    await reportRunFeedback(makeFeedbackCtx({ prefs: { metrics: true, content: false } }), {
      config: TEST_CONFIG,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a score-create batch to /api/public/ingestion when consent is on', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );
    await reportRunFeedback(
      makeFeedbackCtx({ reasonCodes: ['matched_request'] }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://us.cloud.langfuse.com/api/public/ingestion');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].type).toBe('score-create');
    expect(body.batch[0].body.value).toBe(1);
  });

  it('does not post feedback to anonymous sinks when the accepted channel is Vela', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );
    await reportRunFeedback(
      makeFeedbackCtx({
        runId: 'run-vela-scoped',
        acceptedDeliveryChannel: 'vela',
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not post feedback through Vela when the accepted channel is relay', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const velaConfig: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
    };
    await reportRunFeedback(
      makeFeedbackCtx({
        runId: 'run-relay-scoped',
        acceptedDeliveryChannel: 'relay',
        reasonCodes: [],
      }),
      { config: velaConfig, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts relay-accepted feedback through relay when Vela is also configured', async () => {
    const previous = {
      VELA_CONTROL_KEY: process.env.VELA_CONTROL_KEY,
      VELA_API_URL: process.env.VELA_API_URL,
      OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    };
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));
    try {
      // No explicit config: env resolution would prefer Vela unless sticky.
      await reportRunFeedback(
        makeFeedbackCtx({
          runId: 'run-relay-sticky-with-vela',
          acceptedDeliveryChannel: 'relay',
          reasonCodes: [],
        }),
        { fetchImpl: fetchSpy as any },
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://telemetry.open-design.ai/api/langfuse',
      );
      expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(
        '/api/v1/open-design/telemetry',
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('does not post feedback through a different Vela account than the accepting one', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const acceptingIdentity = velaSinkIdentityFingerprint('prod', 'ck_accepted');
    const liveConfig: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_switched_account',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
    };
    await reportRunFeedback(
      makeFeedbackCtx({
        runId: 'run-vela-account-switch',
        acceptedDeliveryChannel: 'vela',
        acceptedVelaIdentity: acceptingIdentity,
        reasonCodes: [],
      }),
      { config: liveConfig, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts feedback through Vela when the accepted channel is Vela', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const velaConfig: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_test_key',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
    };
    await reportRunFeedback(
      makeFeedbackCtx({
        runId: 'run-vela-scoped',
        acceptedDeliveryChannel: 'vela',
        acceptedVelaIdentity: velaSinkIdentityFingerprint('prod', 'ck_test_key'),
        reasonCodes: [],
      }),
      { config: velaConfig, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(
      '/api/v1/open-design/telemetry',
    );
  });

  it('attaches feedback to the terminal_fallback :tf body after a fallback-only completion', async () => {
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-fallback-feedback-e2e';
    const expectedTraceId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    // Fallback-only completion (failed run, no later telemetry-finalized message).
    const completed = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId,
          status: 'failed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
        },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
        reportTrigger: 'terminal_fallback',
      },
    );
    expect(completed).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const completionBody = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    const completionTrace = completionBody.batch.find(
      (item: { type: string }) => item.type === 'trace-create',
    );
    expect(completionTrace?.body?.id).toBe(expectedTraceId);

    // User rates the failed run; scores must target the same :tf body id.
    await reportRunFeedback(
      makeFeedbackCtx({
        runId,
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const feedbackBody = JSON.parse(fetchSpy.mock.calls[1]![1].body as string);
    expect(feedbackBody.batch).toHaveLength(1);
    expect(feedbackBody.batch[0].type).toBe('score-create');
    expect(feedbackBody.batch[0].body.traceId).toBe(expectedTraceId);
    expect(feedbackBody.batch[0].body.id).toBe(`${expectedTraceId}-rating`);
    expect(feedbackBody.batch[0].body.traceId).not.toBe(runId);
  });

  it('defers feedback when telemetryFinalized without an accepted anchor yet', () => {
    // Live finalization race: message row is finalized before reportRunCompleted
    // persists acceptedTraceBodyId / acceptedDeliveryChannel — only while this
    // process still has a final-purpose delivery in flight.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    markRunAwaitingFinalAcceptance('run-finalized-no-anchor');
    expect(
      shouldDeferRunFeedback({
        runId: 'run-finalized-no-anchor',
        runStatus: 'succeeded',
        telemetryFinalized: true,
      }),
    ).toBe(true);
    expect(
      shouldDeferRunFeedback({
        runId: 'run-finalized-with-body',
        runStatus: 'succeeded',
        telemetryFinalized: true,
        acceptedTraceBodyId: 'run-finalized-with-body',
      }),
    ).toBe(false);
    // Cold finalized/no-anchor (no in-flight completer) must not queue forever.
    expect(
      shouldDeferRunFeedback({
        runId: 'run-cold-finalized-no-anchor',
        runStatus: 'succeeded',
        telemetryFinalized: true,
      }),
    ).toBe(false);
    // Cold failed/canceled after restart (or after fallback cleared) with no
    // awaiting mark must not queue forever on status alone.
    expect(
      shouldDeferRunFeedback({
        runId: 'run-cold-failed-no-anchor',
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferRunFeedback({
        runId: 'run-cold-canceled-no-anchor',
        runStatus: 'canceled',
      }),
    ).toBe(false);
    // Unscoped feedback (no status / finalized signal) still ships immediately
    // when no run-scoped awaiting token exists (cold / no completer).
    expect(
      shouldDeferRunFeedback({
        runId: 'run-no-context',
      }),
    ).toBe(false);
  });

  it('defers unscoped feedback while a run-scoped terminal_fallback token is open (row-reuse window)', () => {
    // After assistant-row reuse, getRunFeedbackTelemetryAnchor(run A) returns
    // null until A:tf is accepted — resolveInput is only { runId }. The
    // schedule-time awaiting token is keyed by immutable run_id so feedback
    // still defers instead of shipping on canonical runId.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-a-null-anchor-pending-tf';
    markRunAwaitingFinalAcceptance(runId);
    expect(shouldDeferRunFeedback({ runId })).toBe(true);
    clearRunAwaitingFinalAcceptance(runId);
    expect(shouldDeferRunFeedback({ runId })).toBe(false);
  });

  it('keeps deferral until the last in-flight final-purpose attempt clears without accept', async () => {
    // terminal_fallback + final_message can both be in flight. The first
    // clear must not flush deferred feedback onto canonical runId while the
    // other delivery can still accept a sticky body (e.g. runId:tf).
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-dual-inflight-final';
    const expectedTf = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    const tokenTf = markRunAwaitingFinalAcceptance(runId);
    const tokenFinal = markRunAwaitingFinalAcceptance(runId);
    expect(shouldDeferRunFeedback({ runId })).toBe(true);

    await reportRunFeedback(
      makeFeedbackCtx({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    // First attempt fails/ends — other delivery still pending.
    clearRunAwaitingFinalAcceptance(runId, tokenTf);
    expect(shouldDeferRunFeedback({ runId })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Second attempt accepts sticky :tf and flushes the deferred score there.
    rememberAcceptedFinalTraceBodyId(runId, expectedTf, 'terminal_fallback', 'langfuse');
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body.batch[0].body.traceId).toBe(expectedTf);
    // Stale clear of the already-superseded token must not re-flush canonical.
    clearRunAwaitingFinalAcceptance(runId, tokenFinal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('flushes deferred feedback to canonical only after the last in-flight attempt fails', async () => {
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-dual-inflight-both-fail';
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    const tokenTf = markRunAwaitingFinalAcceptance(runId);
    const tokenFinal = markRunAwaitingFinalAcceptance(runId);
    await reportRunFeedback(
      makeFeedbackCtx({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    clearRunAwaitingFinalAcceptance(runId, tokenTf);
    expect(fetchSpy).not.toHaveBeenCalled();

    clearRunAwaitingFinalAcceptance(runId, tokenFinal);
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body.batch[0].body.traceId).toBe(runId);
  });

  it('defers feedback submitted before terminal_fallback acceptance onto runId:tf', async () => {
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-feedback-before-tf';
    const expectedTraceId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    // Live terminal_fallback delay/report window: awaiting mark is set when the
    // fallback timer is scheduled (or when report starts).
    markRunAwaitingFinalAcceptance(runId);
    // User rates during the fallback delay: no accepted body yet.
    expect(
      shouldDeferRunFeedback({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe(true);
    await reportRunFeedback(
      makeFeedbackCtx({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    // Deferred — nothing shipped onto the provisional canonical runId.
    expect(fetchSpy).not.toHaveBeenCalled();

    // Later terminal_fallback is accepted; deferred score must land on :tf.
    const completed = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId,
          status: 'failed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
        },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
        reportTrigger: 'terminal_fallback',
      },
    );
    expect(completed).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const completionBody = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    const completionTrace = completionBody.batch.find(
      (item: { type: string }) => item.type === 'trace-create',
    );
    expect(completionTrace?.body?.id).toBe(expectedTraceId);

    const feedbackBody = JSON.parse(fetchSpy.mock.calls[1]![1].body as string);
    expect(feedbackBody.batch).toHaveLength(1);
    expect(feedbackBody.batch[0].type).toBe('score-create');
    expect(feedbackBody.batch[0].body.traceId).toBe(expectedTraceId);
    expect(feedbackBody.batch[0].body.id).toBe(`${expectedTraceId}-rating`);
    expect(feedbackBody.batch[0].body.traceId).not.toBe(runId);
  });

  it('replays deferred feedback onto final_message after terminal_fallback was accepted first', async () => {
    // feedback during delay → terminal_fallback accepted → final_message accepted.
    // The score must re-attach to the canonical body once final_message wins;
    // flushing (and deleting) only on the first acceptance would leave it on :tf.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-feedback-tf-then-final';
    const fallbackTraceId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    markRunAwaitingFinalAcceptance(runId);
    expect(
      shouldDeferRunFeedback({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
      }),
    ).toBe(true);
    await reportRunFeedback(
      makeFeedbackCtx({
        runId,
        runStatus: 'failed',
        telemetryFinalized: false,
        reasonCodes: [],
      }),
      { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    const fallbackCompleted = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId,
          status: 'failed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_000,
        },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
        reportTrigger: 'terminal_fallback',
      },
    );
    expect(fallbackCompleted).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const afterFallbackScore = JSON.parse(
      fetchSpy.mock.calls[1]![1].body as string,
    );
    expect(afterFallbackScore.batch[0].body.traceId).toBe(fallbackTraceId);

    const finalCompleted = await reportRunCompleted(
      makeCtx({
        prefs: { metrics: true, content: true, artifactManifest: false },
        run: {
          runId,
          status: 'failed',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_002_000,
        },
      }),
      {
        config: TEST_CONFIG,
        fetchImpl: fetchSpy as any,
        reportTrigger: 'final_message',
      },
    );
    expect(finalCompleted).toEqual({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted',
      langfuse_delivery_channel: 'langfuse',
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    const finalScoreBody = JSON.parse(fetchSpy.mock.calls[3]![1].body as string);
    expect(finalScoreBody.batch).toHaveLength(1);
    expect(finalScoreBody.batch[0].type).toBe('score-create');
    expect(finalScoreBody.batch[0].body.traceId).toBe(runId);
    expect(finalScoreBody.batch[0].body.id).toBe(`${runId}-rating`);
    expect(finalScoreBody.batch[0].body.traceId).not.toBe(fallbackTraceId);
    expect(resolveFeedbackTraceId({ runId })).toBe(runId);
  });

  it('drops terminal-fallback-only deferred feedback after the late-final window', async () => {
    // TF-only runs never get a final_message; the deferred queue must not keep
    // custom reasons / opts.config (Control Keys) until daemon exit.
    vi.useFakeTimers();
    try {
      resetAcceptedFinalTraceBodyIdsForTests();
      resetPendingRunFeedbackForTests();
      const runId = 'run-feedback-tf-only-drop';
      const fallbackTraceId = scopedTelemetryBodyId(
        runId,
        'final',
        'terminal_fallback',
      );
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );

      const tfToken = markRunAwaitingFinalAcceptance(runId);
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          reasonCodes: ['other'],
          customReason: 'leaky-custom-reason',
        }),
        { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      rememberAcceptedFinalTraceBodyId(
        runId,
        fallbackTraceId,
        'terminal_fallback',
        'langfuse',
      );
      // Production finally releases the TF attempt token after acceptance.
      clearRunAwaitingFinalAcceptance(runId, tfToken);

      // Immediate flush onto :tf; queue retained for a possible late final.
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      const flushed = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
      expect(flushed.batch[0].body.traceId).toBe(fallbackTraceId);
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      await vi.advanceTimersByTimeAsync(TERMINAL_FALLBACK_LATE_FINAL_FEEDBACK_MS);
      expect(hasPendingRunFeedbackForTests(runId)).toBe(false);

      // A final_message after the window must not re-ship the dropped payload.
      const finalCompleted = await reportRunCompleted(
        makeCtx({
          prefs: { metrics: true, content: true, artifactManifest: false },
          run: {
            runId,
            status: 'failed',
            startedAt: 1_700_000_000_000,
            endedAt: 1_700_000_002_000,
          },
        }),
        {
          config: TEST_CONFIG,
          fetchImpl: fetchSpy as any,
          reportTrigger: 'final_message',
        },
      );
      expect(finalCompleted).toEqual({
        langfuse_expected: true,
        langfuse_delivery_status: 'accepted',
        langfuse_delivery_channel: 'langfuse',
      });
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
      const finalBody = JSON.parse(fetchSpy.mock.calls[1]![1].body as string);
      expect(
        finalBody.batch.some((item: { type: string }) => item.type === 'score-create'),
      ).toBe(false);
      expect(hasPendingRunFeedbackForTests(runId)).toBe(false);
    } finally {
      vi.useRealTimers();
      resetPendingRunFeedbackForTests();
    }
  });

  it('re-resolves a stale submit-time sink when deferred feedback flushes on a different channel', async () => {
    // Queued while Vela was selected; final body accepted on relay (e.g. Vela
    // 401/403 fallback). Flush must not keep the Vela opts.config — that would
    // fail canDeliverRunFeedback and drop the score silently.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-deferred-channel-switch';
    const previous = {
      VELA_CONTROL_KEY: process.env.VELA_CONTROL_KEY,
      VELA_API_URL: process.env.VELA_API_URL,
      OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    };
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    delete process.env.VELA_CONTROL_KEY;
    delete process.env.VELA_API_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const velaAtSubmit: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_stale_submit',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
    };
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));

    try {
      markRunAwaitingFinalAcceptance(runId);
      expect(
        shouldDeferRunFeedback({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
        }),
      ).toBe(true);
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          reasonCodes: [],
        }),
        { config: velaAtSubmit, fetchImpl: fetchSpy as any },
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      // Accepted body landed on relay (not the Vela sink queued at submit).
      rememberAcceptedFinalTraceBodyId(
        runId,
        scopedTelemetryBodyId(runId, 'final', 'terminal_fallback'),
        'terminal_fallback',
        'relay',
      );

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://telemetry.open-design.ai/api/langfuse',
      );
      expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(
        '/api/v1/open-design/telemetry',
      );
      const feedbackBody = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
      expect(feedbackBody.batch[0].type).toBe('score-create');
      expect(feedbackBody.batch[0].body.traceId).toBe(
        scopedTelemetryBodyId(runId, 'final', 'terminal_fallback'),
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('re-resolves a stale submit-time Vela key when deferred feedback flushes on the same channel', async () => {
    // Queued under Control Key A; user switches AMR profile before the final
    // body is accepted. Acceptance is still `vela` but with key B. Kind-only
    // flush opts would keep key A, fail canDeliverRunFeedback on the accepted
    // identity, and drop the score even though the live Vela sink matches.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-deferred-vela-identity-switch';
    const previous = {
      VELA_CONTROL_KEY: process.env.VELA_CONTROL_KEY,
      VELA_API_URL: process.env.VELA_API_URL,
      OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    };
    process.env.VELA_CONTROL_KEY = 'ck_accepted_after_switch';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const velaAtSubmit: TelemetrySinkConfig = {
      kind: 'vela',
      apiUrl: 'https://amr-api.example.com',
      controlKey: 'ck_stale_submit',
      timeoutMs: 20_000,
      retries: 0,
      profile: 'prod',
      authSource: 'env',
    };
    const acceptingIdentity = velaSinkIdentityFingerprint(
      'prod',
      'ck_accepted_after_switch',
    );
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));

    try {
      markRunAwaitingFinalAcceptance(runId);
      expect(
        shouldDeferRunFeedback({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
        }),
      ).toBe(true);
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          reasonCodes: [],
        }),
        { config: velaAtSubmit, fetchImpl: fetchSpy as any },
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      rememberAcceptedFinalTraceBodyId(
        runId,
        scopedTelemetryBodyId(runId, 'final', 'terminal_fallback'),
        'terminal_fallback',
        'vela',
        acceptingIdentity,
      );

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      expect(String(fetchSpy.mock.calls[0]![0])).toContain(
        '/api/v1/open-design/telemetry',
      );
      // Live env key B — not the stale submit-time key A.
      expect(String(fetchSpy.mock.calls[0]![1].headers?.Authorization ?? '')).toBe(
        'Bearer ck_accepted_after_switch',
      );
      const envelope = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
      expect(envelope.version).toBe(1);
      expect(envelope.installationId).toBe('install-uuid-1');
      expect(envelope.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'score',
            data: expect.objectContaining({
              name: 'user_rating',
              traceId: scopedTelemetryBodyId(
                runId,
                'final',
                'terminal_fallback',
              ),
            }),
          }),
        ]),
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('drops deferred feedback when live telemetry consent is revoked before flush', async () => {
    // Queued while metrics+content were on; user opts out before terminal_fallback
    // accepts. Flush must re-check live prefs and drop without shipping the
    // custom reason (stale submit-time prefs alone would still send).
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-deferred-consent-revoked';
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    try {
      setLiveTelemetryPrefsReaderForTests(() => ({
        metrics: true,
        content: true,
      }));
      markRunAwaitingFinalAcceptance(runId);
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          rating: 'negative',
          reasonCodes: [],
          hasCustomReason: true,
          customReason: 'secret free-text reason',
        }),
        { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // Consent revoked during the terminal-fallback delay window.
      setLiveTelemetryPrefsReaderForTests(() => ({
        metrics: false,
        content: false,
      }));

      rememberAcceptedFinalTraceBodyId(
        runId,
        scopedTelemetryBodyId(runId, 'final', 'terminal_fallback'),
        'terminal_fallback',
        'langfuse',
      );

      // Allow any async flush attempt to settle; network must stay silent.
      await vi.waitFor(() => {
        expect(hasPendingRunFeedbackForTests(runId)).toBe(false);
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      resetPendingRunFeedbackForTests();
    }
  });

  it('fails closed on deferred flush when OD_DATA_DIR is unset and consent flipped via configured data root', async () => {
    // Production resolves RUNTIME_DATA_DIR even when OD_DATA_DIR is absent.
    // Consent re-check must read that root — not fall back to the queued
    // submit-time snapshot when process.env.OD_DATA_DIR is empty.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    const runId = 'run-deferred-consent-via-data-dir';
    const dataDir = mkdtempSync(path.join(tmpdir(), 'od-deferred-consent-'));
    const previousOdDataDir = process.env.OD_DATA_DIR;
    delete process.env.OD_DATA_DIR;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
    );

    try {
      // No test reader: production path only.
      setLiveTelemetryPrefsReaderForTests(undefined);
      configureDeferredFeedbackDataDir(dataDir);
      writeFileSync(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ telemetry: { metrics: true, content: true } }),
      );

      markRunAwaitingFinalAcceptance(runId);
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          rating: 'negative',
          reasonCodes: [],
          hasCustomReason: true,
          customReason: 'queued custom reason',
        }),
        { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
      );
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // Opt out after queueing; live config must win over queued prefs.
      writeFileSync(
        path.join(dataDir, 'app-config.json'),
        JSON.stringify({ telemetry: { metrics: false, content: false } }),
      );

      rememberAcceptedFinalTraceBodyId(
        runId,
        scopedTelemetryBodyId(runId, 'final', 'terminal_fallback'),
        'terminal_fallback',
        'langfuse',
      );

      await vi.waitFor(() => {
        expect(hasPendingRunFeedbackForTests(runId)).toBe(false);
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (previousOdDataDir === undefined) delete process.env.OD_DATA_DIR;
      else process.env.OD_DATA_DIR = previousOdDataDir;
      rmSync(dataDir, { recursive: true, force: true });
      resetPendingRunFeedbackForTests();
    }
  });

  it('keeps the deferred queue past the late-final window while final_message is still in flight', async () => {
    // terminal_fallback accepts first and would schedule a 30s drop, but a
    // concurrent final_message can take ~40s (20s timeout + 1 retry). Tokens
    // must survive TF accept so the drop timer re-arms until FM completes.
    vi.useFakeTimers();
    try {
      resetAcceptedFinalTraceBodyIdsForTests();
      resetPendingRunFeedbackForTests();
      setLiveTelemetryPrefsReaderForTests(() => ({
        metrics: true,
        content: true,
      }));
      const runId = 'run-tf-then-slow-final';
      const fallbackTraceId = scopedTelemetryBodyId(
        runId,
        'final',
        'terminal_fallback',
      );
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );

      const tokenTf = markRunAwaitingFinalAcceptance(runId);
      const tokenFinal = markRunAwaitingFinalAcceptance(runId);

      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          rating: 'positive',
          reasonCodes: [],
        }),
        { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
      );
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // TF accepts first; preserve the final_message token.
      rememberAcceptedFinalTraceBodyId(
        runId,
        fallbackTraceId,
        'terminal_fallback',
        'langfuse',
      );
      clearRunAwaitingFinalAcceptance(runId, tokenTf);

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // Mid-window re-rate while only :tf is accepted.
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          runStatus: 'failed',
          telemetryFinalized: false,
          rating: 'negative',
          reasonCodes: ['matched_request'],
          acceptedReportTrigger: 'terminal_fallback',
          acceptedDeliveryChannel: 'langfuse',
          traceId: fallbackTraceId,
        }),
        { config: TEST_CONFIG, fetchImpl: fetchSpy as any },
      );
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      // Past the default 30s late-final window; queue must still be held
      // because final_message is still in flight.
      await vi.advanceTimersByTimeAsync(TERMINAL_FALLBACK_LATE_FINAL_FEEDBACK_MS + 5_000);
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // Slow final_message accepts after ~40s of Vela timeout/retry budget.
      rememberAcceptedFinalTraceBodyId(runId, runId, 'final_message', 'langfuse');
      clearRunAwaitingFinalAcceptance(runId, tokenFinal);

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });
      const finalScore = JSON.parse(fetchSpy.mock.calls[2]![1].body as string);
      expect(finalScore.batch[0].type).toBe('score-create');
      expect(finalScore.batch[0].body.traceId).toBe(runId);
      expect(finalScore.batch[0].body.value).toBe(-1);
      expect(hasPendingRunFeedbackForTests(runId)).toBe(false);
    } finally {
      vi.useRealTimers();
      resetPendingRunFeedbackForTests();
    }
  });

  it('refreshes deferred queue on re-rate even when sticky Vela identity cannot deliver', async () => {
    // TF accepted under Vela identity A; user switches profile before re-rating.
    // Immediate send is suppressed, but the deferred queue must still take the
    // new score so final_message under identity B can replay it.
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    setLiveTelemetryPrefsReaderForTests(() => ({
      metrics: true,
      content: true,
    }));
    const runId = 'run-tf-vela-identity-rerate-queue';
    const previous = {
      VELA_CONTROL_KEY: process.env.VELA_CONTROL_KEY,
      VELA_API_URL: process.env.VELA_API_URL,
      OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    };
    process.env.VELA_CONTROL_KEY = 'ck_new_after_switch';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const oldIdentity = velaSinkIdentityFingerprint('prod', 'ck_old_accepted');
    const newIdentity = velaSinkIdentityFingerprint('prod', 'ck_new_after_switch');
    const fallbackBodyId = scopedTelemetryBodyId(
      runId,
      'final',
      'terminal_fallback',
    );
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));

    try {
      markRunAwaitingFinalAcceptance(runId);
      rememberAcceptedFinalTraceBodyId(
        runId,
        fallbackBodyId,
        'terminal_fallback',
        'vela',
        oldIdentity,
      );

      // Live sink after profile switch (new key). Sticky accepted identity is
      // still the old fingerprint, so canDeliverRunFeedback rejects the send.
      const liveVela: TelemetrySinkConfig = {
        kind: 'vela',
        apiUrl: 'https://amr-api.example.com',
        controlKey: 'ck_new_after_switch',
        timeoutMs: 20_000,
        retries: 0,
        profile: 'prod',
        authSource: 'env',
      };
      await reportRunFeedback(
        makeFeedbackCtx({
          runId,
          rating: 'negative',
          reasonCodes: ['matched_request'],
          acceptedReportTrigger: 'terminal_fallback',
          acceptedDeliveryChannel: 'vela',
          acceptedVelaIdentity: oldIdentity,
          traceId: fallbackBodyId,
        }),
        { config: liveVela, fetchImpl: fetchSpy as any },
      );
      // Immediate send suppressed.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

      // final_message accepts under the new Vela identity and must replay the
      // re-rated (negative) score — not drop for lack of a refreshed queue.
      rememberAcceptedFinalTraceBodyId(
        runId,
        runId,
        'final_message',
        'vela',
        newIdentity,
      );

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
      const envelope = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
      expect(envelope.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'score',
            data: expect.objectContaining({
              name: 'user_rating',
              value: -1,
              traceId: runId,
            }),
          }),
        ]),
      );
      expect(String(fetchSpy.mock.calls[0]![1].headers?.Authorization ?? '')).toBe(
        'Bearer ck_new_after_switch',
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetPendingRunFeedbackForTests();
    }
  });
});
