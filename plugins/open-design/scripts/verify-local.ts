#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_TOOLS = [
  'cancel_run',
  'collect_brief',
  'create_project',
  'export_project',
  'get_cloud_account',
  'get_run',
  'list_versions',
  'restore_version',
  'start_run',
] as const;

const WIDGET_URI = 'ui://open-design/artifact-card-v6.html';

interface JsonRpcResponse {
  error?: { message?: string };
  result?: Record<string, unknown>;
}

function parseArgs(argv: string[]): { endpoint: string | null } {
  let endpoint: string | null = 'http://127.0.0.1:17456/mcp';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--package-only') endpoint = null;
    else if (argument === '--endpoint') {
      const value = argv[index + 1];
      if (!value) throw new Error('--endpoint requires a URL');
      endpoint = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write([
        'Usage: pnpm exec tsx plugins/open-design/scripts/verify-local.ts [options]',
        '',
        'Options:',
        '  --endpoint <url>  MCP endpoint (default: http://127.0.0.1:17456/mcp)',
        '  --package-only    Validate the official plugin package without contacting MCP',
        '',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { endpoint };
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseMcpBody(text: string, contentType: string): JsonRpcResponse {
  if (contentType.includes('application/json')) return JSON.parse(text) as JsonRpcResponse;
  const messages = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
  const response = messages.find((message) => message.result || message.error);
  if (!response) throw new Error('MCP response did not contain a JSON-RPC result');
  return response;
}

async function rpc(endpoint: string, id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const body = parseMcpBody(await response.text(), response.headers.get('content-type') ?? '');
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `MCP request failed with HTTP ${response.status}`);
  }
  assert(body.result, `MCP ${method} response is missing a result`);
  return body.result;
}

async function validatePackage(pluginRoot: string): Promise<void> {
  const repoRoot = resolve(pluginRoot, '../..');
  const manifest = await json(resolve(pluginRoot, '.codex-plugin/plugin.json'));
  const appManifest = await json(resolve(pluginRoot, '.app.json'));
  const marketplace = await json(resolve(repoRoot, '.agents/plugins/marketplace.json'));
  const plugins = marketplace.plugins as Array<Record<string, unknown>> | undefined;
  const entry = plugins?.find((plugin) => plugin.name === 'open-design');
  const pluginInterface = manifest.interface as Record<string, unknown> | undefined;

  assert(manifest.name === 'open-design', 'plugin name must match the open-design folder');
  assert(typeof manifest.version === 'string', 'plugin version is required');
  assert(manifest.apps === './.app.json', 'plugin must use the official app manifest path');
  assert(manifest.skills === './skills/', 'plugin must publish its skill directory');
  assert(manifest.mcpServers === './.mcp.json', 'plugin must publish its local Codex MCP config');
  assert(appManifest.apps && typeof appManifest.apps === 'object', '.app.json must contain an apps object');
  assert(entry, 'repo marketplace must contain the open-design plugin');
  assert((entry.source as Record<string, unknown>)?.path === './plugins/open-design', 'marketplace source path is invalid');
  assert((entry.policy as Record<string, unknown>)?.installation === 'AVAILABLE', 'plugin must be available');
  assert((entry.policy as Record<string, unknown>)?.authentication === 'ON_USE', 'Cloud sign-in must happen on use');
  await access(resolve(pluginRoot, 'skills/create-with-open-design/SKILL.md'));
  assert(pluginInterface?.logo === './assets/logo.svg', 'plugin list logo must use the square logo asset');
  const logoSvg = await readFile(resolve(pluginRoot, 'assets/logo.svg'), 'utf8');
  assert(/viewBox="0 0 64 64"/u.test(logoSvg), 'plugin list logo must keep a square viewBox');
  assert(!/<text\b/u.test(logoSvg), 'plugin list logo must not use the horizontal wordmark');

  const mcpManifest = await json(resolve(pluginRoot, '.mcp.json'));
  const mcpServer = (mcpManifest.mcpServers as Record<string, Record<string, unknown>> | undefined)?.['open-design'];
  assert(mcpServer?.command === 'node', 'local Codex MCP must use the bundled Node entry');
  assert(JSON.stringify(mcpServer?.args) === JSON.stringify(['./mcp/server.bundle.mjs']), 'local Codex MCP bundle path is invalid');
  assert(mcpServer?.cwd === '.', 'local Codex MCP cwd must resolve from the installed plugin root');
  await access(resolve(pluginRoot, 'mcp/server.bundle.mjs'));

  for (const forbidden of ['.claude-plugin']) {
    try {
      await access(resolve(pluginRoot, forbidden));
      throw new Error(`${forbidden} must not be present in the V1 package`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('must not be present')) throw error;
    }
  }

  process.stdout.write(`package ok: open-design@${String(manifest.version)} (hosted ChatGPT app + bundled Codex MCP)\n`);
}

async function validateEndpoint(endpoint: string): Promise<void> {
  const initialized = await rpc(endpoint, 1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'open-design-local-verifier', version: '1.0.0' },
  });
  const serverInfo = initialized.serverInfo as Record<string, unknown> | undefined;
  assert(serverInfo?.name === 'open-design', 'endpoint is not the Open Design MCP server');

  const listedTools = await rpc(endpoint, 2, 'tools/list', {});
  const tools = listedTools.tools as Array<Record<string, unknown>> | undefined;
  assert(Array.isArray(tools), 'tools/list did not return tools');
  const names = tools.map((tool) => String(tool.name)).sort();
  assert(JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()), `unexpected V1 tools: ${names.join(', ')}`);

  const startRun = tools.find((tool) => tool.name === 'start_run');
  const collectBrief = tools.find((tool) => tool.name === 'collect_brief');
  const collectBriefMeta = collectBrief?._meta as Record<string, unknown> | undefined;
  const collectBriefSecuritySchemes = collectBriefMeta?.securitySchemes as Array<Record<string, unknown>> | undefined;
  assert(collectBriefSecuritySchemes?.[0]?.type === 'noauth', 'collect_brief must be directly callable without OAuth');
  const startRunMeta = startRun?._meta as Record<string, unknown> | undefined;
  assert(startRunMeta?.['openai/outputTemplate'] === WIDGET_URI, 'start_run is not connected to the Artifact card');
  assert(startRunMeta?.['ui/resourceUri'] === WIDGET_URI, 'start_run is missing the MCP Apps compatibility resource URI');
  const artifactType = (((startRun?.inputSchema as Record<string, unknown>)?.properties as Record<string, unknown>)?.artifactType as Record<string, unknown>)?.enum;
  assert(JSON.stringify(artifactType) === JSON.stringify(['website', 'product-prototype', 'presentation', 'design-system']), 'V1 artifact types do not match the product contract');

  const listedResources = await rpc(endpoint, 3, 'resources/list', {});
  const resources = listedResources.resources as Array<Record<string, unknown>> | undefined;
  const widgetResource = resources?.find((resource) => resource.uri === WIDGET_URI);
  assert(widgetResource, 'Artifact card MCP resource is missing');
  assert(Boolean(((widgetResource._meta as Record<string, unknown>)?.ui as Record<string, unknown>)?.prefersBorder), 'Artifact card resource metadata is missing');

  const readResource = await rpc(endpoint, 4, 'resources/read', { uri: WIDGET_URI });
  const contents = readResource.contents as Array<Record<string, unknown>> | undefined;
  const widgetHtml = contents?.find((content) => content.uri === WIDGET_URI)?.text;
  assert(typeof widgetHtml === 'string' && widgetHtml.includes('window.openai'), 'Artifact card does not contain the ChatGPT bridge');
  assert(widgetHtml.includes("rpcRequest('tools/call'"), 'Artifact card cannot call follow-up MCP tools');
  assert(widgetHtml.includes("rpcRequest('ui/message'"), 'Artifact card cannot submit the Custom UI brief');
  assert(widgetHtml.includes("content: [{ type: 'text', text }]"), 'Artifact card submits an invalid ui/message content shape');
  assert(widgetHtml.includes('id="brief-form"'), 'Artifact card does not contain the Custom UI brief form');
  assert(!widgetHtml.includes('}, 1000);'), 'Artifact card still abandons the MCP Apps handshake after one second');
  assert(widgetHtml.includes('ui/notifications/size-changed'), 'Artifact card does not publish intrinsic size changes');

  for (const [index, legacyUri] of [
    'ui://open-design/artifact-card-v2.html',
    'ui://open-design/artifact-card-v3.html',
    'ui://open-design/artifact-card-v4.html',
    'ui://open-design/artifact-card-v5.html',
  ].entries()) {
    const legacyReadResource = await rpc(endpoint, 5 + index, 'resources/read', { uri: legacyUri });
    const legacyContents = legacyReadResource.contents as Array<Record<string, unknown>> | undefined;
    const legacyWidget = legacyContents?.find((content) => content.uri === legacyUri);
    assert(legacyWidget?.text === widgetHtml, `${legacyUri} is not mapped to the latest widget`);
  }

  const briefCall = await rpc(endpoint, 9, 'tools/call', {
    name: 'collect_brief',
    arguments: { artifactType: 'website', title: 'Local website', outcome: 'Explain the product.' },
  });
  const brief = briefCall.structuredContent as Record<string, unknown> | undefined;
  assert(brief?.view === 'brief-form', 'collect_brief did not return the Custom UI state');
  assert((briefCall._meta as Record<string, unknown>)?.['openai/outputTemplate'] === WIDGET_URI, 'collect_brief is not connected to the Artifact card');

  const accountCall = await rpc(endpoint, 10, 'tools/call', { name: 'get_cloud_account', arguments: {} });
  const account = accountCall.structuredContent as Record<string, unknown> | undefined;
  assert(account && typeof account.balanceStatus === 'string', 'Cloud account tool did not return a balance status');
  assert((accountCall._meta as Record<string, unknown>)?.['openai/outputTemplate'] === WIDGET_URI, 'Cloud account result is not connected to the Artifact card');

  process.stdout.write(`endpoint ok: ${endpoint}\n`);
  process.stdout.write(`server: ${String(serverInfo.version ?? 'unknown')} · tools: ${names.join(', ')} · UI: ${WIDGET_URI}\n`);
  process.stdout.write(`Cloud account: ${String(account.balanceStatus)}${account.nextAction ? ` · next: ${String(account.nextAction)}` : ''}\n`);
}

async function main(): Promise<void> {
  const { endpoint } = parseArgs(process.argv.slice(2));
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await validatePackage(pluginRoot);
  if (endpoint) await validateEndpoint(endpoint);
}

main().catch((error) => {
  process.stderr.write(`local plugin verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
