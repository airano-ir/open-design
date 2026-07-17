#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
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

const EXPECTED_ARTIFACT_TYPES = [
  'website',
  'product-prototype',
  'presentation',
  'design-system',
  'image',
  'video',
  'audio',
  'document',
] as const;

const EXPECTED_SKILLS = [
  { name: 'open-design-basics', artifactType: null },
  { name: 'create-website-with-open-design', artifactType: 'website' },
  { name: 'create-prototype-with-open-design', artifactType: 'product-prototype' },
  { name: 'create-presentation-with-open-design', artifactType: 'presentation' },
  { name: 'create-design-system-with-open-design', artifactType: 'design-system' },
  { name: 'create-image-with-open-design', artifactType: 'image' },
  { name: 'create-video-with-open-design', artifactType: 'video' },
  { name: 'create-audio-with-open-design', artifactType: 'audio' },
  { name: 'create-document-with-open-design', artifactType: 'document' },
] as const;

const WIDGET_URI = 'ui://open-design/artifact-card-v9.html';
const LEGACY_WIDGET_URIS = [
  'ui://open-design/artifact-card-v2.html',
  'ui://open-design/artifact-card-v3.html',
  'ui://open-design/artifact-card-v4.html',
  'ui://open-design/artifact-card-v5.html',
  'ui://open-design/artifact-card-v6.html',
  'ui://open-design/artifact-card-v7.html',
  'ui://open-design/artifact-card-v8.html',
] as const;

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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toolInputSchema(tool: Record<string, unknown> | undefined): Record<string, unknown> {
  return (tool?.inputSchema as Record<string, unknown> | undefined) ?? {};
}

function toolArtifactTypes(tool: Record<string, unknown> | undefined): unknown {
  const properties = toolInputSchema(tool).properties as Record<string, unknown> | undefined;
  return (properties?.artifactType as Record<string, unknown> | undefined)?.enum;
}

