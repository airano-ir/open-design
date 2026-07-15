import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reportRunCompletedFromDaemon,
  reportRunFeedbackFromDaemon,
} from '../src/langfuse-bridge.js';
import {
  hasPendingRunFeedbackForTests,
  markRunAwaitingFinalAcceptance,
  rememberAcceptedFinalTraceBodyId,
  reportRunCompleted,
  resetAcceptedFinalTraceBodyIdsForTests,
  resetPendingRunFeedbackForTests,
  scopedTelemetryBodyId,
  setLiveTelemetryPrefsReaderForTests,
  velaSinkIdentityFingerprint,
} from '../src/langfuse-trace.js';
import { buildPromptStackTelemetry } from '../src/prompt-telemetry.js';

interface FakeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Owning run id when known; foreign ownership must not be published. */
  runId?: string | null;
  attachments?: Array<Record<string, unknown>>;
  producedFiles?: Array<Record<string, unknown>>;
  traceObjectFiles?: Array<Record<string, unknown>>;
}

function makeDb(messagesByConvo: Record<string, FakeMessage[]> = {}) {
  return {
    __messages: messagesByConvo,
    prepare() {
      throw new Error('listMessages should be the only DB call in tests');
    },
  };
}

function makeRun(over: Partial<Parameters<typeof reportRunCompletedFromDaemon>[0]['run']> = {}) {
  const now = Date.now();
  return {
    id: 'run-id-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    assistantMessageId: 'msg-1',
    agentId: 'claude',
    status: 'succeeded',
    createdAt: now - 4500,
    updatedAt: now,
    events: [
      {
        id: 1,
        event: 'agent',
        timestamp: now - 4000,
        data: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'ls -la' },
        },
      },
      {
        id: 2,
        event: 'agent',
        timestamp: now - 3500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-1',
          content: 'total 0',
          isError: false,
        },
      },
      {
        id: 3,
        event: 'agent',
        timestamp: now - 3000,
        data: {
          type: 'tool_use',
          id: 'tool-2',
          name: 'Write',
          input: { path: 'index.html' },
        },
      },
      {
        id: 4,
        event: 'agent',
        timestamp: now - 2500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-2',
          content: 'wrote index.html',
          isError: false,
        },
      },
      {
        id: 5,
        event: 'agent',
        timestamp: now - 2000,
        data: {
          type: 'usage',
          usage: { input_tokens: 100, output_tokens: 200 },
        },
      },
    ] as Array<{ id: number; event: string; data: unknown; timestamp?: number }>,
    userPrompt: 'design a coffee landing page',
    ...over,
  };
}

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

