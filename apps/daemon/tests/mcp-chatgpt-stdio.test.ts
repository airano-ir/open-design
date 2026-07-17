import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type JsonRpcResponse = {
  id?: number;
  result?: Record<string, unknown>;
};

function runChatGptStdioProbe(): Promise<{ code: number | null; stderr: string; responses: JsonRpcResponse[] }> {
  return new Promise((resolve, reject) => {
    const repositoryRoot = join(import.meta.dirname, '../../..');
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        join(import.meta.dirname, '../src/cli.ts'),
        'mcp',
        'chatgpt',
        '--daemon-url',
        'http://127.0.0.1:1',
      ],
      { cwd: repositoryRoot, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const responses = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonRpcResponse);
      resolve({ code, stderr, responses });
    });

    for (const message of [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'open-design-test', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'collect_brief',
          arguments: { artifactType: 'website', title: 'Local Custom UI smoke test' },
        },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'ui://open-design/artifact-card-v7.html' },
      },
    ]) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    child.stdin.end();
  });
}

describe('ChatGPT stdio MCP surface', () => {
  it('registers the Cloud V1 tools and serves the brief Custom UI without a running daemon', async () => {
    const { code, stderr, responses } = await runChatGptStdioProbe();
    expect(code, stderr).toBe(0);

    const tools = responses.find((response) => response.id === 2)?.result?.tools as Array<{
      name: string;
      _meta?: Record<string, unknown>;
    }>;
    expect(tools.map((tool) => tool.name)).toEqual([
      'create_project',
      'collect_brief',
      'get_cloud_account',
      'start_run',
      'get_run',
      'list_versions',
      'restore_version',
      'export_project',
      'cancel_run',
    ]);
    expect(tools.find((tool) => tool.name === 'collect_brief')?._meta).toMatchObject({
      'ui/resourceUri': 'ui://open-design/artifact-card-v7.html',
    });

    const brief = responses.find((response) => response.id === 3)?.result as {
      structuredContent?: Record<string, unknown>;
    };
    expect(brief.structuredContent).toMatchObject({
      view: 'brief-form',
      artifactType: 'website',
      title: 'Local Custom UI smoke test',
    });

    const resource = responses.find((response) => response.id === 4)?.result as {
      contents?: Array<{ mimeType?: string; text?: string }>;
    };
    expect(resource.contents?.[0]?.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.contents?.[0]?.text).toContain('id="brief-form"');
    expect(resource.contents?.[0]?.text).toContain('Choose a direction');
    expect(resource.contents?.[0]?.text).toContain('id="brief-goal-options"');
    expect(resource.contents?.[0]?.text).not.toContain('<textarea');
  }, 20_000);
});