function toolRequiredFields(tool: Record<string, unknown> | undefined): string[] {
  const required = toolInputSchema(tool).required;
  return Array.isArray(required) ? required.map(String) : [];
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
  const keywords = manifest.keywords as unknown[] | undefined;
  assert(Array.isArray(keywords), 'plugin keywords are required');
  for (const artifactType of EXPECTED_ARTIFACT_TYPES) {
    assert(keywords.includes(artifactType), `plugin keywords must include ${artifactType}`);
  }

  const skillsRoot = resolve(pluginRoot, 'skills');
  const installedSkillNames: string[] = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && await exists(resolve(skillsRoot, entry.name, 'SKILL.md'))) {
      installedSkillNames.push(entry.name);
    }
  }
  installedSkillNames.sort();
  const expectedSkillNames = EXPECTED_SKILLS.map((skill) => skill.name).sort();
  assert(
    JSON.stringify(installedSkillNames) === JSON.stringify(expectedSkillNames),
    `plugin skills must be exactly Basics + eight artifact skills; found: ${installedSkillNames.join(', ')}`,
  );
  assert(!installedSkillNames.includes('create-with-open-design'), 'legacy create-with-open-design skill must not be present');

  for (const expectedSkill of EXPECTED_SKILLS) {
    const skillRoot = resolve(skillsRoot, expectedSkill.name);
    const skill = await readFile(resolve(skillRoot, 'SKILL.md'), 'utf8');
    assert(skill.includes(`name: ${expectedSkill.name}`), `${expectedSkill.name} frontmatter name is invalid`);
    await access(resolve(skillRoot, 'agents/openai.yaml'));
    if (expectedSkill.artifactType) {
      assert(skill.includes('Apply `$open-design-basics`'), `${expectedSkill.name} must apply the shared Basics skill`);
      assert(
        skill.includes(`Use \`artifactType: ${expectedSkill.artifactType}\``),
        `${expectedSkill.name} must pin artifactType: ${expectedSkill.artifactType}`,
      );
      assert(/selectable|choice-only/iu.test(skill), `${expectedSkill.name} must keep its brief choice-only`);
    } else {
      assert(skill.includes('If the tools are missing, stop.'), 'Basics must fail closed when its MCP is unavailable');
      assert(skill.includes('fully quit and relaunch Codex'), 'Basics must require a full Codex relaunch after a stale install');
      assert(skill.includes('Never fall back to prose questions'), 'Basics must forbid fallback text forms');
      assert(skill.includes('Keep every user-facing field choice-only'), 'Basics must define the brief as choice-only');
      assert(skill.includes('Never request typed project names'), 'Basics must forbid typed brief questions');
      assert(skill.includes('preselected **From your brief** choice'), 'Basics must preserve supplied prose as a selectable option');
      assert(skill.includes('create_project` with a concise human-readable name and the selected `artifactType`'), 'Basics must require artifactType when creating projects');
    }
  }

  assert(!(await exists(resolve(skillsRoot, 'create-with-open-design/SKILL.md'))), 'legacy create-with-open-design skill must not exist');
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
    assert(!(await exists(resolve(pluginRoot, forbidden))), `${forbidden} must not be present in the V1 package`);
  }

  process.stdout.write(`package ok: open-design@${String(manifest.version)} (9 skills · 8 artifact types · hosted ChatGPT app + bundled Codex MCP)\n`);
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
  const createProject = tools.find((tool) => tool.name === 'create_project');
  const collectBriefMeta = collectBrief?._meta as Record<string, unknown> | undefined;
  const collectBriefSecuritySchemes = collectBriefMeta?.securitySchemes as Array<Record<string, unknown>> | undefined;
  assert(collectBriefSecuritySchemes?.[0]?.type === 'noauth', 'collect_brief must be directly callable without OAuth');
  const startRunMeta = startRun?._meta as Record<string, unknown> | undefined;
  assert(startRunMeta?.['openai/outputTemplate'] === WIDGET_URI, 'start_run is not connected to the Artifact card');
  assert(startRunMeta?.['ui/resourceUri'] === WIDGET_URI, 'start_run is missing the MCP Apps compatibility resource URI');
  for (const [toolName, tool] of [
    ['collect_brief', collectBrief],
    ['create_project', createProject],
    ['start_run', startRun],
  ] as const) {
    assert(
      JSON.stringify(toolArtifactTypes(tool)) === JSON.stringify(EXPECTED_ARTIFACT_TYPES),
      `${toolName} artifact types do not match the eight-type V1 contract`,
    );
  }
  assert(toolRequiredFields(collectBrief).includes('artifactType'), 'collect_brief must require artifactType');
  assert(toolRequiredFields(createProject).includes('artifactType'), 'create_project must require artifactType');
  assert(toolRequiredFields(createProject).includes('name'), 'create_project must require name');
  assert(toolRequiredFields(startRun).includes('artifactType'), 'start_run must require artifactType');

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
  assert(widgetHtml.includes('id="brief-goal-options"'), 'Artifact card brief is missing goal choices');
  assert(widgetHtml.includes('id="brief-audience-options"'), 'Artifact card brief is missing audience choices');
  assert(widgetHtml.includes('id="brief-content-options"'), 'Artifact card brief is missing content choices');
  assert(widgetHtml.includes('id="brief-visual-options"'), 'Artifact card brief is missing visual choices');
  assert(widgetHtml.includes('id="brief-output-options"'), 'Artifact card brief is missing output choices');
  assert(widgetHtml.includes("renderBriefChoiceGroup('brief-output-options'"), 'Artifact card does not render output choices');
  assert(widgetHtml.includes("selectedBriefChoice('brief-output')"), 'Artifact card does not submit the selected output choice');
  const presetSource = widgetHtml.split('const BRIEF_CHOICE_PRESETS = {')[1]?.split('function conciseChoiceLabel')[0];
  assert(presetSource, 'Artifact card brief choice presets are missing');
  for (const artifactType of EXPECTED_ARTIFACT_TYPES) {
    const escaped = artifactType.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    assert(new RegExp(`["']?${escaped}["']?\\s*:\\s*\\{`, 'u').test(presetSource), `Artifact card is missing ${artifactType} choices`);
  }
  assert((presetSource.match(/\boutput:\s*\[/gu) ?? []).length === EXPECTED_ARTIFACT_TYPES.length, 'every artifact type must define output choices');
  assert(!/<textarea\b/iu.test(widgetHtml), 'Artifact card brief still requires a textarea');
  assert(!/<input\b[^>]*\btype\s*=\s*['"](?:text|email|url|tel|search|number|password)['"]/iu.test(widgetHtml), 'Artifact card brief still contains a text-like input');
  assert(!/\binput\.type\s*=\s*['"](?:text|email|url|tel|search|number|password)['"]/iu.test(widgetHtml), 'Artifact card brief still creates a text-like input');
  assert(!/contenteditable/iu.test(widgetHtml), 'Artifact card brief still creates an editable text surface');
  assert(!/<header\b/iu.test(widgetHtml), 'Artifact card must not duplicate the host with an internal header');
  assert(!/class=["'][^"']*\bmark\b/iu.test(widgetHtml), 'Artifact card must not render an internal OpenDesign logo');
  assert(!/id=["']subtitle["']/iu.test(widgetHtml), 'Artifact card must not render an internal subtitle');
  assert(!/<h1\b[^>]*>\s*OpenDesign\s*<\/h1>/iu.test(widgetHtml), 'Artifact card must not render an internal OpenDesign title');
  assert(!widgetHtml.includes('}, 1000);'), 'Artifact card still abandons the MCP Apps handshake after one second');
  assert(widgetHtml.includes('ui/notifications/size-changed'), 'Artifact card does not publish intrinsic size changes');

  for (const [index, legacyUri] of LEGACY_WIDGET_URIS.entries()) {
    const legacyReadResource = await rpc(endpoint, 5 + index, 'resources/read', { uri: legacyUri });
    const legacyContents = legacyReadResource.contents as Array<Record<string, unknown>> | undefined;
    const legacyWidget = legacyContents?.find((content) => content.uri === legacyUri);
    assert(legacyWidget?.text === widgetHtml, `${legacyUri} is not mapped to the latest widget`);
  }

  for (const [index, artifactType] of EXPECTED_ARTIFACT_TYPES.entries()) {
    const briefCall = await rpc(endpoint, 20 + index, 'tools/call', {
      name: 'collect_brief',
      arguments: { artifactType, title: `Local ${artifactType}`, outcome: 'Explain the requested artifact.' },
    });
    const brief = briefCall.structuredContent as Record<string, unknown> | undefined;
    assert(brief?.view === 'brief-form', `collect_brief did not return the ${artifactType} Custom UI state`);
    assert(brief.artifactType === artifactType, `collect_brief returned the wrong artifact type for ${artifactType}`);
    assert((briefCall._meta as Record<string, unknown>)?.['openai/outputTemplate'] === WIDGET_URI, `collect_brief ${artifactType} is not connected to the Artifact card`);
  }

  const accountCall = await rpc(endpoint, 40, 'tools/call', { name: 'get_cloud_account', arguments: {} });
  const account = accountCall.structuredContent as Record<string, unknown> | undefined;
  assert(account && typeof account.balanceStatus === 'string', 'Cloud account tool did not return a balance status');
  assert((accountCall._meta as Record<string, unknown>)?.['openai/outputTemplate'] === WIDGET_URI, 'Cloud account result is not connected to the Artifact card');

  process.stdout.write(`endpoint ok: ${endpoint}\n`);
  process.stdout.write(`server: ${String(serverInfo.version ?? 'unknown')} · tools: ${names.join(', ')} · artifacts: ${EXPECTED_ARTIFACT_TYPES.join(', ')} · UI: ${WIDGET_URI}\n`);
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