describe('langfuse-bridge.reportRunCompletedFromDaemon', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-bridge-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeAppCfg(cfg: Record<string, unknown>) {
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify(cfg));
  }

  it('does nothing when telemetry.metrics is off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: false },
    });
    const fetchSpy = vi.fn();
    await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not publish reused assistant-row content under a prior run id', async () => {
    // A -> B reuse: delayed terminal_fallback for failed run A still holds
    // assistantMessageId, but the row now belongs to succeeded run B. Emitting
    // B's content/files under A's failed trace is cross-run corruption.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'final B — must not appear on run A',
              runId: 'run-b-reused',
              producedFiles: [
                {
                  name: 'b-only.html',
                  kind: 'html',
                  size: 42,
                },
              ],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          id: 'run-a-failed-pending-fallback',
          assistantMessageId: 'assistant-1',
          status: 'failed',
          userPrompt: 'prompt for run A',
        }) as any,
        persistedRunStatus: 'failed',
        reportTrigger: 'terminal_fallback',
        fetchImpl: fetchSpy as any,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const batch = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
      ).batch as Array<{ type: string; body: Record<string, any> }>;
      const trace = batch.find((item) => item.type === 'trace-create')?.body;
      expect(trace?.id).toBe('run-a-failed-pending-fallback:tf');
      expect(trace?.input).toBe('prompt for run A');
      // Foreign row content and artifact inventory must not leak onto run A.
      // Empty assistant output is omitted from the payload (undefined), not "".
      expect(trace?.output ?? '').toBe('');
      expect(String(trace?.output ?? '')).not.toContain('final B');
      const artifacts = batch.find(
        (item) =>
          item.type === 'event-create' && item.body?.name === 'artifact-summary',
      )?.body;
      expect(artifacts?.output?.artifacts ?? []).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'b-only.html' }),
        ]),
      );

      // Positive control: matching run ownership still ships content.
      fetchSpy.mockClear();
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'owned by run B',
              runId: 'run-b-reused',
              producedFiles: [{ name: 'b-only.html', kind: 'html', size: 42 }],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          id: 'run-b-reused',
          assistantMessageId: 'assistant-1',
          status: 'succeeded',
          userPrompt: 'prompt for run B',
        }) as any,
        fetchImpl: fetchSpy as any,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const ownedBatch = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
      ).batch as Array<{ type: string; body: Record<string, any> }>;
      const ownedTrace = ownedBatch.find(
        (item) => item.type === 'trace-create',
      )?.body;
      expect(ownedTrace?.output).toBe('owned by run B');
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
  });

  it('does nothing when conversation/tool content reporting is off', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: false, artifactManifest: true },
    });
    const fetchSpy = vi.fn();
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'sensitive output',
              producedFiles: [{ name: 'secret.html', kind: 'html', size: 1 }],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no app-config.json exists (fresh install)', async () => {
    const fetchSpy = vi.fn();
    await reportRunCompletedFromDaemon({
      db: makeDb(),
      dataDir,
      run: makeRun() as any,
      fetchImpl: fetchSpy as any,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds a ReportContext from db + app-config and POSTs the trace', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const messages: FakeMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Use this reference.',
        attachments: [
          {
            path: 'uploads/brand.pdf',
            name: 'brand.pdf',
            kind: 'file',
            size: 2_481_032,
            mime: 'application/pdf',
            sha256: '1234abcd',
          },
        ],
      },
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Here is a draft …',
        producedFiles: [
          {
            name: 'index.html',
            path: '/Users/alice/private/project/index.html',
            kind: 'html',
            mime: 'text/html',
            size: 4096,
            hash: 'sha256:artifacthash',
            artifactManifest: {
              version: 1,
              kind: 'html',
              status: 'complete',
              exports: ['html'],
            },
          },
          { name: 'style.css', kind: 'code', size: 800 },
        ],
      },
    ];
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': messages }),
        dataDir,
        run: makeRun({ agentId: 'qoder' }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    expect(batch.map((item) => item.type)).toEqual([
      'trace-create',
      'span-create',
      'generation-create',
      'event-create',
      'span-create',
      'span-create',
      'event-create',
    ]);
    const trace = batch[0].body;
    const span = bodyOf(batch, 'span-create', 'agent-run');
    const generation = bodyOf(batch, 'generation-create', 'llm');
    const bash = bodyOf(batch, 'span-create', 'tool:Bash');
    const write = bodyOf(batch, 'span-create', 'tool:Write');
    const usage = bodyOf(batch, 'event-create', 'agent-usage');
    const artifacts = bodyOf(batch, 'event-create', 'artifact-summary');
    expect(trace.userId).toBe('install-uuid-1');
    expect(trace.sessionId).toBe('conv-1');
    expect(trace.input).toBe('design a coffee landing page');
    expect(trace.output).toBe('Here is a draft …');
    expect(span.id).toBe('run-id-1-agent');
    expect(span.traceId).toBe('run-id-1');
    expect(span.input).toBe('design a coffee landing page');
    expect(span.output).toBe('Here is a draft …');
    expect(generation.parentObservationId).toBe('run-id-1-agent');
    expect(bash.parentObservationId).toBe('run-id-1-agent');
    expect(bash.input).toMatch(/ls -la/);
    expect(bash.output).toBe('total 0');
    expect(write.parentObservationId).toBe('run-id-1-agent');
    expect(write.metadata.toolName).toBe('Write');
    expect(usage.parentObservationId).toBe('run-id-1-agent');
    expect(usage.input).toEqual({
      source: 'qoder',
      event_type: 'usage',
    });
    expect(usage.output.usage).toEqual({ input_tokens: 100, output_tokens: 200 });
    expect(artifacts.parentObservationId).toBe('run-id-1-agent');
    expect(artifacts.input).toEqual({
      source: 'agent_generated_artifacts',
      artifact_count: 2,
      artifact_manifest_enabled: true,
    });
    expect(artifacts.output).toEqual({
      artifacts: [
        { slug: 'index.html', type: 'html', sizeBytes: 4096 },
        { slug: 'style.css', type: 'code', sizeBytes: 800 },
      ],
      manifest_completeness: 'complete',
    });
    expect(artifacts.metadata.artifacts).toEqual([
      { slug: 'index.html', type: 'html', sizeBytes: 4096 },
      { slug: 'style.css', type: 'code', sizeBytes: 800 },
    ]);
    expect(trace.metadata.attachment_manifest).toEqual([
      expect.objectContaining({
        attachment_id: expect.stringMatching(/^att_[0-9a-f]{16}$/),
        object_class: 'attachment',
        storage_ref: expect.stringMatching(
          /^od:\/\/objects\/workspaces\/unknown\/projects\/proj-1\/runs\/run-id-1\/attachment\/att_[0-9a-f]{16}$/,
        ),
        project_id: 'proj-1',
        run_id: 'run-id-1',
        workspace_id: null,
        status: 'ok',
        size_bytes: 2_481_032,
        sha256: 'sha256:1234abcd',
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
      }),
    ]);
    expect(trace.metadata.artifact_manifest).toEqual([
      expect.objectContaining({
        artifact_id: expect.stringMatching(/^art_[0-9a-f]{16}$/),
        object_class: 'artifact',
        type: 'html',
        storage_ref: expect.stringMatching(
          /^od:\/\/objects\/workspaces\/unknown\/projects\/proj-1\/runs\/run-id-1\/artifact\/art_[0-9a-f]{16}$/,
        ),
        project_id: 'proj-1',
        run_id: 'run-id-1',
        workspace_id: null,
        status: 'ok',
        size_bytes: 4096,
        sha256: 'sha256:artifacthash',
        mime_type: 'text/html',
        extension: 'html',
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
      }),
      expect.objectContaining({
        object_class: 'artifact',
        type: 'code',
        size_bytes: 800,
        extension: 'css',
        export_status: 'unavailable',
      }),
    ]);
    expect(trace.metadata.manifest_completeness).toBe('complete');
    expect(JSON.stringify(batch)).not.toContain('/Users/alice/private/project');
    expect(JSON.stringify(batch)).not.toContain('brand.pdf');
    // Core tags must be present. The bridge also tacks on an `os:<...>`
    // tag derived from the host (`darwin` / `linux` / `win32`), which is
    // useful telemetry but varies between dev / CI environments — assert
    // its presence by prefix rather than pinning a value.
    expect(trace.tags).toEqual(
      expect.arrayContaining(['open-design', 'project:proj-1', 'agent:qoder']),
    );
    expect((trace.tags as string[]).some((t) => t.startsWith('os:'))).toBe(true);
    expect(trace.metadata.eventsSummary.toolCalls).toBe(2);
    expect(trace.metadata.eventsSummary.errors).toBe(0);
    expect(trace.metadata.tokens).toEqual({
      input: 100,
      inputProvider: 100,
      inputEffective: 100,
      output: 200,
      total: 300,
      estimatedContext: 93,
      cacheTokenSource: 'unavailable',
    });
    expect(trace.metadata.artifacts).toEqual([
      { slug: 'index.html', type: 'html', sizeBytes: 4096 },
      { slug: 'style.css', type: 'code', sizeBytes: 800 },
    ]);
    expect(trace.metadata.success).toBe(true);
  });

  it('collects runtime diagnostic agent events into Langfuse observations', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: '',
              producedFiles: [],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          agentId: 'amr',
          events: [
            {
              id: 1,
              event: 'agent',
              timestamp: Date.now() - 100,
              data: {
                type: 'diagnostic',
                name: 'acp_artifact_text_suppression',
                source: 'acp-json-rpc',
                reason: 'artifact_echo',
                suppressedChars: 4096,
                openedBlocks: 1,
                closedBlocks: 1,
                fileCount: 1,
                files: ['index.html'],
              },
            },
          ] as any,
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    expect(
      bodyOf(batch, 'event-create', 'agent-diagnostic:acp_artifact_text_suppression'),
    ).toMatchObject({
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
        file_count: 1,
        files: ['index.html'],
      },
      metadata: {
        diagnostic_name: 'acp_artifact_text_suppression',
      },
    });
  });

  it('marks trace-safe object manifests partial when object accounting is incomplete', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: 'Use this reference.',
              attachments: [{ path: 'uploads/brand.pdf', kind: 'file' }],
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Here is a draft …',
              producedFiles: [{ name: 'index.html', kind: 'html' }],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    expect(trace.metadata.manifest_completeness).toBe('partial');
    expect(trace.metadata.attachment_manifest[0]).toMatchObject({
      object_class: 'attachment',
      status: 'partial',
      reason: 'size_unavailable',
    });
    expect(trace.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'partial',
      reason: 'size_unavailable',
    });
  });

  it('derives production object uploads from the telemetry relay while keeping bodies out of Langfuse', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const projectDir = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'brief.txt'), 'private attachment body');
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><h1>private artifact</h1>');
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/objects/authorize')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; sha256: string; size_bytes: number }>;
        };
        expect(parsed.objects).toHaveLength(2);
        return new Response(JSON.stringify({ upload_token: 'upload-token' }), { status: 200 });
      }
      if (url.includes('/api/objects/batch')) {
        const parsed = JSON.parse(init.body as string) as {
          upload_token: string;
          objects: Array<{ storage_ref: string; content_base64: string }>;
        };
        expect(parsed.upload_token).toBe('upload-token');
        expect(parsed.objects).toHaveLength(2);
        return new Response(
          JSON.stringify({
            objects: parsed.objects.map((object) => ({
              storage_ref: object.storage_ref,
              status: 'available',
              size_bytes: Buffer.from(object.content_base64, 'base64').byteLength,
              sha256: `sha256:${object.storage_ref.split('/').at(-1)}`,
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 207 });
    });
    const priorNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = 'https://telemetry.open-design.ai/api/langfuse';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: 'Use this reference.',
              attachments: [
                {
                  path: 'brief.txt',
                  name: 'brief.txt',
                  size: 'private attachment body'.length,
                },
              ],
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Done.',
              producedFiles: [{ name: 'index.html', kind: 'html', size: 41 }],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          userPrompt: 'Use this reference.',
          projectAttachmentPaths: ['brief.txt'],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      if (priorNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = priorNodeEnv;
      }
      delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[0]![0]).toContain('/api/langfuse');
    expect(fetchSpy.mock.calls[1]![0]).toBe('https://telemetry.open-design.ai/api/objects/authorize');
    expect(fetchSpy.mock.calls[2]![0]).toBe('https://telemetry.open-design.ai/api/objects/batch');
    expect(fetchSpy.mock.calls[3]![0]).toContain('/api/langfuse');
    const init = fetchSpy.mock.calls[3]![1] as RequestInit;
    const langfuseBody = init.body as string;
    expect(langfuseBody).not.toContain('private attachment body');
    expect(langfuseBody).not.toContain('<!doctype html><h1>private artifact</h1>');
    const batch = JSON.parse(langfuseBody).batch as any[];
    const trace = batch[0].body;
    expect(trace.metadata.manifest_completeness).toBe('complete');
    expect(trace.metadata.attachment_manifest[0]).toMatchObject({
      object_class: 'attachment',
      status: 'ok',
      stored_in_open_design: true,
      size_bytes: 'private attachment body'.length,
    });
    expect(trace.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'ok',
      stored_in_open_design: true,
      size_bytes: '<!doctype html><h1>private artifact</h1>'.length,
    });
  });

  it('uploads trace objects with worker-issued authority before reporting Langfuse manifests', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const projectDir = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'brief.txt'),
      'attachment body should stay out of langfuse',
    );
    await writeFile(
      path.join(projectDir, 'index.html'),
      '<!doctype html><h1>artifact body</h1>',
    );
    const tailMarker = 'TAIL_MARKER_SHOULD_NOT_REACH_LANGFUSE';
    const prompt = `${'长'.repeat(70 * 1024)}${tailMarker}`;
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/objects/authorize')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; sha256: string; size_bytes: number }>;
        };
        expect(parsed.objects).toHaveLength(3);
        expect(parsed.objects.every((object) => /^sha256:[a-f0-9]{64}$/.test(object.sha256)))
          .toBe(true);
        expect(parsed.objects.map((object) => object.size_bytes)).toEqual([
          'attachment body should stay out of langfuse'.length,
          '<!doctype html><h1>artifact body</h1>'.length,
          Buffer.byteLength(prompt, 'utf8'),
        ]);
        return new Response(JSON.stringify({ upload_token: 'upload-token' }), { status: 200 });
      }
      if (url.includes('/api/objects/batch')) {
        const parsed = JSON.parse(init.body as string) as {
          upload_token: string;
          objects: Array<{ storage_ref: string; content_base64: string }>;
        };
        expect(parsed.upload_token).toBe('upload-token');
        expect(parsed.objects).toHaveLength(3);
        return new Response(
          JSON.stringify({
            objects: parsed.objects.map((object) => ({
              storage_ref: object.storage_ref,
              status: 'available',
              size_bytes: Buffer.from(object.content_base64, 'base64').byteLength,
              sha256: `sha256:${object.storage_ref.split('/').at(-1)}`,
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 207 });
    });

    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = 'https://telemetry.open-design.ai/api/langfuse';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: prompt,
              attachments: [
                {
                  path: 'brief.txt',
                  name: 'brief.txt',
                  size: 'attachment body should stay out of langfuse'.length,
                },
              ],
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'done',
              producedFiles: [{ name: 'index.html', kind: 'html', size: 35 }],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          userPrompt: prompt,
          projectAttachmentPaths: ['brief.txt'],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[0]![0]).toContain('/api/langfuse');
    const registrationBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).batch as any[];
    const registrationTrace = registrationBody[0].body;
    expect(registrationTrace.metadata.attachment_manifest[0]).not.toHaveProperty('reason');
    expect(registrationTrace.metadata.artifact_manifest[0]).not.toHaveProperty('reason');
    expect(registrationTrace.metadata.input_text_snapshot_manifest[0]).not.toHaveProperty('reason');
    expect(fetchSpy.mock.calls[1]![0]).toContain('/api/objects/authorize');
    expect(fetchSpy.mock.calls[2]![0]).toContain('/api/objects/batch');
    expect(fetchSpy.mock.calls[3]![0]).toContain('/api/langfuse');
    const langfuseInit = fetchSpy.mock.calls[3]![1] as RequestInit;
    const langfuseBody = langfuseInit.body as string;
    expect(langfuseBody).not.toContain('attachment body should stay out of langfuse');
    expect(langfuseBody).not.toContain('<!doctype html><h1>artifact body</h1>');
    expect(langfuseBody).not.toContain(tailMarker);
    const batch = JSON.parse(langfuseBody).batch as any[];
    const trace = batch[0].body;
    expect(trace.metadata.manifest_completeness).toBe('complete');
    expect(trace.metadata.attachment_manifest).toHaveLength(1);
    expect(trace.metadata.artifact_manifest).toHaveLength(1);
    expect(trace.metadata.input_text_snapshot_manifest).toHaveLength(1);
    expect(trace.metadata.attachment_manifest[0]).toMatchObject({
      object_class: 'attachment',
      status: 'ok',
      stored_in_open_design: true,
      source: 'user_upload',
      retention_policy: 'observability_90d',
      access_scope: 'project',
      sensitivity: 'private',
    });
    expect(trace.metadata.attachment_manifest[0]).not.toHaveProperty('reason');
    expect(trace.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'ok',
      stored_in_open_design: true,
      source: 'agent_generated',
      retention_policy: 'observability_90d',
    });
    expect(trace.metadata.artifact_manifest[0]).not.toHaveProperty('reason');
    expect(trace.metadata.input_text_snapshot_manifest[0]).toMatchObject({
      object_class: 'input_text_snapshot',
      status: 'ok',
      stored_in_open_design: true,
      source: 'user_prompt',
    });
    expect(trace.metadata.input_text_snapshot_manifest[0]).not.toHaveProperty('reason');
    expect(JSON.stringify(trace.metadata)).toContain(
      'od://objects/workspaces/unknown/projects/proj-1/runs/run-id-1',
    );
  });

  it('registers object upload authority through the object relay when traces use direct Langfuse', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const projectDir = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><h1>artifact body</h1>');
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/objects/authorize')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; object_class: string }>;
        };
        expect(parsed.objects).toHaveLength(1);
        expect(parsed.objects[0]).toMatchObject({ object_class: 'artifact' });
        return new Response(JSON.stringify({ upload_token: 'upload-token' }), { status: 200 });
      }
      if (url.includes('/api/objects/batch')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; content_base64: string }>;
        };
        return new Response(
          JSON.stringify({
            objects: parsed.objects.map((object) => ({
              storage_ref: object.storage_ref,
              status: 'available',
              size_bytes: Buffer.from(object.content_base64, 'base64').byteLength,
              sha256: 'sha256:uploaded-artifact',
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 207 });
    });

    process.env.OPEN_DESIGN_OBJECT_RELAY_URL = 'https://telemetry.open-design.ai/api/objects/batch';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            { id: 'user-1', role: 'user', content: 'Build it.' },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'done',
              producedFiles: [{ name: 'index.html', kind: 'html', size: 35 }],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.OPEN_DESIGN_OBJECT_RELAY_URL;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://telemetry.open-design.ai/api/langfuse');
    expect(fetchSpy.mock.calls[1]![0]).toBe('https://telemetry.open-design.ai/api/objects/authorize');
    expect(fetchSpy.mock.calls[2]![0]).toBe('https://telemetry.open-design.ai/api/objects/batch');
    expect(fetchSpy.mock.calls[3]![0]).toBe('https://us.cloud.langfuse.com/api/public/ingestion');
    const registrationBatch = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).batch as any[];
    const finalBatch = JSON.parse(fetchSpy.mock.calls[3]![1]!.body as string).batch as any[];
    expect(registrationBatch[0].body.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      storage_ref: expect.stringContaining(
        'od://objects/workspaces/unknown/projects/proj-1/runs/run-id-1/artifact/',
      ),
    });
    expect(finalBatch[0].body.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'ok',
      stored_in_open_design: true,
    });
  });

  it('uploads modified existing files from traceObjectFiles and records object summary metadata', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const projectDir = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'existing.html'), '<!doctype html><h1>modified</h1>');
    const uploadedFilenames: string[] = [];
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/objects/authorize')) {
        return new Response(JSON.stringify({ upload_token: 'upload-token' }), { status: 200 });
      }
      if (url.includes('/api/objects/batch')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; filename: string; content_base64: string }>;
        };
        uploadedFilenames.push(...parsed.objects.map((object) => object.filename));
        return new Response(
          JSON.stringify({
            objects: parsed.objects.map((object) => ({
              storage_ref: object.storage_ref,
              status: 'available',
              size_bytes: Buffer.from(object.content_base64, 'base64').byteLength,
              sha256: 'sha256:uploaded-artifact',
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 207 });
    });

    process.env.OPEN_DESIGN_OBJECT_RELAY_URL = 'https://telemetry.open-design.ai/api/objects/batch';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            { id: 'user-1', role: 'user', content: 'Update the existing page.' },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'done',
              producedFiles: [],
              traceObjectFiles: [
                {
                  name: 'existing.html',
                  kind: 'html',
                  size: 34,
                  traceObjectReason: 'modified',
                },
              ],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.OPEN_DESIGN_OBJECT_RELAY_URL;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(uploadedFilenames).toEqual(['existing.html']);
    const finalBatch = JSON.parse(fetchSpy.mock.calls.at(-1)![1]!.body as string).batch as any[];
    expect(finalBatch[0].body.metadata.trace_object_summary).toEqual({
      new_file_count: 0,
      modified_file_count: 1,
      recovered_file_count: 0,
      candidate_file_count: 1,
      uploaded_file_count: 1,
      skipped_file_count: 0,
      skip_reasons: {},
    });
    expect(finalBatch[0].body.metadata.artifacts).toEqual([
      { slug: 'existing.html', type: 'html', sizeBytes: 34 },
    ]);
  });

  it('derives manifest completeness from merged uploaded and fallback manifests', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const projectDir = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'index.html'), '<!doctype html><h1>artifact body</h1>');
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/objects/authorize')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; object_class: string }>;
        };
        expect(parsed.objects).toHaveLength(1);
        expect(parsed.objects[0]).toMatchObject({ object_class: 'artifact' });
        return new Response(JSON.stringify({ upload_token: 'upload-token' }), { status: 200 });
      }
      if (url.includes('/api/objects/batch')) {
        const parsed = JSON.parse(init.body as string) as {
          objects: Array<{ storage_ref: string; content_base64: string }>;
        };
        return new Response(
          JSON.stringify({
            objects: parsed.objects.map((object) => ({
              storage_ref: object.storage_ref,
              status: 'available',
              size_bytes: Buffer.from(object.content_base64, 'base64').byteLength,
              sha256: 'sha256:uploaded-artifact',
            })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 207 });
    });

    process.env.OPEN_DESIGN_OBJECT_RELAY_URL = 'https://telemetry.open-design.ai/api/objects/batch';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL = 'https://telemetry.open-design.ai/api/langfuse';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: 'Use the attached reference.',
              attachments: [{ path: 'uploads/brand.pdf', kind: 'file' }],
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'done',
              producedFiles: [{ name: 'index.html', kind: 'html', size: 35 }],
            },
          ],
        }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.OPEN_DESIGN_OBJECT_RELAY_URL;
      delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[0]![0]).toContain('/api/langfuse');
    expect(fetchSpy.mock.calls[1]![0]).toContain('/api/objects/authorize');
    expect(fetchSpy.mock.calls[2]![0]).toContain('/api/objects/batch');
    const langfuseInit = fetchSpy.mock.calls[3]![1] as RequestInit;
    const batch = JSON.parse(langfuseInit.body as string).batch as any[];
    const trace = batch[0].body;
    expect(trace.metadata.manifest_completeness).toBe('partial');
    expect(trace.metadata.attachment_manifest[0]).toMatchObject({
      object_class: 'attachment',
      status: 'partial',
      reason: 'size_unavailable',
    });
    expect(trace.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'ok',
      stored_in_open_design: true,
    });
  });

  it('reports imported project nested artifact manifests without leaking raw paths to Langfuse', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const importedRoot = path.join(dataDir, 'imported-project');
    const managedRoot = path.join(dataDir, 'projects', 'proj-1');
    await mkdir(path.join(importedRoot, 'dist'), { recursive: true });
    await mkdir(managedRoot, { recursive: true });
    await writeFile(path.join(importedRoot, 'dist', 'index.html'), '<!doctype html><h1>imported</h1>');
    await writeFile(path.join(managedRoot, 'index.html'), '<!doctype html><h1>managed</h1>');

    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));

    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            { id: 'user-1', role: 'user', content: 'Create a nested artifact.' },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Done.',
              producedFiles: [
                { name: 'index.html', path: 'dist/index.html', kind: 'html', size: 31 },
              ],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          projectMetadata: { baseDir: importedRoot },
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).not.toContain('/api/objects/batch');
    const langfuseInit = fetchSpy.mock.calls[0]![1] as RequestInit;
    const langfuseBody = langfuseInit.body as string;
    expect(langfuseBody).not.toContain(importedRoot);
    expect(langfuseBody).not.toContain('dist/index.html');
    expect(langfuseBody).not.toContain('<!doctype html><h1>imported</h1>');
    const batch = JSON.parse(langfuseBody).batch as any[];
    const trace = batch[0].body;
    expect(trace.metadata.artifacts).toEqual([
      { slug: 'index.html', type: 'html', sizeBytes: 31 },
    ]);
    expect(trace.metadata.artifact_manifest[0]).toMatchObject({
      object_class: 'artifact',
      status: 'ok',
      stored_in_open_design: true,
      extension: 'html',
    });
  });

  it('carries prior user attachments into follow-up generation traces', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: 'Use this private reference.',
              attachments: [
                {
                  path: 'uploads/private-reference.md',
                  name: 'private-reference.md',
                  size: 562,
                },
              ],
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Please answer the discovery form.',
            },
            {
              id: 'user-2',
              role: 'user',
              content: '[form answers — discovery]\nBuild the artifact.',
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Done.',
              producedFiles: [
                { name: 'index.html', kind: 'html', size: 4096 },
              ],
            },
          ],
        }),
        dataDir,
        run: (() => {
          const now = Date.now();
          return makeRun({
            analyticsTelemetry: {
              promptBuildStartAt: now - 4300,
              promptBuildEndAt: now - 4200,
            },
            promptTelemetry: buildPromptStackTelemetry({
              composedPrompt:
                '# Instructions\n\nBuild the artifact.\n\n---\n# User request\n\n[form answers — discovery]\nBuild the artifact.',
              sections: [
                { kind: 'daemonSystemPrompt', content: 'Build the artifact.' },
                {
                  kind: 'userRequest',
                  content: '[form answers — discovery]\nBuild the artifact.',
                },
              ],
            }),
          });
        })() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const promptBuild = bodyOf(batch, 'span-create', 'prompt-build');
    expect(trace.metadata.attachment_manifest).toHaveLength(1);
    expect(trace.metadata.attachment_manifest[0]).toMatchObject({
      object_class: 'attachment',
      status: 'ok',
      size_bytes: 562,
      extension: 'md',
      source: 'user_upload',
      project_id: 'proj-1',
      run_id: 'run-id-1',
    });
    expect(promptBuild.input.ingredients.attachment_refs).toEqual([
      expect.objectContaining({
        object_class: 'attachment',
        status: 'ok',
        size_bytes: 562,
        extension: 'md',
        source: 'user_upload',
        attachment_id: trace.metadata.attachment_manifest[0].attachment_id,
      }),
    ]);
    const payload = JSON.stringify(batch);
    expect(payload).not.toContain('private-reference.md');
    expect(payload).not.toContain('uploads/private-reference.md');
  });

  it('counts duplicate streamed tool_use records by unique tool id', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            { id: 'user-1', role: 'user', content: 'Create a file.' },
            { id: 'msg-1', role: 'assistant', content: 'Done.', producedFiles: [] },
          ],
        }),
        dataDir,
        run: makeRun({
          events: [
            {
              id: 1,
              event: 'agent',
              timestamp: Date.now() - 3000,
              data: {
                type: 'tool_use',
                id: 'write-1',
                name: 'Write',
                input: { path: 'index.html', content: '<!doctype html>' },
              },
            },
            {
              id: 2,
              event: 'agent',
              timestamp: Date.now() - 2900,
              data: {
                type: 'tool_use',
                id: 'write-1',
                name: 'Write',
                input: { path: 'index.html', content: '<!doctype html>' },
              },
            },
            {
              id: 3,
              event: 'agent',
              timestamp: Date.now() - 2500,
              data: {
                type: 'tool_result',
                toolUseId: 'write-1',
                content: 'wrote index.html',
                isError: false,
              },
            },
          ],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const toolSpans = batch.filter(
      (item) => item.type === 'span-create' && item.body.name === 'tool:Write',
    );
    expect(trace.metadata.eventsSummary.toolCalls).toBe(1);
    expect(trace.metadata.eventsSummary.errors).toBe(0);
    expect(toolSpans).toHaveLength(1);
  });

  it('redacts content-tool payloads and local paths from tool observations', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'user-1',
              role: 'user',
              content: 'Use this private reference.',
              attachments: [{ path: 'uploads/private-brand-reference.txt', name: 'private-brand-reference.txt', size: 247 }],
            },
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Done.',
              producedFiles: [],
            },
          ],
        }),
        dataDir,
        run: makeRun({
          events: [
            {
              id: 1,
              event: 'agent',
              data: {
                type: 'tool_use',
                id: 'read-1',
                name: 'Read',
                input: { file_path: '/Users/alice/project/private-brand-reference.txt' },
              },
            },
            {
              id: 2,
              event: 'agent',
              data: {
                type: 'tool_result',
                toolUseId: 'read-1',
                content: 'Private brand reference: do not upload raw content',
                isError: false,
              },
            },
            {
              id: 3,
              event: 'agent',
              data: {
                type: 'tool_use',
                id: 'write-1',
                name: 'Write',
                input: { file_path: '/Users/alice/project/index.html', content: '<!doctype html><html>heavy</html>' },
              },
            },
            {
              id: 4,
              event: 'agent',
              data: {
                type: 'tool_result',
                toolUseId: 'write-1',
                content: 'File created successfully at: /Users/alice/project/index.html',
                isError: false,
              },
            },
          ],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const read = bodyOf(batch, 'span-create', 'tool:Read');
    const write = bodyOf(batch, 'span-create', 'tool:Write');
    expect(read.input).toBe('[REDACTED:tool_input:content_tool:Read]');
    expect(read.output).toBe('[REDACTED:tool_output:content_tool:Read]');
    expect(write.input).toBe('[REDACTED:tool_input:content_tool:Write]');
    expect(write.output).toBe('[REDACTED:tool_output:content_tool:Write]');
    const payload = JSON.stringify(batch);
    expect(payload).not.toContain('Private brand reference');
    expect(payload).not.toContain('/Users/alice/project');
    expect(payload).not.toContain('<!doctype html>');
  });

  it('forwards run prompt telemetry into trace and generation metadata', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const promptTelemetry = buildPromptStackTelemetry({
      composedPrompt:
        '# Instructions\n\nUse /Users/alice/project\n\n---\n# User request\n\ndesign a coffee landing page',
      sections: [
        { kind: 'daemonSystemPrompt', content: 'Use /Users/alice/project' },
        { kind: 'userRequest', content: 'design a coffee landing page' },
      ],
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [{ id: 'msg-1', role: 'assistant', content: 'Here is a draft …' }],
        }),
        dataDir,
        run: makeRun({ promptTelemetry } as any) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const generation = bodyOf(batch, 'generation-create', 'llm');
    expect(trace.input).toBe('design a coffee landing page');
    expect(generation.input).toMatchObject({
      type: 'open-design.prompt-stack',
      sections: [
        expect.objectContaining({
          kind: 'daemonSystemPrompt',
          redactedContent: expect.stringContaining('[REDACTED:path]'),
        }),
        expect.objectContaining({
          kind: 'userRequest',
          redactedContent: 'design a coffee landing page',
        }),
      ],
    });
    expect(trace.metadata.promptStack).toBeUndefined();
    expect(generation.metadata.promptStack).toBeUndefined();
    expect(trace.metadata.promptStack_sectionCount).toBe(2);
    expect(generation.metadata.promptStack_sectionCount).toBe(2);
    expect(trace.metadata.promptStack_promptFingerprint).toEqual(
      generation.metadata.promptStack_promptFingerprint,
    );
  });

  it('attaches turn-level config (model / reasoning / skill / DS) to trace + generation', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun({
          model: 'claude-sonnet-4-5',
          reasoning: 'high',
          skillId: 'landing-page',
          designSystemId: 'mission-control',
          designSystemDigest: 'digest-abc',
          designSystemSelectionSource: 'project',
          promptCache: {
            stablePromptHash: 'stable-hash-1',
            hit: true,
            missReason: null,
          },
          clientType: 'desktop',
        }) as any,
        appVersion: {
          version: '0.5.0',
          channel: 'beta',
          packaged: true,
          platform: 'darwin',
          arch: 'arm64',
        },
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const generation = bodyOf(batch, 'generation-create', 'llm');

    // Turn-level: trace metadata + tags carry it for filtering / grouping.
    expect(trace.metadata.model).toBe('claude-sonnet-4-5');
    expect(trace.metadata.reasoning).toBe('high');
    expect(trace.metadata.skillId).toBe('landing-page');
    expect(trace.metadata.designSystemId).toBe('mission-control');
    expect(trace.metadata.designSystemDigest).toBe('digest-abc');
    expect(trace.metadata.designSystemSelectionSource).toBe('project');
    expect(trace.metadata.stablePromptHash).toBe('stable-hash-1');
    expect(trace.metadata.stablePromptCacheHit).toBe(true);
    expect(trace.metadata.stablePromptCacheMissReason).toBeNull();
    expect(trace.tags).toEqual(
      expect.arrayContaining([
        'model:claude-sonnet-4-5',
        'skill:landing-page',
        'ds:mission-control',
        'client:desktop',
      ]),
    );

    // Runtime / build info on every trace.
    expect(trace.metadata.appVersion).toBe('0.5.0');
    expect(trace.metadata.appChannel).toBe('beta');
    expect(trace.metadata.packaged).toBe(true);
    expect(trace.metadata.clientType).toBe('desktop');
    expect(typeof trace.metadata.os).toBe('string');
    expect(typeof trace.metadata.nodeVersion).toBe('string');

    // Generation: model is a first-class Langfuse field (not just metadata),
    // and reasoning lands on modelParameters where Langfuse expects it.
    expect(generation.model).toBe('claude-sonnet-4-5');
    expect(generation.modelParameters).toEqual({ reasoning: 'high' });
  });

  it('labels turn.model with the agent-reported model on default-model runs', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-2',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      const run = makeRun({
        // Request did not pin a model (the `default` placeholder), so the
        // resolved model must come from the agent's reported status event —
        // matching the agent-reported fallback server.ts uses for PostHog.
        model: 'default',
      }) as any;
      run.events.unshift({
        id: 0,
        event: 'agent',
        timestamp: run.createdAt + 10,
        data: { type: 'status', label: 'model', model: 'claude-opus-4-1' },
      });
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const generation = bodyOf(batch, 'generation-create', 'llm');

    expect(trace.metadata.model).toBe('claude-opus-4-1');
    expect(trace.tags).toEqual(
      expect.arrayContaining(['model:claude-opus-4-1']),
    );
    expect(generation.model).toBe('claude-opus-4-1');
  });

  it('forwards token usage for a totalTokens-only usage event', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-3',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      const run = makeRun() as any;
      // A provider that only reports an aggregate total — no input/output
      // breakdown. scanRunEventsForUsageAnalytics still surfaces total_tokens,
      // and the bridge must carry it through to Langfuse so the per-trace UI
      // does not lose token visibility and stays consistent with PostHog.
      run.events = [
        {
          id: 1,
          event: 'agent',
          timestamp: run.createdAt + 1000,
          data: { type: 'usage', usage: { total_tokens: 512 } },
        },
      ];
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const generation = bodyOf(batch, 'generation-create', 'llm');
    // total_tokens must reach the trace metadata even with no input/output.
    expect(trace.metadata.tokens).toBeTruthy();
    expect(trace.metadata.tokens.total).toBe(512);
    expect(trace.metadata.tokens.input).toBeUndefined();
    expect(trace.metadata.tokens.output).toBeUndefined();
    // …and onto the Langfuse generation usage so cost/token views populate.
    expect(generation.usage.total).toBe(512);
  });

  it('uses the default model bucket for a default-model run with no status/model event', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-4',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      // Request never pinned a concrete model (the `default` placeholder) and
      // the agent never reported one. Keep this aligned with PostHog's
      // model_id bucket so Langfuse traces remain filterable by model state.
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun({ model: 'default' }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const generation = bodyOf(batch, 'generation-create', 'llm');
    expect(trace.metadata.model).toBe('default');
    expect(trace.tags).toEqual(expect.arrayContaining(['model:default']));
    expect(generation.model).toBe('default');
  });

  it('includes artifacts when content telemetry is on', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const messages: FakeMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'sensitive output',
        producedFiles: [{ name: 'secret.html', kind: 'html', size: 1 }],
      },
    ];
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': messages }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const trace = JSON.parse(init.body as string).batch[0].body;
    expect(trace.input).toBe('design a coffee landing page');
    expect(trace.output).toBe('sensitive output');
    expect(trace.metadata.artifacts).toEqual([
      { slug: 'secret.html', type: 'html', sizeBytes: 1 },
    ]);
    // tokens + eventsSummary are still in metadata since they're metrics
    expect(trace.metadata.tokens).toEqual({
      input: 100,
      inputProvider: 100,
      inputEffective: 100,
      output: 200,
      total: 300,
      estimatedContext: 93,
      cacheTokenSource: 'unavailable',
    });
  });

  it('reports only the current user turn captured on the run', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({
          'conv-1': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'latest answer',
            },
          ],
        }),
        dataDir,
        run: makeRun({ userPrompt: 'post-consent revision' }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const payload = init.body as string;
    const batch = JSON.parse(payload).batch as any[];
    expect(batch[0].body.input).toBe('post-consent revision');
    expect(bodyOf(batch, 'span-create', 'agent-run').input).toBe(
      'post-consent revision',
    );
    expect(payload).not.toContain('pre-consent brief');
  });

  it('passes status=failed and a clipped error message through', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun({
          status: 'failed',
          events: [
            {
              id: 1,
              event: 'error',
              data: { error: { message: 'agent stream blew up' } },
            },
          ],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    expect(batch[0].body.metadata.status).toBe('failed');
    expect(batch[0].body.metadata.success).toBe(false);
    expect(batch[0].body.metadata.error).toBe('agent stream blew up');
    expect(bodyOf(batch, 'span-create', 'agent-run').level).toBe('ERROR');
    expect(bodyOf(batch, 'generation-create', 'llm').level).toBe('ERROR');
    expect(bodyOf(batch, 'generation-create', 'llm').statusMessage).toBe(
      'agent stream blew up',
    );
    expect(bodyOf(batch, 'event-create', 'run-error').statusMessage).toBe(
      'agent stream blew up',
    );
  });

  it('adds redacted stderr tail metadata for failed runs', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    const rawKey = `sk-${'a'.repeat(48)}`;
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun({
          status: 'failed',
          events: [
            { id: 1, event: 'stderr', data: { chunk: `provider 429 OPENAI_API_KEY=${rawKey}\n` } },
            { id: 2, event: 'error', data: { error: { message: 'provider failed' } } },
          ],
        }) as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const payload = init.body as string;
    const batch = JSON.parse(payload).batch as any[];
    expect(batch[0].body.metadata.stderr).toEqual({
      tail: 'provider 429 OPENAI_API_KEY=[REDACTED:sk_key]',
      lineCount: 1,
      truncated: false,
    });
    expect(payload).not.toContain(rawKey);
  });

  it('survives a missing assistant message (web has not PUT yet)', async () => {
    await writeAppCfg({
      installationId: 'install-1',
      telemetry: { metrics: true, content: true },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: makeRun() as any,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const trace = JSON.parse(init.body as string).batch[0].body;
    expect(trace.input).toBe('design a coffee landing page');
    // truncate() drops empty strings, so output is omitted entirely.
    expect(trace.output).toBeUndefined();
  });

  it('uses the persisted terminal status when the in-memory run has not settled yet', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true, artifactManifest: false },
    });
    const run = makeRun({
      status: 'cancelRequested',
      updatedAt: 1_700_000_009_000,
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 207 }));
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    try {
      await reportRunCompletedFromDaemon({
        db: makeDbWithListMessages({ 'conv-1': [] }),
        dataDir,
        run: run as any,
        persistedRunStatus: 'canceled',
        persistedEndedAt: run.createdAt + 2500,
        fetchImpl: fetchSpy as any,
      });
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const batch = JSON.parse(init.body as string).batch as any[];
    const trace = batch[0].body;
    const span = bodyOf(batch, 'span-create', 'agent-run');
    expect(trace.metadata.status).toBe('canceled');
    expect(trace.metadata.eventsSummary.durationMs).toBe(2500);
    expect(span.metadata.status).toBe('canceled');
    expect(span.endTime).toBe(new Date(run.createdAt + 2500).toISOString());
  });
});

describe('langfuse-bridge.reportRunFeedbackFromDaemon', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-bridge-feedback-'));
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    setLiveTelemetryPrefsReaderForTests(() => ({
      metrics: true,
      content: true,
    }));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    resetAcceptedFinalTraceBodyIdsForTests();
    resetPendingRunFeedbackForTests();
    delete process.env.VELA_CONTROL_KEY;
    delete process.env.VELA_API_URL;
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.OPEN_DESIGN_VELA_TELEMETRY;
  });

  async function writeAppCfg(cfg: Record<string, unknown>) {
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify(cfg));
  }

  it('returns skipped_no_sink when Vela is configured but installationId is missing and no anonymous sink exists', async () => {
    await writeAppCfg({
      // Missing / null installationId is legitimate; Vela cannot ship without it.
      installationId: null,
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    // No OPEN_DESIGN_TELEMETRY_RELAY_URL / LANGFUSE_* → anonymous fallback absent.
    const fetchSpy = vi.fn();
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-feedback-1',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'skipped_no_sink' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns accepted when Vela has installationId', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-feedback-1',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    // Fire-and-forget send may race the assertion; give the microtask a tick.
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it('returns accepted for Vela without installationId when anonymous fallback is configured', async () => {
    await writeAppCfg({
      installationId: null,
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-feedback-1',
      rating: 'negative',
      reasonCodes: ['matched_request'],
      hasCustomReason: false,
      customReason: '',
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it('returns skipped_no_sink for Vela-accepted anchors when only anonymous relay remains', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    // Logged out of Vela; only the anonymous relay is available.
    delete process.env.VELA_CONTROL_KEY;
    delete process.env.VELA_API_URL;
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-vela-anchor',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: 'vela',
              acceptedVelaIdentity: velaSinkIdentityFingerprint('prod', 'ck_old'),
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-vela-anchor',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'skipped_no_sink' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns skipped_no_sink when the live Vela account differs from the accepting one', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_switched_account';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    const fetchSpy = vi.fn();
    const acceptingIdentity = velaSinkIdentityFingerprint('prod', 'ck_accepted');
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-vela-account',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: 'vela',
              acceptedVelaIdentity: acceptingIdentity,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-vela-account',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'skipped_no_sink' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns skipped_no_sink when relay-accepted feedback has no relay endpoint left', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    // Only Vela remains — sticky relay cannot fall forward onto Vela.
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
    const fetchSpy = vi.fn();
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-relay-anchor',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: 'relay',
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-relay-anchor',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'skipped_no_sink' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ships relay-accepted feedback through relay when Vela is also configured', async () => {
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-relay-sticky',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: 'relay',
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-relay-sticky',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      'https://telemetry.open-design.ai/api/langfuse',
    );
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(
      '/api/v1/open-design/telemetry',
    );
  });

  it('keeps legacy null-channel accepted anchors on anonymous relay when Vela is configured', async () => {
    // Pre-migration rows: finalized/accepted body with no delivery_channel.
    // Later Vela login must not re-route feedback onto a different namespace.
    // Only relay is configured among anonymous backends → unambiguous.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 207 }));
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-legacy-null-channel',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-legacy-null-channel',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      'https://telemetry.open-design.ai/api/langfuse',
    );
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(
      '/api/v1/open-design/telemetry',
    );
  });

  it('keeps legacy null-channel accepted anchors on direct Langfuse when only Langfuse is configured', async () => {
    // Mirror of the relay-only legacy case: null channel + only direct
    // Langfuse among anonymous backends must not fall forward onto Vela.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    process.env.LANGFUSE_BASE_URL = 'https://langfuse.example';
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-legacy-null-langfuse',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    try {
      const outcome = await reportRunFeedbackFromDaemon({
        dataDir,
        runId: 'run-legacy-null-langfuse',
        rating: 'positive',
        reasonCodes: [],
        hasCustomReason: false,
        customReason: '',
        db,
        fetchImpl: fetchSpy as any,
      });
      expect(outcome).toEqual({ status: 'accepted' });
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        'https://langfuse.example/api/public/ingestion',
      );
      expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(
        '/api/v1/open-design/telemetry',
      );
    } finally {
      delete process.env.LANGFUSE_BASE_URL;
    }
  });

  it('skips legacy null-channel feedback when both relay and direct Langfuse are viable', async () => {
    // Ambiguous migration path: original accept channel unknown; do not
    // relay-first and detach scores from a direct-Langfuse accepted trace.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL =
      'https://telemetry.open-design.ai/api/langfuse';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    const fetchSpy = vi.fn();
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: 'run-legacy-ambiguous',
              acceptedReportTrigger: 'final_message',
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId: 'run-legacy-ambiguous',
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'skipped_no_sink' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queues feedback during live finalization race on Vela-only (finalized, no accepted anchor yet)', async () => {
    // createFinalizedMessageTelemetryReporter marks telemetryFinalized before
    // reportRunCompleted persists an accepted body/channel. Immediate thumbs
    // on a just-finished successful final_message must not take the legacy
    // anonymous path (Vela-only → skipped_no_sink) or ship on a guessed sink.
    // markRunAwaitingFinalAcceptance is what distinguishes this live race from
    // cold finalized/no-anchor rows that must not queue forever.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_test_key';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    // Vela-only: no relay / direct Langfuse.
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    const runId = 'run-live-finalization-race';
    markRunAwaitingFinalAcceptance(runId);
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now(),
              acceptedTraceBodyId: null,
              acceptedReportTrigger: null,
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId,
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    // Enqueued for later flush — not skipped_no_sink from a false legacy path.
    expect(outcome).toEqual({ status: 'accepted' });
    // Still waiting on rememberAcceptedFinalTraceBodyId; nothing shipped yet.
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).not.toHaveBeenCalled();

    // final_message acceptance records the Vela body/channel and flushes.
    rememberAcceptedFinalTraceBodyId(runId, runId, 'final_message', 'vela');
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(
      '/api/v1/open-design/telemetry',
    );
  });

  it('ships cold finalized/no-anchor feedback on the canonical body (no indefinite defer)', async () => {
    // Pre-migration or never-accepted rows: telemetry_finalized_at set, no
    // accepted body/channel, and no in-flight markRunAwaitingFinalAcceptance.
    // Must not sit in pendingRunFeedbackByRunId until process exit.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );
    const runId = 'run-cold-finalized-no-anchor';
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'succeeded',
              telemetryFinalizedAt: Date.now() - 60_000,
              acceptedTraceBodyId: null,
              acceptedReportTrigger: null,
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId,
      rating: 'positive',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body.batch[0].body.traceId).toBe(runId);
  });

  it('ships cold failed/no-anchor feedback on the canonical body (no indefinite defer)', async () => {
    // Daemon restart / fallback already cleared: failed run, no accepted body,
    // no markRunAwaitingFinalAcceptance. Status alone must not queue forever.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );
    const runId = 'run-cold-failed-no-anchor';
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('telemetry_accepted_body_id') ||
          sql.includes('run_telemetry_accepted_anchors')
        ) {
          return {
            get: () => ({
              runStatus: 'failed',
              telemetryFinalizedAt: null,
              acceptedTraceBodyId: null,
              acceptedReportTrigger: null,
              acceptedDeliveryChannel: null,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    const outcome = await reportRunFeedbackFromDaemon({
      dataDir,
      runId,
      rating: 'negative',
      reasonCodes: [],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(outcome).toEqual({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string);
    expect(body.batch[0].body.traceId).toBe(runId);
  });

  it('replays the latest mid-window re-rating onto final_message after terminal_fallback', async () => {
    // terminal_fallback accepted → bridge pins :tf → user flips rating →
    // final_message wins. Canonical replay must use the edited rating, not a
    // stale pre-fallback / first-tf payload.
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    const runId = 'run-bridge-tf-rerate';
    const fallbackBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
      );
    const langfuseConfig = {
      kind: 'langfuse' as const,
      authHeader: 'Basic dGVzdA==',
      baseUrl: 'https://langfuse.example',
      timeoutMs: 5_000,
      retries: 0,
    };

    // Seed process-local + DB-shaped anchor the way terminal_fallback acceptance does.
    rememberAcceptedFinalTraceBodyId(runId, fallbackBodyId, 'terminal_fallback', 'langfuse');
    const db = {
      prepare: (sql: string) => {
        if (sql.includes('telemetry_accepted_body_id')) {
          return {
            get: () => ({
              runStatus: 'failed',
              telemetryFinalizedAt: null,
              acceptedTraceBodyId: fallbackBodyId,
              acceptedReportTrigger: 'terminal_fallback',
              acceptedDeliveryChannel: 'langfuse',
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };

    try {
      const first = await reportRunFeedbackFromDaemon({
        dataDir,
        runId,
        rating: 'positive',
        reasonCodes: [],
        hasCustomReason: false,
        customReason: '',
        db,
        fetchImpl: fetchSpy as any,
      });
      expect(first).toEqual({ status: 'accepted' });
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      const firstScore = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(firstScore.batch[0].body.traceId).toBe(fallbackBodyId);
      expect(firstScore.batch[0].body.value).toBe(1);

      // User flips rating while only :tf is accepted.
      const second = await reportRunFeedbackFromDaemon({
        dataDir,
        runId,
        rating: 'negative',
        reasonCodes: ['matched_request'],
        hasCustomReason: false,
        customReason: '',
        db,
        fetchImpl: fetchSpy as any,
      });
      expect(second).toEqual({ status: 'accepted' });
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
      const secondScore = JSON.parse(
        (fetchSpy.mock.calls[1]![1] as RequestInit).body as string,
      );
      expect(secondScore.batch[0].body.traceId).toBe(fallbackBodyId);
      expect(secondScore.batch[0].body.value).toBe(-1);

      // Later final_message wins the anchor; deferred queue must re-attach the
      // latest (negative) score onto the canonical body.
      const finalCompleted = await reportRunCompleted(
        {
          installationId: 'install-uuid-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          agentId: 'claude',
          run: {
            runId,
            status: 'failed',
            startedAt: 1_700_000_000_000,
            endedAt: 1_700_000_002_000,
          },
          message: {
            messageId: 'assistant-1',
            prompt: 'prompt',
            output: 'partial',
          },
          artifacts: [],
          tools: [],
          agentEvents: [],
          eventsSummary: { toolCalls: 0, errors: 0, durationMs: 2000 },
          prefs: { metrics: true, content: true, artifactManifest: false },
        },
        {
          config: langfuseConfig,
          fetchImpl: fetchSpy as any,
          reportTrigger: 'final_message',
        },
      );
      expect(finalCompleted.langfuse_delivery_status).toBe('accepted');
      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
      });
      const finalScoreBody = JSON.parse(
        (fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]![1] as RequestInit)
          .body as string,
      );
      expect(finalScoreBody.batch[0].type).toBe('score-create');
      expect(finalScoreBody.batch[0].body.traceId).toBe(runId);
      expect(finalScoreBody.batch[0].body.value).toBe(-1);
      expect(finalScoreBody.batch[0].body.comment).toBe('negative');
    } finally {
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    }
  });

  it('queues a re-rate after Vela profile switch during late-final without skipping', async () => {
    // terminal_fallback accepted on Vela identity A. User switches AMR profile
    // (live key B) and re-rates: sticky canDeliver fails, but the deferred
    // queue must still refresh so final_message under B can replay the latest
    // score instead of a stale queued rating (or none).
    await writeAppCfg({
      installationId: 'install-uuid-1',
      telemetry: { metrics: true, content: true },
    });
    process.env.VELA_CONTROL_KEY = 'ck_new_profile';
    process.env.VELA_API_URL = 'https://amr-api.example.com';
    const runId = 'run-bridge-vela-switch-rerate';
    const oldIdentity = velaSinkIdentityFingerprint('prod', 'ck_old_profile');
    const newIdentity = velaSinkIdentityFingerprint('prod', 'ck_new_profile');
    const fallbackBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 202 }));

    // Process-local + DB-shaped sticky anchor under the old Vela identity.
    rememberAcceptedFinalTraceBodyId(
      runId,
      fallbackBodyId,
      'terminal_fallback',
      'vela',
      oldIdentity,
    );
    const db = {
      prepare: (sql: string) => {
        if (
          sql.includes('run_telemetry_accepted_anchors') ||
          sql.includes('telemetry_accepted_body_id')
        ) {
          return {
            get: () => ({
              runStatus: 'failed',
              telemetryFinalizedAt: null,
              acceptedTraceBodyId: fallbackBodyId,
              acceptedReportTrigger: 'terminal_fallback',
              acceptedDeliveryChannel: 'vela',
              acceptedVelaIdentity: oldIdentity,
            }),
          };
        }
        return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
      },
    };

    const rerate = await reportRunFeedbackFromDaemon({
      dataDir,
      runId,
      rating: 'negative',
      reasonCodes: ['matched_request'],
      hasCustomReason: false,
      customReason: '',
      db,
      fetchImpl: fetchSpy as any,
    });
    expect(rerate).toEqual({ status: 'accepted' });
    // Sticky old identity cannot deliver; immediate send suppressed.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(hasPendingRunFeedbackForTests(runId)).toBe(true);

    // final_message under the new Vela identity replays the re-rated score.
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
    const envelope = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    );
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
    const auth = String(
      (fetchSpy.mock.calls[0]![1] as { headers?: Record<string, string> }).headers
        ?.Authorization ?? '',
    );
    expect(auth).toBe('Bearer ck_new_profile');
  });
});

// listMessages reads from a `prepare(...).all(cid)` call against
// better-sqlite3. To avoid spinning up SQLite in unit tests we provide a
// stub that satisfies the same shape used in `apps/daemon/src/db.ts`.
function makeDbWithListMessages(messagesByConvo: Record<string, FakeMessage[]>) {
  // Mirror db.ts: SELECT returns *Json columns and listMessages runs them
  // through normalizeMessage which JSON.parses producedFilesJson into
  // producedFiles. Tests pass producedFiles directly, so we round-trip
  // through JSON.stringify to match the real-world shape.
  return {
    prepare(_sql: string) {
      return {
        all(cid: string) {
          return (messagesByConvo[cid] ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            agentId: null,
            agentName: null,
            runId: m.runId ?? null,
            runStatus: null,
            lastRunEventId: null,
            eventsJson: null,
            attachmentsJson: m.attachments
              ? JSON.stringify(m.attachments)
              : null,
            commentAttachmentsJson: null,
            producedFilesJson: m.producedFiles
              ? JSON.stringify(m.producedFiles)
              : null,
            traceObjectFilesJson: m.traceObjectFiles
              ? JSON.stringify(m.traceObjectFiles)
              : null,
            createdAt: 0,
            startedAt: null,
            endedAt: null,
            position: 0,
          }));
        },
        // Accepted-telemetry-anchor writes use prepare().get/.run after a
        // successful final delivery. These unit tests use a stub DB; return
        // empty so setRunTelemetryAcceptedAnchor no-ops without throwing.
        get() {
          return undefined;
        },
        run() {
          return { changes: 0 };
        },
      };
    },
  };
}
