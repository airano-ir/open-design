// `od mcp` - stdio MCP server that proxies project tool calls to the
// running daemon's HTTP API. Lets a coding agent in a *different* repo
// (Claude Code, Cursor, Zed) pull files from a local Open Design
// project and create project-scoped artifacts without the
// export-zip-import dance.
//
// The server itself holds no state and never touches the filesystem;
// every tool resolves to a fetch() against `OD_DAEMON_URL`. Spawn the
// MCP server with no daemon running and tool calls return a clear
// "daemon not reachable" error - the server itself still launches so
// the client can list its tool schema.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildProjectRawFileUrl } from '@open-design/contracts';
import { randomUUID } from 'node:crypto';

import { postCreateArtifactRequest } from './artifacts/create.js';
import { classifyAmrAccountFailure } from './integrations/vela-errors.js';

const SERVER_NAME = 'open-design';
const SERVER_VERSION = '0.2.12';
const MCP_STDIO_IDLE_EXIT_MS = 30 * 60 * 1000;
// MCP Apps hosts cache widget resources by URI. Bump this whenever the
// embedded HTML/CSS/JS changes so a failed or stale sandbox is not reused.
const CHATGPT_WIDGET_URI = 'ui://open-design/artifact-card-v7.html';
// A running host can retain tool metadata across a daemon/plugin refresh and
// keep reading the previous URI. Serve the latest widget at that URI too so
// existing conversations recover without requiring a Codex restart.
const LEGACY_CHATGPT_WIDGET_URIS = new Set([
  'ui://open-design/artifact-card-v2.html',
  'ui://open-design/artifact-card-v3.html',
  'ui://open-design/artifact-card-v4.html',
  'ui://open-design/artifact-card-v5.html',
  'ui://open-design/artifact-card-v6.html',
]);

export function isChatGptWidgetResourceUri(value: unknown): value is string {
  const uri = typeof value === 'string' ? value : '';
  return uri === CHATGPT_WIDGET_URI || LEGACY_CHATGPT_WIDGET_URIS.has(uri);
}
const CHATGPT_SIGN_IN_URL = 'https://open-design.ai/amr';
const CHATGPT_RECHARGE_URL = 'https://open-design.ai/amr/wallet';
const CHATGPT_V1_TOOL_NAMES = new Set([
  'collect_brief',
  'get_cloud_account',
  'create_project',
  'start_run',
  'get_run',
  'cancel_run',
  'list_versions',
  'restore_version',
  'export_project',
]);

export function chatGptV1RequiredScopes(toolName: string): string[] {
  switch (toolName) {
    case 'get_cloud_account':
      return ['opendesign.account.read'];
    case 'create_project':
      return ['opendesign.projects.write'];
    case 'start_run':
    case 'cancel_run':
      return ['opendesign.runs.write'];
    case 'get_run':
      return ['opendesign.runs.read'];
    case 'list_versions':
      return ['opendesign.projects.read'];
    case 'restore_version':
      return ['opendesign.versions.write'];
    case 'export_project':
      return ['opendesign.exports.read'];
    default:
      return [];
  }
}

function chatGptV1OutputSchema(toolName: string): JsonObject {
  const stringValue = { type: 'string' };
  const schemas: Record<string, JsonObject> = {
    collect_brief: {
      view: { type: 'string', enum: ['brief-form'] },
      artifactType: { type: 'string', enum: ['website', 'product-prototype', 'presentation', 'design-system'] },
      title: stringValue,
      brief: { type: 'object' },
    },
    get_cloud_account: {
      loggedIn: { type: 'boolean' },
      balanceUsd: { type: ['string', 'null'] },
      balanceStatus: { type: 'string', enum: ['signed_out', 'unavailable', 'available', 'empty'] },
      canUseCloud: { type: ['boolean', 'null'] },
      nextAction: { type: 'string', enum: ['sign_in', 'retry_account', 'generate', 'recharge'] },
      rechargeUrl: stringValue,
    },
    create_project: {
      project: { type: 'object' },
      conversationId: stringValue,
      studioUrl: stringValue,
    },
    start_run: {
      id: stringValue,
      runId: stringValue,
      projectId: stringValue,
      conversationId: stringValue,
      status: stringValue,
      stage: { type: 'string', enum: ['queued', 'generating', 'ready', 'failed', 'canceled'] },
      artifactType: { type: 'string', enum: ['website', 'product-prototype', 'presentation', 'design-system'] },
      briefConfirmed: { type: 'boolean' },
      studioUrl: stringValue,
    },
    get_run: {
      id: stringValue,
      runId: stringValue,
      projectId: stringValue,
      status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] },
      stage: { type: 'string', enum: ['queued', 'generating', 'ready', 'failed', 'canceled'] },
      skillId: { type: ['string', 'null'] },
      artifactCount: { type: 'number', minimum: 0 },
      previewUrl: stringValue,
      studioUrl: stringValue,
      entryFile: stringValue,
      agentMessage: stringValue,
      error: { type: ['string', 'null'] },
      errorCode: { type: ['string', 'null'] },
      retryable: { type: 'boolean' },
    },
    cancel_run: {
      id: stringValue,
      runId: stringValue,
      status: stringValue,
    },
    list_versions: {
      projectId: stringValue,
      path: stringValue,
      versions: { type: 'array', items: { type: 'object' } },
    },
    restore_version: {
      projectId: stringValue,
      path: stringValue,
      version: { type: 'object' },
    },
    export_project: {
      ok: { type: 'boolean' },
      projectId: stringValue,
      fileName: stringValue,
      bytes: { type: 'number' },
    },
  };
  return { type: 'object', properties: schemas[toolName] ?? {}, additionalProperties: true };
}

// One small, dependency-free MCP Apps widget serves the account, progress,
// and completed-artifact states. Non-ChatGPT MCP clients ignore the UI
// metadata and continue to consume the normal text/structured tool result.
const CHATGPT_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --surface: rgba(250, 250, 250, .72);
      --surface-strong: rgba(250, 250, 250, .9);
      --text: rgba(32, 32, 32, .92);
      --text-muted: rgba(73, 73, 73, .62);
      --text-soft: rgba(73, 73, 73, .4);
      --border: rgba(73, 73, 73, .18);
      --fill: rgba(73, 73, 73, .08);
      --button: #202020;
      --button-text: #fafafa;
      --success: #168052;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --surface: rgba(53, 53, 53, .72);
        --surface-strong: rgba(53, 53, 53, .9);
        --text: rgba(250, 250, 250, .92);
        --text-muted: rgba(237, 237, 237, .62);
        --text-soft: rgba(237, 237, 237, .4);
        --border: rgba(255, 255, 255, .16);
        --fill: rgba(255, 255, 255, .07);
        --button: #fafafa;
        --button-text: #202020;
        --success: #70d6a6;
      }
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; padding: 8px; background: transparent; color: var(--text); }
    .card {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      -webkit-backdrop-filter: blur(24px) saturate(1.6);
      backdrop-filter: blur(24px) saturate(1.6);
      box-shadow: 0 1px 2px rgba(28, 27, 26, .05), 0 1px 3px rgba(28, 27, 26, .04);
      animation: card-in 200ms cubic-bezier(.23, 1, .32, 1) both;
    }
    @keyframes card-in { from { opacity: 0; transform: translateY(4px); } }
    .head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 0; }
    .mark { width: 32px; height: 32px; border-radius: 8px; overflow: hidden; background: #10110d; flex: 0 0 auto; }
    .mark svg { display: block; width: 100%; height: 100%; }
    .title { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
    .sub { margin: 2px 0 0; color: var(--text-muted); font-size: 12px; }
    .compact { display: grid; gap: 16px; padding: 22px 16px 16px; }
    .state { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
    .state-dot { width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; flex: 0 0 auto; background: var(--text-soft); }
    .state-dot[data-tone="success"] { background: var(--success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 12%, transparent); }
    .state-dot[data-tone="running"] { background: var(--text); box-shadow: 0 0 0 4px var(--fill); animation: breathe 1.4s ease-in-out infinite; }
    @keyframes breathe { 50% { opacity: .35; transform: scale(.82); } }
    .state-copy { min-width: 0; }
    .state-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; line-height: 1.3; font-weight: 650; letter-spacing: -.015em; }
    .state-detail { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.4; }
    .balance { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 14px; border-top: 1px solid var(--border); }
    .balance-label { color: var(--text-muted); font-size: 12px; }
    .balance-value { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .preview { min-height: 148px; margin-top: 14px; border-block: 1px solid var(--border); background: var(--fill); display: grid; place-items: center; position: relative; }
    .preview iframe { width: 100%; height: 240px; border: 0; background: white; }
    .placeholder { text-align: center; padding: 30px; }
    .pulse { width: 28px; height: 28px; margin: 0 auto 12px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--text); animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .body { padding: 14px 16px 16px; }
    .datum { padding: 10px 11px; border-radius: 8px; background: var(--fill); }
    .label { display: block; color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .value { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { appearance: none; min-height: 36px; border: 0; border-radius: 999px; padding: 0 16px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; background: var(--button); color: var(--button-text); transition: transform 140ms cubic-bezier(.23,1,.32,1), opacity 140ms, background 140ms; }
    button.secondary { background: var(--fill); color: var(--text); }
    button:hover { transform: translateY(-1px); }
    button:disabled { opacity: .42; cursor: default; transform: none; }
    .compact > button { justify-self: start; }
    .note { margin: 0 0 12px; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    .brief { padding: 18px 16px 16px; }
    .brief-copy { margin: 0 0 16px; }
    .brief-title { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.015em; }
    .brief-detail { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    .brief-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 16px; }
    .brief-group { min-width: 0; margin: 0; padding: 0; border: 0; }
    .brief-group.wide { grid-column: 1 / -1; }
    .brief-group legend { margin: 0 0 8px; padding: 0; color: var(--text); font-size: 12px; font-weight: 650; }
    .brief-group legend small { margin-left: 5px; color: var(--text-muted); font-size: 10px; font-weight: 500; }
    .choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 7px; }
    .choice { position: relative; min-width: 0; cursor: pointer; }
    .choice input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .choice span {
      min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px;
      background: var(--fill); color: var(--text); font-size: 12px; line-height: 1.3;
      transition: border-color 140ms cubic-bezier(.23,1,.32,1), background 140ms cubic-bezier(.23,1,.32,1), color 140ms cubic-bezier(.23,1,.32,1), transform 140ms cubic-bezier(.23,1,.32,1);
    }
    .choice:hover span { transform: translateY(-1px); border-color: color-mix(in srgb, var(--text) 30%, var(--border)); }
    .choice input:checked + span { border-color: var(--button); background: var(--button); color: var(--button-text); }
    .choice input:checked + span::after { content: "✓"; flex: 0 0 auto; font-size: 11px; font-weight: 700; }
    .choice input:focus-visible + span { box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 12%, transparent); }
    .brief-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
    .brief-error { margin: 0; color: #b42318; font-size: 12px; line-height: 1.4; }
    .brief-error[data-tone="pending"] { color: var(--text-muted); }
    .brief-error[data-tone="success"] { color: var(--success); }
    .card[data-view="compact"] .sub,
    .card[data-view="compact"] .preview,
    .card[data-view="compact"] .body { display: none; }
    .card[data-view="artifact"] .compact { display: none; }
    .card[data-view="brief"] .compact,
    .card[data-view="brief"] .preview,
    .card[data-view="brief"] .body { display: none; }
    @media (max-width: 560px) { .brief-groups { grid-template-columns: 1fr; } .brief-group.wide { grid-column: auto; } }
    @media (prefers-reduced-motion: reduce) { .card, .state-dot { animation: none !important; } }
    @media (prefers-reduced-transparency: reduce) { .card { background: var(--surface-strong); -webkit-backdrop-filter: none; backdrop-filter: none; } }
  </style>
</head>
<body>
  <main class="card" id="card" data-view="compact">
    <header class="head"><span class="mark" aria-hidden="true"><svg viewBox="0 0 64 64"><path fill="#fff" fill-rule="evenodd" d="M32 8C45.3 8 56 18.7 56 32S45.3 56 32 56H11a3 3 0 0 1-3-3V32C8 18.7 18.7 8 32 8Zm0 7C22.6 15 15 22.6 15 32v17h17c9.4 0 17-7.6 17-17S41.4 15 32 15Z"/><path fill="#fff" d="M23.7 22.6c-.9-.4-1.8.5-1.4 1.4l6.4 17.7c.4 1.1 2 .8 2-.4v-9.7h10.5c1.2 0 1.5-1.6.4-2l-17.9-7Z"/></svg></span><div><h1 class="title">OpenDesign</h1><p class="sub" id="subtitle">Artifact ready</p></div></header>
    <section class="compact" id="compact"><div class="state"><span class="state-dot" id="state-dot"></span><div class="state-copy"><strong class="state-title" id="state-title"></strong><p class="state-detail" id="state-detail"></p></div></div><div class="balance" id="balance" hidden><span class="balance-label">Remaining balance</span><strong class="balance-value" id="balance-value"></strong></div><button id="account-action" hidden></button></section>
    <section class="brief" id="brief-form" hidden>
      <div class="brief-copy"><h2 class="brief-title">Choose a direction</h2><p class="brief-detail">Pick what fits best. Recommended choices are already selected, and you can refine the result later in OpenDesign.</p></div>
      <form id="brief-fields">
        <div class="brief-groups">
          <fieldset class="brief-group"><legend>Primary goal</legend><div class="choice-grid" id="brief-goal-options"></div></fieldset>
          <fieldset class="brief-group"><legend>Audience</legend><div class="choice-grid" id="brief-audience-options"></div></fieldset>
          <fieldset class="brief-group wide"><legend>Include <small>Choose all that apply</small></legend><div class="choice-grid" id="brief-content-options"></div></fieldset>
          <fieldset class="brief-group wide"><legend>Visual style</legend><div class="choice-grid" id="brief-visual-options"></div></fieldset>
        </div>
        <div class="brief-actions"><button id="brief-submit" type="submit">Create with these choices</button><p class="brief-error" id="brief-error" role="status"></p></div>
      </form>
    </section>
    <section class="preview" id="preview"><div class="placeholder"><div class="pulse" id="pulse"></div><strong id="preview-title">Preparing your design</strong></div></section>
    <section class="body"><p class="note" id="note"></p><div id="version-list"></div><div class="actions"><button id="studio" hidden>Edit in Open Design</button><button class="secondary" id="raw" hidden>Open preview</button><button class="secondary" id="refresh" hidden>Refresh</button><button class="secondary" id="versions" hidden>Versions</button><button class="secondary" id="export" hidden>Export source</button></div></section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    const safeText = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : String(value);
    let current = {};
    let pollTimer = null;
    let rpcId = 0;
    let bridgeInitialized = false;
    let resizeFrame = 0;
    let lastReportedSize = '';
    let briefHydratedKey = '';
    const pendingRequests = new Map();
    const rpcNotify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
    const rpcRequest = (method, params, timeoutMs = 30000) => new Promise((resolve, reject) => {
      const id = ++rpcId;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(method + ' timed out'));
      }, timeoutMs);
      pendingRequests.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
    const scheduleSizeChanged = () => {
      if (!bridgeInitialized || resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const body = document.body;
        const bodyStyle = getComputedStyle(body);
        const cardRect = byId('card').getBoundingClientRect();
        const verticalPadding = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
        const height = Math.max(1, Math.ceil(cardRect.height + verticalPadding));
        const sizeKey = String(height);
        if (sizeKey === lastReportedSize) return;
        lastReportedSize = sizeKey;
        rpcNotify('ui/notifications/size-changed', { height });
      });
    };
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (typeof message.id === 'number') {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(message.error); else pending.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-result') {
        const result = message.params?.result ?? message.params;
        if (result?.structuredContent) render(result.structuredContent);
      }
    }, { passive: true });
    const initializeBridge = async () => {
      try {
        await rpcRequest('ui/initialize', {
          appInfo: { name: 'open-design-artifact-card', version: '${SERVER_VERSION}' },
          appCapabilities: {},
          protocolVersion: '2026-01-26',
        });
        bridgeInitialized = true;
        rpcNotify('ui/notifications/initialized', {});
        scheduleSizeChanged();
        return true;
      } catch { return false; }
    };
    const bridgeReady = initializeBridge();
    async function callTool(name, args) {
      if (await bridgeReady) return rpcRequest('tools/call', { name, arguments: args });
      return window.openai?.callTool?.(name, args);
    }
    async function openUrl(url) {
      if (!url) return;
      if (window.openai?.openExternal) {
        window.openai.openExternal({ href: url });
        return;
      }
      if (bridgeInitialized) {
        try {
          await rpcRequest('ui/open-link', { url });
          return;
        } catch {}
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    async function sendBriefMessage(payload) {
      const lines = [
        '[OpenDesign brief confirmed]',
        'Project name: ' + payload.title,
        'Artifact type: ' + payload.artifactType,
        'Audience: ' + payload.brief.audience,
        'Outcome: ' + payload.brief.outcome,
        'Content and flows: ' + payload.brief.contentAndFlows,
        'Visual direction: ' + payload.brief.visualDirection,
        'Output format: ' + payload.brief.outputFormat,
      ];
      if (payload.brief.constraints) lines.push('Constraints: ' + payload.brief.constraints);
      lines.push('Create the Open Design project and start the Cloud run with confirmed:true. Do not ask for the same brief again.');
      const text = lines.join('\\n');
      if (await bridgeReady) {
        try {
          await rpcRequest('ui/update-model-context', {
            structuredContent: { openDesignBrief: { ...payload, confirmed: true } },
          });
        } catch {}
        await rpcRequest('ui/message', { role: 'user', content: [{ type: 'text', text }] });
        return;
      }
      if (window.openai?.sendFollowUpMessage) {
        await window.openai.sendFollowUpMessage({ prompt: text });
        return;
      }
      throw new Error('This host cannot submit Custom UI messages.');
    }
    function defaultOutputFormat(artifactType) {
      const formats = {
        website: 'Responsive browser website',
        'product-prototype': 'Interactive responsive product prototype',
        presentation: 'Browser presentation with a real preview',
        'design-system': 'Reusable DESIGN.md design system',
      };
      return formats[artifactType] || '';
    }
    const briefChoice = (label, value, recommended = false) => ({ label, value, recommended });
    const VISUAL_CHOICES = [
      briefChoice('Clean & focused', 'Use a clean, focused visual system with clear hierarchy, generous spacing, and restrained color.', true),
      briefChoice('Bold & editorial', 'Use a bold editorial direction with expressive typography, strong composition, and memorable contrast.'),
      briefChoice('Warm & approachable', 'Use a warm, approachable direction with friendly color, soft geometry, and inviting imagery.'),
      briefChoice('Modern tech', 'Use a modern technology aesthetic with precise grids, crisp interfaces, and subtle depth or motion.'),
      briefChoice('Premium & restrained', 'Use a premium, restrained direction with refined typography, muted color, and polished details.'),
    ];
    const BRIEF_CHOICE_PRESETS = {
      website: {
        goal: [
          briefChoice('Explain & convert', 'Explain the offering clearly and drive visitors toward the primary conversion.', true),
          briefChoice('Launch something', 'Introduce and launch a new product, service, feature, or campaign.'),
          briefChoice('Build trust', 'Build credibility through a clear story, proof, and a professional presentation.'),
          briefChoice('Sell online', 'Help visitors evaluate the offer and complete a purchase or sales inquiry.'),
        ],
        audience: [
          briefChoice('Potential customers', 'Potential customers evaluating whether this offering is right for them.', true),
          briefChoice('Existing users', 'Existing users who already know the product and need guidance or updates.'),
          briefChoice('Business buyers', 'Business buyers and decision-makers comparing solutions and expected value.'),
          briefChoice('General audience', 'A broad public audience with mixed levels of familiarity.'),
        ],
        content: [
          briefChoice('Hero & CTA', 'A strong opening message with one clear primary call to action.', true),
          briefChoice('Key benefits', 'A concise benefits and feature story that explains why the offering matters.', true),
          briefChoice('Social proof', 'Trust signals such as customer quotes, results, logos, or evidence.', true),
          briefChoice('How it works', 'A simple step-by-step explanation of the experience or process.'),
          briefChoice('Pricing', 'Pricing or plan information with a clear comparison and next step.'),
          briefChoice('FAQ & contact', 'Frequently asked questions plus a direct contact or final conversion path.'),
        ],
      },
      'product-prototype': {
        goal: [
          briefChoice('Validate an idea', 'Make the product concept tangible enough to validate the value proposition and interaction model.', true),
          briefChoice('Demo the core flow', 'Demonstrate the most important end-to-end workflow in a convincing interactive prototype.'),
          briefChoice('Run a user test', 'Create a focused prototype suitable for observing usability and task completion.'),
          briefChoice('Support a review', 'Communicate the proposed product behavior clearly for stakeholder or product review.'),
        ],
        audience: [
          briefChoice('New users', 'First-time users who need a clear, guided path through the product.', true),
          briefChoice('Power users', 'Experienced users who value speed, control, and information density.'),
          briefChoice('Internal teams', 'Internal product, design, engineering, or operations collaborators.'),
          briefChoice('Decision-makers', 'Stakeholders or buyers evaluating the product concept and business value.'),
        ],
        content: [
          briefChoice('Core workflow', 'The primary task flow from entry through successful completion.', true),
          briefChoice('Navigation & states', 'Navigation plus realistic empty, loading, success, and error states.', true),
          briefChoice('Dashboard & data', 'A useful overview with realistic metrics, records, or progress information.'),
          briefChoice('Search & discovery', 'Search, filtering, browsing, or recommendation interactions.'),
          briefChoice('Create & edit', 'Creation and editing interactions with clear feedback and validation.'),
          briefChoice('Settings', 'Account, preference, permission, or configuration surfaces.'),
        ],
      },
      presentation: {
        goal: [
          briefChoice('Pitch an idea', 'Persuade the audience to support an idea, product, company, or initiative.', true),
          briefChoice('Share strategy', 'Explain a strategic direction, priorities, and the reasoning behind them.'),
          briefChoice('Report progress', 'Communicate results, learnings, current status, and next steps.'),
          briefChoice('Teach a topic', 'Help the audience understand and remember a topic through a clear narrative.'),
        ],
        audience: [
          briefChoice('Leadership', 'Executives and senior leaders who need concise decisions, evidence, and implications.', true),
          briefChoice('Customers', 'Customers or prospects evaluating an offer, proposal, or solution.'),
          briefChoice('Investors', 'Investors assessing the opportunity, traction, differentiation, and plan.'),
          briefChoice('Internal team', 'An internal cross-functional team aligning around context and action.'),
        ],
        content: [
          briefChoice('Clear story arc', 'A strong beginning, logical narrative arc, and memorable conclusion.', true),
          briefChoice('Evidence & data', 'Focused evidence, metrics, examples, or proof that supports the argument.', true),
          briefChoice('Recommendation', 'A clear proposal or recommendation with rationale and trade-offs.'),
          briefChoice('Product story', 'A visual explanation of the product, experience, or solution.'),
          briefChoice('Roadmap', 'A phased plan, milestones, priorities, or future direction.'),
          briefChoice('Next steps', 'Specific decisions, owners, calls to action, or immediate next steps.', true),
        ],
      },
      'design-system': {
        goal: [
          briefChoice('Unify a product', 'Create a consistent visual and interaction foundation across an existing product.', true),
          briefChoice('Start a new product', 'Define a practical design foundation for a new product from the beginning.'),
          briefChoice('Refresh the brand', 'Translate an updated brand direction into usable digital product rules.'),
          briefChoice('Scale delivery', 'Help design and engineering teams ship consistent interfaces more efficiently.'),
        ],
        audience: [
          briefChoice('Product teams', 'Cross-functional product teams using shared rules to design and build experiences.', true),
          briefChoice('Designers', 'Designers who need foundations, components, patterns, and clear usage guidance.'),
          briefChoice('Developers', 'Frontend engineers implementing reusable components and product patterns.'),
          briefChoice('Brand teams', 'Brand and marketing teams extending the visual language across digital surfaces.'),
        ],
        content: [
          briefChoice('Foundations', 'Color, typography, spacing, layout, shape, elevation, and motion foundations.', true),
          briefChoice('Core components', 'A practical set of reusable interface components and their states.', true),
          briefChoice('Usage guidance', 'Clear rules, examples, and do-and-don’t guidance for consistent application.', true),
          briefChoice('Accessibility', 'Accessibility requirements for contrast, focus, semantics, motion, and input.'),
          briefChoice('Product patterns', 'Reusable patterns for navigation, forms, feedback, data, and common flows.'),
          briefChoice('Governance', 'Contribution, naming, ownership, versioning, and maintenance guidance.'),
        ],
      },
    };
    function conciseChoiceLabel(value) {
      const normalized = String(value).trim().replace(/\\s+/g, ' ');
      return normalized.length > 64 ? normalized.slice(0, 61) + '…' : normalized;
    }
    function resolvedBriefChoices(options, suggestedValue) {
      const suggestion = typeof suggestedValue === 'string' ? suggestedValue.trim() : '';
      if (!suggestion) return options;
      const exact = options.find((item) => item.value.toLowerCase() === suggestion.toLowerCase());
      if (exact) return options.map((item) => ({ ...item, recommended: item === exact }));
      return [
        briefChoice('From your brief · ' + conciseChoiceLabel(suggestion), suggestion, true),
        ...options.map((item) => ({ ...item, recommended: false })),
      ];
    }
    function renderBriefChoiceGroup(containerId, name, definition, suggestedValue) {
      const host = byId(containerId);
      host.replaceChildren();
      const options = resolvedBriefChoices(definition.options, suggestedValue);
      options.forEach((item) => {
        const label = document.createElement('label');
        label.className = 'choice';
        const input = document.createElement('input');
        input.type = definition.multiple ? 'checkbox' : 'radio';
        input.name = name;
        input.value = item.value;
        input.checked = item.recommended === true;
        const text = document.createElement('span');
        text.textContent = item.label;
        label.append(input, text);
        host.append(label);
      });
    }
    function selectedBriefChoice(name, multiple = false) {
      const selected = Array.from(document.querySelectorAll('input[name="' + name + '"]:checked'));
      if (multiple) return selected.map((input) => input.value).join('; ');
      return selected[0]?.value || '';
    }
    function renderBrief(output) {
      const brief = output.brief && typeof output.brief === 'object' ? output.brief : {};
      const hydrationKey = JSON.stringify({ artifactType: output.artifactType, title: output.title, brief });
      if (hydrationKey !== briefHydratedKey) {
        briefHydratedKey = hydrationKey;
        const preset = BRIEF_CHOICE_PRESETS[output.artifactType] || BRIEF_CHOICE_PRESETS.website;
        renderBriefChoiceGroup('brief-goal-options', 'brief-goal', { options: preset.goal, multiple: false }, brief.outcome);
        renderBriefChoiceGroup('brief-audience-options', 'brief-audience', { options: preset.audience, multiple: false }, brief.audience);
        renderBriefChoiceGroup('brief-content-options', 'brief-content', { options: preset.content, multiple: true }, brief.contentAndFlows);
        renderBriefChoiceGroup('brief-visual-options', 'brief-visual', { options: VISUAL_CHOICES, multiple: false }, brief.visualDirection);
        const submit = byId('brief-submit');
        submit.disabled = false;
        submit.textContent = 'Create with these choices';
        byId('brief-error').textContent = '';
      }
      const form = byId('brief-fields');
      form.onsubmit = async (event) => {
        event.preventDefault();
        const submit = byId('brief-submit');
        const error = byId('brief-error');
        const payload = {
          artifactType: output.artifactType,
          title: safeText(output.title, 'New Open Design project').trim(),
          brief: {
            audience: selectedBriefChoice('brief-audience'),
            outcome: selectedBriefChoice('brief-goal'),
            contentAndFlows: selectedBriefChoice('brief-content', true),
            visualDirection: selectedBriefChoice('brief-visual'),
            outputFormat: safeText(brief.outputFormat, defaultOutputFormat(output.artifactType)).trim(),
            constraints: safeText(brief.constraints, '').trim(),
          },
        };
        const missing = [
          ['Project name', payload.title],
          ['Audience', payload.brief.audience],
          ['Outcome', payload.brief.outcome],
          ['Content and flows', payload.brief.contentAndFlows],
          ['Visual direction', payload.brief.visualDirection],
          ['Output format', payload.brief.outputFormat],
        ].filter(([, value]) => !value).map(([label]) => label);
        if (missing.length) {
          error.dataset.tone = 'error';
          error.textContent = 'Complete: ' + missing.join(', ') + '.';
          scheduleSizeChanged();
          return;
        }
        submit.disabled = true;
        error.dataset.tone = 'pending';
        error.textContent = 'Submitting…';
        try {
          await sendBriefMessage(payload);
          error.dataset.tone = 'success';
          error.textContent = 'Brief submitted.';
          submit.textContent = 'Submitted';
        } catch (submitError) {
          error.dataset.tone = 'error';
          error.textContent = submitError instanceof Error ? submitError.message : 'Could not submit the brief.';
          submit.disabled = false;
        }
        scheduleSizeChanged();
      };
    }
    function accountLabel() {
      const user = current.user && typeof current.user === 'object' ? current.user : {};
      const account = current.account && typeof current.account === 'object' ? current.account : {};
      return user.name || user.displayName || user.email || account.name || account.email || 'OpenDesign account';
    }
    function render(output) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      const incoming = output && typeof output === 'object' ? output : {};
      current = { ...current, ...incoming };
      const briefMode = current.view === 'brief-form';
      byId('brief-form').hidden = !briefMode;
      if (briefMode) {
        byId('card').dataset.view = 'brief';
        byId('subtitle').textContent = [current.title, current.artifactType].filter(Boolean).join(' · ') || 'Working brief';
        renderBrief(current);
        scheduleSizeChanged();
        return;
      }
      const account = current.account || {};
      const wallet = current.wallet || {};
      const status = safeText(current.status || (current.nextAction === 'recharge' ? 'recharge' : current.loggedIn === true ? 'connected' : current.loggedIn === false ? 'sign in' : 'ready')).toLowerCase();
      const running = status === 'queued' || status === 'running';
      const completed = status === 'succeeded' || Boolean(current.previewUrl);
      const artifactLabels = { website: 'Website', 'product-prototype': 'Product prototype', presentation: 'Presentation', 'design-system': 'Design System' };
      const artifactLabel = artifactLabels[current.artifactType] || current.kind || '';
      const projectLabel = current.name || current.projectName || '';
      byId('subtitle').textContent = [projectLabel, artifactLabel].filter(Boolean).join(' · ') || (current.loggedIn === true ? 'Open Design Cloud connected' : running ? 'Generating with Open Design' : completed ? 'Artifact ready' : 'Ready to create');
      byId('note').textContent = current.hint || (current.loggedIn === false ? 'Sign in to Open Design Cloud before starting a Cloud run.' : completed ? 'Review the result here, then continue detailed editing, versions, and export in Open Design.' : running ? 'Open Design is working. Long thinking intervals are normal.' : 'Create a website, product prototype, presentation, or reusable design system.');
      const balance = current.balanceUsd ?? account.balanceUsd ?? wallet.balanceUsd;
      const rechargeMode = current.nextAction === 'recharge';
      const compactMode = running || rechargeMode || (!completed && current.loggedIn !== undefined);
      byId('card').dataset.view = compactMode ? 'compact' : 'artifact';
      const stateDot = byId('state-dot');
      const stateTitle = byId('state-title');
      const stateDetail = byId('state-detail');
      const balanceRow = byId('balance');
      const accountAction = byId('account-action');
      stateDot.dataset.tone = running ? 'running' : current.loggedIn === true ? 'success' : 'neutral';
      balanceRow.hidden = true;
      accountAction.hidden = true;
      stateDetail.hidden = false;
      if (running) {
        stateTitle.textContent = projectLabel ? 'Creating “' + projectLabel + '”' : 'Creating your design';
        stateDetail.textContent = status === 'queued' ? 'Preparing the workspace…' : 'Generating your design…';
      } else if (rechargeMode) {
        stateTitle.textContent = accountLabel();
        stateDetail.hidden = true;
        balanceRow.hidden = false;
        byId('balance-value').textContent = '$' + safeText(balance, '0.00');
        accountAction.textContent = 'Recharge';
        accountAction.hidden = false;
        accountAction.onclick = () => openUrl('${CHATGPT_RECHARGE_URL}');
      } else if (current.loggedIn === true) {
        stateTitle.textContent = 'Authorization complete';
        stateDetail.hidden = true;
      } else if (current.loggedIn === false) {
        stateTitle.textContent = 'Not signed in';
        stateDetail.hidden = true;
        accountAction.textContent = 'Sign in / Register';
        accountAction.hidden = false;
        accountAction.onclick = () => openUrl('${CHATGPT_SIGN_IN_URL}');
      } else {
        stateTitle.textContent = status === 'failed' ? 'Needs attention' : 'Ready';
        stateDetail.textContent = current.hint || '';
      }
      byId('pulse').hidden = !running;
      byId('preview-title').textContent = running ? 'Creating your design…' : completed ? 'Artifact ready' : current.loggedIn === false ? 'Connect Open Design Cloud' : 'Ready for your brief';
      const preview = byId('preview');
      const oldFrame = preview.querySelector('iframe'); if (oldFrame) oldFrame.remove();
      const placeholder = preview.querySelector('.placeholder'); if (placeholder) placeholder.hidden = completed && Boolean(current.previewUrl);
      if (completed && current.previewUrl) {
        const frame = document.createElement('iframe'); frame.src = current.previewUrl; frame.title = 'Open Design artifact preview'; frame.loading = 'lazy'; preview.prepend(frame);
      }
      const studio = byId('studio'); studio.hidden = !current.studioUrl; studio.onclick = () => openUrl(current.studioUrl);
      const raw = byId('raw'); raw.hidden = !current.previewUrl; raw.onclick = () => openUrl(current.previewUrl);
      const refreshRun = async () => {
        const next = await callTool('get_run', { runId: current.runId || current.id });
        if (next?.structuredContent) render(next.structuredContent);
        return next;
      };
      const refresh = byId('refresh'); refresh.hidden = !running || !(current.runId || current.id); refresh.onclick = async () => {
        refresh.disabled = true;
        try { await refreshRun(); }
        finally { refresh.disabled = false; }
      };
      const projectId = current.projectId || (current.status ? null : current.id);
      const entryFile = current.entryFile || (current.previewUrl ? decodeURIComponent(String(current.previewUrl).split('/raw/')[1] || '') : '');
      const versions = byId('versions'); versions.hidden = !projectId || !entryFile; versions.onclick = async () => {
        versions.disabled = true;
        try { const next = await callTool('list_versions', { project: projectId, path: entryFile }); if (next?.structuredContent) renderVersions(next.structuredContent); }
        finally { versions.disabled = false; }
      };
      const exportButton = byId('export'); exportButton.hidden = !projectId || !completed; exportButton.onclick = async () => {
        exportButton.disabled = true; byId('note').textContent = 'Preparing a source ZIP…'; scheduleSizeChanged();
        try {
          const next = await callTool('export_project', { project: projectId });
          byId('note').textContent = next?.isError ? 'Export failed. Open Studio to export from the full editor.' : 'Source ZIP is ready in the tool result. Use Open Studio for rendered PDF, image, or PPTX export.';
        } finally { exportButton.disabled = false; scheduleSizeChanged(); }
      };
      if (running && (current.runId || current.id)) {
        pollTimer = setTimeout(() => { refreshRun().catch(() => { pollTimer = setTimeout(() => render(current), 30000); }); }, 30000);
      }
      scheduleSizeChanged();
    }
    function renderVersions(output) {
      const host = byId('version-list'); host.replaceChildren();
      const versions = Array.isArray(output?.versions) ? output.versions.slice().reverse().slice(0, 6) : [];
      if (!versions.length) { byId('note').textContent = 'No saved HTML versions yet.'; scheduleSizeChanged(); return; }
      const heading = document.createElement('p'); heading.className = 'note'; heading.textContent = 'Recent versions'; host.append(heading);
      versions.forEach((version) => {
        const row = document.createElement('div'); row.className = 'datum'; row.style.marginBottom = '7px'; row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
        const text = document.createElement('span'); text.className = 'value'; text.style.flex = '1'; text.textContent = 'v' + safeText(version.version, '?') + (version.label ? ' · ' + version.label : ''); row.append(text);
        if (!version.current && version.id) { const restore = document.createElement('button'); restore.className = 'secondary'; restore.textContent = 'Restore'; restore.onclick = async () => { restore.disabled = true; try { await callTool('restore_version', { project: output.projectId, path: output.path, versionId: version.id, confirm: true }); byId('note').textContent = 'Version restored. Open Studio or refresh the preview to review it.'; } finally { restore.disabled = false; scheduleSizeChanged(); } }; row.append(restore); }
        host.append(row);
      });
      scheduleSizeChanged();
    }
    render(window.openai?.toolOutput ?? window.openai?.widgetState);
    window.addEventListener('openai:set_globals', (event) => render(
      event.detail?.globals?.toolOutput
        ?? window.openai?.toolOutput
        ?? event.detail?.globals?.widgetState
        ?? window.openai?.widgetState,
    ), { passive: true });
  </script>
</body>
</html>`;

const CHATGPT_STATUS_META = {
  'openai/toolInvocation/invoking': 'Working in Open Design…',
  'openai/toolInvocation/invoked': 'Open Design updated.',
};

const CHATGPT_WIDGET_META = {
  ui: { resourceUri: CHATGPT_WIDGET_URI },
  // `registerAppTool` from @modelcontextprotocol/ext-apps publishes both
  // spellings. Keep the legacy flat key for hosts that have not fully moved
  // to nested `ui.resourceUri` yet.
  'ui/resourceUri': CHATGPT_WIDGET_URI,
  'openai/outputTemplate': CHATGPT_WIDGET_URI,
  ...CHATGPT_STATUS_META,
};

const CHATGPT_WIDGET_RESULT_META = {
  ui: { resourceUri: CHATGPT_WIDGET_URI },
  'ui/resourceUri': CHATGPT_WIDGET_URI,
  'openai/outputTemplate': CHATGPT_WIDGET_URI,
};

type JsonObject = Record<string, unknown>;
interface RunMcpOptions { daemonUrl: string | URL }
export interface CreateOpenDesignMcpServerOptions {
  daemonUrl: string | URL;
  widgetFrameDomains?: string[];
  widgetRedirectDomains?: string[];
  transformToolResult?: (toolName: string, result: any) => any | Promise<any>;
}
interface CatalogItem { id: string; name?: string; title?: string; description?: string; summary?: string }
interface SkillsPayload { skills?: CatalogItem[] }
interface PluginsPayload { plugins?: CatalogItem[] }
interface DesignSystemsPayload { designSystems?: CatalogItem[] }
interface ResourcePayload { skill?: { body?: string; content?: string }; designSystem?: { body?: string; content?: string }; body?: string; content?: string }
interface ProjectSummary { id: string; name: string; metadata?: JsonObject }
interface ProjectsPayload { projects?: ProjectSummary[] }
interface ProjectPayload { project?: ProjectSummary; id?: string; name?: string; metadata?: JsonObject; resolvedDir?: string }
interface ActiveContext { active?: boolean; projectId?: string; projectName?: string | null; fileName?: string | null; ageMs?: number | null }
type ResolvedProject = { id: string; name: string; source: 'uuid' | 'id' | 'exact' | 'slug' | 'substring' };
interface ProjectListCache { baseUrl: string; t: number; list: ProjectSummary[] }
interface McpArgs extends JsonObject { project?: unknown; entry?: unknown; include?: unknown; maxBytes?: unknown; path?: unknown; offset?: unknown; limit?: unknown; since?: unknown; query?: unknown; pattern?: unknown; max?: unknown; name?: unknown; title?: unknown; content?: unknown; encoding?: unknown; artifactManifest?: unknown; confirm?: unknown; confirmed?: unknown; prompt?: unknown; plugin?: unknown; inputs?: unknown; agent?: unknown; model?: unknown; runId?: unknown; id?: unknown; designSystem?: unknown; skill?: unknown; artifactType?: unknown; brief?: unknown; audience?: unknown; outcome?: unknown; contentAndFlows?: unknown; visualDirection?: unknown; outputFormat?: unknown; constraints?: unknown; includeUnavailable?: unknown; versionId?: unknown }
interface ProjectFileBundleEntry { name: string; mime: string; size: number | null; content: string | null; binary: boolean }
interface BundleInput { project: ProjectPayload | ProjectSummary; entry: string; files: ProjectFileBundleEntry[]; truncated: boolean; active: ActiveContext | null; resolved?: ResolvedProject | null }

function withChatGptWidgetResultMeta(toolName: string, result: any): any {
  if (!['collect_brief', 'get_cloud_account', 'start_run'].includes(toolName) || !result || typeof result !== 'object') return result;
  if (!result.structuredContent || typeof result.structuredContent !== 'object') return result;
  const currentMeta = result._meta && typeof result._meta === 'object' ? result._meta as JsonObject : {};
  const currentUi = currentMeta.ui && typeof currentMeta.ui === 'object' ? currentMeta.ui as JsonObject : {};
  return {
    ...result,
    _meta: {
      ...currentMeta,
      ...CHATGPT_WIDGET_RESULT_META,
      ui: { ...currentUi, resourceUri: CHATGPT_WIDGET_URI },
    },
  };
}
interface ErrorWithCode { message?: string; code?: string; cause?: { code?: string } }

interface McpIdleExitControllerOptions {
  idleMs: number;
  onIdle: () => void;
}

export function _createMcpIdleExitController({
  idleMs,
  onIdle,
}: McpIdleExitControllerOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  let disposed = false;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (disposed) return;
    clear();
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      if (inFlight > 0) {
        schedule();
        return;
      }
      disposed = true;
      onIdle();
    }, idleMs);
  };

  schedule();

  return {
    noteActivity() {
      schedule();
    },
    async trackRequest<T>(fn: () => T | Promise<T>): Promise<T> {
      if (disposed) {
        return fn();
      }
      inFlight += 1;
      schedule();
      try {
        return await fn();
      } finally {
        inFlight -= 1;
        if (inFlight === 0) {
          schedule();
        }
      }
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

// Mimes whose body we surface as MCP `text` content. Everything else
// returns a clear error directing the caller at list_files for
// metadata, until phase 2 adds binary support.
const TEXTUAL_MIME_PATTERNS = [
  /^text\//i,
  /^application\/json\b/i,
  /^application\/javascript\b/i,
  /^application\/typescript\b/i,
  /^application\/xml\b/i,
  /^application\/x-(yaml|toml|httpd-php|sh)\b/i,
  /\+json\b/i,
  /\+xml\b/i,
  /^image\/svg\+xml\b/i,
];

// Every tool here is a read against a local daemon owned by the
// current user, so they're all read-only, idempotent, and operate on
// a closed (project-scoped) namespace. Pull these into one constant
// so each tool def doesn't repeat them.
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

// Description style: short, one purpose-line per tool. Active-context
// fallback is documented once in the server `instructions` block, so
// per-tool descriptions just say "project optional" and don't repeat
// the rationale - that saves ~150 tokens per tools/list response,
// shipped to the model on every session.
const PROJECT_ARG = {
  type: 'string',
  description: 'Project id (UUID) or name substring. Optional; defaults to the active project (expires after ~5 minutes of no Open Design activity).',
} as const;

const TOOL_DEFS = [
  {
    name: 'list_projects',
    description: 'List every Open Design project on this daemon.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design projects' },
  },
  {
    name: 'get_active_context',
    description:
      'Project + file the user has open in Open Design right now. Returns {active:false, hint:"..."} when no project is active so the agent can ask the user to interact with Open Design (the active context expires ~5 minutes after the last user interaction). Most tools default to this when project is omitted, so you rarely need to call this directly.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: 'What is the user looking at?' },
  },
  {
    name: 'get_artifact',
    description:
      'PREFER THIS over multiple get_file calls. Bundles the entry file plus every sibling it references (HTML <script>/<link>/<img>/srcset, JSX import/require, CSS url()/@import) up to depth 3, skipping CDN/data URLs. include="all" returns every file in the project; include="shallow" returns just the entry.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        entry: {
          type: 'string',
          description:
            "Entry file path relative to project root. Defaults to the active file or project's metadata.entryFile. Active-file fallback expires after ~5 minutes of no Open Design activity.",
        },
        include: {
          type: 'string',
          enum: ['auto', 'all', 'shallow'],
          description: 'auto (default) | all | shallow',
        },
        maxBytes: {
          type: 'number',
          description:
            'Soft cap on total text bytes (default 1_500_000). Also capped at 200 files. Excess files are dropped and truncated:true is set.',
        },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Pull design bundle' },
  },
  {
    name: 'get_project',
    description:
      'Single project metadata: name, active skill/design-system ids, entryFile, kind, timestamps, resolvedDir, and (when it has an entry file) a browser-openable previewUrl.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_ARG },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Get Open Design project' },
  },
  {
    name: 'get_file',
    description:
      'Read one project file. Text mimes only (HTML, JSX, CSS, JSON, SVG, Markdown). Binary files return an error; use list_files for metadata. Returns up to `limit` lines starting at `offset` (defaults: offset=0, limit=2000), mirroring Claude Code\'s Read tool. For files longer than the slice, the response carries an `[od:file-window ...]` marker with totalLines so you can page by re-calling with the next offset. For multi-file designs prefer get_artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        path: {
          type: 'string',
          description:
            'File path relative to project root, forward slashes. Optional; defaults to the active file when project is also omitted. Active-file fallback expires after ~5 minutes of no Open Design activity.',
        },
        offset: {
          type: 'number',
          description: '0-indexed starting line of the slice to return. Defaults to 0.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return. Defaults to 2000.',
        },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Read project file' },
  },
  {
    name: 'search_files',
    description:
      'Case-insensitive literal-substring search across textual files in a project. Returns up to max matches with file, 1-indexed line, and snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        query: {
          type: 'string',
          description: 'Literal substring (not a regex), case-insensitive.',
        },
        pattern: {
          type: 'string',
          description: 'Optional glob on file name, e.g. "*.jsx".',
        },
        max: {
          type: 'number',
          description: 'Cap on matches (default 200, hard cap 1000).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Search project files' },
  },
  {
    name: 'list_files',
    description:
      'Project file metadata: name, path, mime, kind, size, mtime, optional artifactManifest. Pass since=<unix-ms> to cheap-poll for changes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        since: {
          type: 'number',
          description: 'Unix-ms; only return files with mtime > since.',
        },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'List project files' },
  },
  {
    name: 'create_artifact',
    description:
      'Create one normal Open Design project artifact entry file. Writes name+content, rejects existing targets, and persists artifactManifest when supplied. HTML, Markdown, and SVG entries get a default manifest when omitted. Project optional; defaults to the active project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        name: {
          type: 'string',
          description: 'Output path relative to the project root, for example "codex-product/index.html" or "deck.html".',
        },
        content: {
          type: 'string',
          description: 'Entry file contents. Use encoding="base64" for base64 content.',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'utf8 (default) | base64',
        },
        artifactManifest: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional ArtifactManifest sidecar. If omitted, Open Design infers one for HTML, Markdown, or SVG entry files.',
        },
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Create Open Design artifact' },
  },
  {
    name: 'write_file',
    description:
      'Write (or overwrite) a project file. Unlike create_artifact this does not require an ArtifactManifest and tolerates existing targets, so it is the right tool for iterating on a file the agent (or the user) already created. Project optional; defaults to the active project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        path: {
          type: 'string',
          description: 'Output path relative to the project root, e.g. "deck.html" or "components/Hero.tsx".',
        },
        content: {
          type: 'string',
          description: 'File contents. Use encoding="base64" for binary payloads.',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'utf8 (default) | base64',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Write Open Design project file' },
  },
  {
    name: 'delete_file',
    description:
      'Delete one file from a project. Supports nested paths (e.g. "codex-product/index.html"). Project optional; defaults to the active project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        path: {
          type: 'string',
          description: 'Project-relative path of the file to delete.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, title: 'Delete Open Design project file' },
  },
  {
    name: 'delete_project',
    description:
      'Permanently delete an Open Design project including its files and conversations. Requires both an explicit project id/name AND confirm:true — there is no active-project fallback because the operation is irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project id (UUID) or name substring. Required — active-context fallback is intentionally disabled.',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be literally true. Guards against an agent accidentally deleting a project while cleaning up.',
        },
      },
      required: ['project', 'confirm'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, title: 'Delete Open Design project' },
  },
  {
    name: 'create_project',
    description:
      'Create a new empty Open Design project to generate into, then call start_run against it. Returns the project (with its id) plus a conversationId. The id is derived from name unless you pass one explicitly.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable project name.' },
        id: {
          type: 'string',
          description: 'Optional project id slug ([A-Za-z0-9._-], <=128 chars). Derived from name when omitted.',
        },
        designSystem: {
          type: 'string',
          description: 'Optional design system id to attach (see the od://design-systems/... resources).',
        },
        skill: { type: 'string', description: 'Optional skill id to seed the project with.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Create Open Design project' },
    _meta: CHATGPT_STATUS_META,
  },
  // Discovery + generation. An external coding agent does NOT run a
  // skill itself — it commissions Open Design to, via start_run. The
  // daemon then spawns ITS OWN agent (Claude Code / API fallback /…)
  // to do the work. So list_skills / list_plugins exist purely so the
  // caller can discover what it can ask OD to generate; start_run
  // kicks off the run and get_run polls it to completion. Design
  // systems stay resource-only (od://design-systems/...) since they're
  // reference material the caller opts into, not something to run.
  {
    name: 'collect_brief',
    description: 'Show the interactive Open Design Custom UI brief form. Call this instead of asking prose questions or emitting <question-form> text whenever audience, outcome, content/flows, visual direction, or output format is missing. Pass every detail already known so the form is prefilled.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactType: {
          type: 'string',
          enum: ['website', 'product-prototype', 'presentation', 'design-system'],
          description: 'The requested Open Design deliverable type.',
        },
        title: { type: 'string', description: 'Suggested human-readable project name.' },
        audience: { type: 'string', description: 'Known or inferred target audience.' },
        outcome: { type: 'string', description: 'Known or inferred result the artifact should achieve.' },
        contentAndFlows: { type: 'string', description: 'Known required content, sections, flows, and interactions.' },
        visualDirection: { type: 'string', description: 'Known visual direction, references, or brand constraints.' },
        outputFormat: { type: 'string', description: 'Known expected output format.' },
        constraints: { type: 'string', description: 'Known must-have or must-avoid constraints.' },
      },
      required: ['artifactType'],
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Complete Open Design brief' },
    _meta: CHATGPT_WIDGET_META,
  },
  {
    name: 'get_cloud_account',
    description: 'Check whether Open Design Cloud is signed in and read the wallet balance. Call this before generation so you can choose Cloud, recharge, or a local Code Agent/BYOK fallback without guessing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: 'Check Open Design Cloud account' },
    _meta: CHATGPT_WIDGET_META,
  },
  {
    name: 'list_skills',
    description: 'List Open Design skills you can pass to start_run as a recipe. Discovery only — Open Design runs the skill, not you.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design skills' },
  },
  {
    name: 'list_plugins',
    description: 'List installed Open Design plugins (packaged design workflows) you can pass to start_run as plugin + inputs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design plugins' },
  },
  {
    name: 'start_run',
    description:
      'Commission Open Design to generate or refine a design. Open Design spawns its own agent to do the work and returns a runId immediately. Poll get_run(runId) until status is terminal, then get_artifact to pull the result. Project optional; defaults to the active project. Requires an existing project (create one first with create_project).',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        prompt: {
          type: 'string',
          description: 'What to make or change, in natural language. Optional when a plugin supplies its own brief.',
        },
        skill: {
          type: 'string',
          description: 'Skill id from list_skills to drive the run. Optional.',
        },
        plugin: {
          type: 'string',
          description: 'Plugin id from list_plugins to drive the run. Optional.',
        },
        inputs: {
          type: 'object',
          additionalProperties: true,
          description: 'Plugin inputs object (only meaningful with plugin). Optional.',
        },
        agent: {
          type: 'string',
          description: "Which agent Open Design should run, e.g. 'claude' | 'codex' | 'opencode'. Optional; defaults to the user's configured agent.",
        },
        model: {
          type: 'string',
          description: 'Model id override for the run. Optional.',
        },
      },
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Generate with Open Design' },
    _meta: CHATGPT_WIDGET_META,
  },
  {
    name: 'get_run',
    description:
      'Poll a run started by start_run. Returns status (queued|running|succeeded|failed|canceled) plus error info. On success, adds previewUrl (open it in a browser to view the rendered design) and agentMessage (the inner agent\'s textual output reassembled from the event stream — show this when there is no previewUrl, e.g. when the agent asked the user a clarifying question instead of producing files).',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run id returned by start_run.' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Check Open Design run' },
    _meta: CHATGPT_STATUS_META,
  },
  {
    name: 'list_versions',
    description: 'List saved versions of an HTML artifact. Path is optional when the project entry file can be resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        path: { type: 'string', description: 'Project-relative HTML path. Defaults to the project entry file.' },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'List artifact versions' },
    _meta: CHATGPT_STATUS_META,
  },
  {
    name: 'restore_version',
    description: 'Restore a saved HTML artifact version. Requires explicit project, path, versionId, and confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Explicit project id or name.' },
        path: { type: 'string', description: 'Project-relative HTML path.' },
        versionId: { type: 'string', description: 'Version id returned by list_versions.' },
        confirm: { type: 'boolean', description: 'Must be true to replace the current artifact content.' },
      },
      required: ['project', 'path', 'versionId', 'confirm'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true, title: 'Restore artifact version' },
    _meta: CHATGPT_STATUS_META,
  },
  {
    name: 'export_project',
    description: 'Export the complete Open Design project source as a ZIP resource. Use Open Design Studio for rendered PDF, image, or PPTX exports.',
    inputSchema: {
      type: 'object',
      properties: { project: PROJECT_ARG },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Export Open Design source ZIP' },
    _meta: CHATGPT_STATUS_META,
  },
  {
    name: 'cancel_run',
    description: 'Request cancellation of an in-flight run started by start_run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run id returned by start_run.' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Cancel Open Design run' },
  },
  {
    name: 'list_agents',
    description:
      'List the agent CLIs Open Design can run for start_run.agent. Returns only installed (available) agents by default — pass includeUnavailable:true to also see agents we know about but that are not on PATH (each carries an installUrl for the user). Each entry includes id, name, version, and up to 10 sample models (modelsCount carries the real total).',
    inputSchema: {
      type: 'object',
      properties: {
        includeUnavailable: {
          type: 'boolean',
          description: 'When true, include agents whose binary is not installed. Defaults to false.',
        },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design agents' },
  },
];

export async function runMcpStdio({ daemonUrl }: RunMcpOptions): Promise<void> {
  const baseUrl = String(daemonUrl).replace(/\/$/, '');
  const localWidgetFrameDomains = [...new Set([new URL(baseUrl).origin, 'https://open-design.ai'])];
  let closeTransportForIdle: (() => void) | null = null;
  const idleExit = _createMcpIdleExitController({
    idleMs: MCP_STDIO_IDLE_EXIT_MS,
    onIdle: () => closeTransportForIdle?.(),
  });
  const withMcpActivity =
    <Args extends unknown[], Result>(handler: (...args: Args) => Result | Promise<Result>) =>
      (...args: Args) =>
        idleExit.trackRequest(() => handler(...args));

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        'Open Design (OD) is a local-first design workspace. The user typically',
        'has OD running on their machine; each project contains a rendered',
        'artifact (HTML/JSX/CSS) plus its source files.',
        '',
        'Active context: get_artifact, get_project, get_file, search_files,',
        'and list_files all accept project as OPTIONAL. When omitted, they',
        'default to the project the user has open in OD right now; get_file',
        'and get_artifact additionally default to the active file. So when',
        'the user says "this file" / "the design I have open" / "find X",',
        'just call the tool without project - no need to ask first. The',
        'response carries usedActiveContext so you can confirm which',
        'project/file you hit. Pass project explicitly to override.',
        '',
        'Pulling design context:',
        ' - get_artifact() - entry file PLUS every referenced sibling',
        '    (tokens CSS, JSX modules, imported assets) in one call.',
        '    PREFER THIS over multiple get_file calls when the user',
        '    wants to understand or extend a design.',
        ' - get_file(path) for a single known file. Returns up to 2000',
        '    lines starting at offset (default 0) and stamps a',
        '    [od:file-window ...] marker when the file is longer; page',
        '    by re-calling with the next offset.',
        ' - search_files(query) to find a class/component/copy string',
        '    without fetching every file.',
        ' - list_files for metadata only.',
        ' - create_artifact(name, content) to create one normal artifact',
        '    entry file in the active or specified project. It rejects',
        '    existing targets and can accept an artifactManifest sidecar.',
        ' - write_file(path, content) to overwrite or freshly create any',
        '    project file when an ArtifactManifest is not required.',
        '    Use this to iterate on a file create_artifact already wrote.',
        ' - delete_file(path) to remove one project file (nested paths ok).',
        ' - delete_project(project, confirm:true) for irreversible project',
        '    removal — requires explicit project + confirm:true.',
        ' - list_projects to discover what is available on this daemon.',
        ' - get_active_context() if you want the active project/file',
        '    explicitly without making any other tool call.',
        '',
        'To make Open Design GENERATE or refine a design (rather than just',
        'read/edit files), commission a run - you do not run skills yourself:',
        ' - list_skills / list_plugins to see what you can ask OD to make.',
        ' - list_agents when you need to pass start_run.agent — do not',
        '    guess "claude" / "codex" / "opencode"; only agents in the',
        '    returned list will actually spawn on this machine.',
        ' - create_project(name) first if you need a fresh project to',
        '    generate into; start_run requires an existing project.',
        ' - start_run(prompt, [skill], [plugin], [inputs]) kicks off generation in',
        '    the active or named project and returns a runId immediately.',
        '    Open Design spawns its own agent to do the work.',
        ' - get_run(runId) polls until status is succeeded/failed/canceled;',
        '    on success it returns a previewUrl you can open in a browser',
        '    and a hint to pull the files with get_artifact.',
        ' - cancel_run(runId) aborts an in-flight run.',
        '',
        'Generation patience: Open Design runs typically take 5–30',
        'minutes. Polls returning status:running with unchanged file',
        'mtimes is the inner agent thinking, not a hang. Do NOT cancel',
        'and substitute write_file as a "faster" workaround — that',
        'throws away the pipeline\'s design quality and is exactly the',
        'failure mode this surface is meant to avoid. Poll every 30–60',
        'seconds, tell the user "still working" between polls, and let',
        'the run finish. Only call cancel_run if the user explicitly',
        'asks you to abort.',
        '',
        'Ambiguous-format requests: words like "PPT" / "deck" / "slides" /',
        '"presentation" / "document" / "PDF" / "doc" map to two different',
        'deliverables — Open Design natively produces browser-viewable',
        'HTML/SVG (including HTML-rendered decks), but the user may want a',
        'real binary file (.pptx / .docx / .pdf) which Open Design does NOT',
        'produce and which you would have to export yourself from OD\'s',
        'output. When the user\'s request is ambiguous, ASK them which one',
        'they want before kicking off work; do not silently pick one and do',
        'not run both paths in parallel.',
        '',
        'Project arguments accept either a UUID or a name substring',
        '(e.g. "recaptr"); the server resolves the latter. When a project',
        'is matched by slug or substring the response carries',
        'resolvedProject:{id,name} so you can confirm which project was',
        'resolved. Verify with the user if the match was unexpected.',
        '',
        'Reference material is exposed as MCP resources, not tools - read',
        'od://design-systems/<id>/DESIGN.md when you need the brand spec',
        'for a design (palette, typography, voice). Skills are similarly',
        'available at od://skills/<id>/SKILL.md but are mostly relevant',
        'when the user asks about how a particular artifact was generated.',
        '',
        'When extending an Open Design design in another codebase, pull',
        'the full bundle once with get_artifact and work from those files',
        'locally - do not fetch files one-by-one if you can avoid it.',
      ].join('\n'),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, withMcpActivity(async () => ({
    tools: TOOL_DEFS,
  })));

  server.setRequestHandler(ListResourcesRequestSchema, withMcpActivity(async () => {
    const [skillsData, dsData] = await Promise.all([
      getJson<SkillsPayload>(`${baseUrl}/api/skills`).catch((): SkillsPayload => ({ skills: [] })),
      getJson<DesignSystemsPayload>(`${baseUrl}/api/design-systems`).catch((): DesignSystemsPayload => ({ designSystems: [] })),
    ]);
    const resources = [
      {
        uri: CHATGPT_WIDGET_URI,
        name: 'Open Design artifact card',
        description: 'Interactive account, progress, and artifact result card for ChatGPT.',
        mimeType: 'text/html;profile=mcp-app',
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { frameDomains: localWidgetFrameDomains },
          },
        },
      },
      {
        uri: 'od://focus/active',
        name: 'Active Open Design context',
        description: 'The project/file the user has open in Open Design right now.',
        mimeType: 'application/json',
      },
    ];
    for (const s of skillsData?.skills || []) {
      resources.push({
        uri: `od://skills/${encodeURIComponent(s.id)}/SKILL.md`,
        name: `Skill: ${s.name || s.id}`,
        description: oneLine(s.description) ?? '',
        mimeType: 'text/markdown',
      });
    }
    for (const d of dsData?.designSystems || []) {
      resources.push({
        uri: `od://design-systems/${encodeURIComponent(d.id)}/DESIGN.md`,
        name: `Design system: ${d.title || d.name || d.id}`,
        description: oneLine(d.summary) ?? '',
        mimeType: 'text/markdown',
      });
    }
    return { resources };
  }));

  server.setRequestHandler(ReadResourceRequestSchema, withMcpActivity(async (req) => {
    const uri = req.params?.uri;
    if (isChatGptWidgetResourceUri(uri)) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/html;profile=mcp-app',
            text: CHATGPT_WIDGET_HTML,
            _meta: {
              ui: {
                prefersBorder: true,
                csp: {
                  frameDomains: localWidgetFrameDomains,
                },
              },
            },
          },
        ],
      };
    }
    if (uri === 'od://focus/active') {
      const data = await getJson<ActiveContext>(`${baseUrl}/api/active`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
    const m = String(uri || '').match(/^od:\/\/(skills|design-systems)\/([^/]+)\/(.+)$/);
    if (!m) {
      throw new Error(`unsupported resource URI: ${uri}`);
    }
    const [, kind, id] = m as [string, 'skills' | 'design-systems', string, string];
    const route = kind === 'skills' ? 'skills' : 'design-systems';
    const data = await getJson<ResourcePayload>(
      `${baseUrl}/api/${route}/${encodeURIComponent(decodeURIComponent(id))}`,
    );
    const text =
      data?.skill?.body ??
      data?.skill?.content ??
      data?.designSystem?.body ??
      data?.designSystem?.content ??
      data?.body ??
      data?.content ??
      '';
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text,
        },
      ],
    };
  }));

  server.setRequestHandler(CallToolRequestSchema, withMcpActivity(async (req) => {
    const name = req.params?.name;
    const args: McpArgs = (req.params?.arguments ?? {}) as McpArgs;
    return handleMcpToolCall(baseUrl, name, args);
  }));

  const transport = new StdioServerTransport();
  try {
    closeTransportForIdle = () => {
      void transport.close().catch(() => {});
    };
    await server.connect(transport);

    const sdkOnMessage = transport.onmessage;
    transport.onmessage = (...args) => {
      idleExit.noteActivity();
      sdkOnMessage?.(...args);
    };

    // server.connect() only *starts* the transport; it resolves once the
    // stdio reader is wired up, not when the stream closes. Hold the
    // process open until the client disconnects (stdin EOF) so the cli.ts
    // top-level `process.exit(0)` doesn't kill us mid-handshake.
    await new Promise<void>((resolve) => {
      const sdkOnClose = transport.onclose;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        idleExit.dispose();
        resolve();
      };
      transport.onclose = () => {
        sdkOnClose?.();
        done();
      };
      const closeTransportForStdin = () => {
        void transport.close().catch(() => done());
      };
      process.stdin.once('end', closeTransportForStdin);
      process.stdin.once('close', closeTransportForStdin);
    });
  } finally {
    idleExit.dispose();
    closeTransportForIdle = null;
  }
}

export async function runChatGptMcpStdio({ daemonUrl }: RunMcpOptions): Promise<void> {
  const baseUrl = String(daemonUrl).replace(/\/$/, '');
  const server = createOpenDesignMcpServer({
    daemonUrl: baseUrl,
    widgetFrameDomains: [new URL(baseUrl).origin],
    widgetRedirectDomains: ['https://open-design.ai'],
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    const sdkOnClose = transport.onclose;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    transport.onclose = () => {
      sdkOnClose?.();
      done();
    };
    const closeTransportForStdin = () => {
      void transport.close().catch(() => done());
    };
    process.stdin.once('end', closeTransportForStdin);
    process.stdin.once('close', closeTransportForStdin);
  });
}

// Stateless transports (notably ChatGPT's Streamable HTTP client) need a
// fresh Server instance per request. The hosted surface deliberately exposes
// only the V1 product workflow; local file mutation, deletion, active-focus,
// and arbitrary artifact tools stay on `od mcp` and are not part of the
// public ChatGPT app contract.
export function createOpenDesignMcpServer({
  daemonUrl,
  widgetFrameDomains = [],
  widgetRedirectDomains = [],
  transformToolResult,
}: CreateOpenDesignMcpServerOptions): Server {
  const baseUrl = String(daemonUrl).replace(/\/$/, '');
  const frameDomains = [...new Set(['https://open-design.ai', ...widgetFrameDomains])];
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        'Open Design creates and refines websites, product prototypes, presentations, and design systems.',
        'Confirm audience, outcome, content/flows, visual direction, and output format before calling start_run with confirmed:true. If any field is missing, call collect_brief so the Custom UI form collects it; never emit <question-form> or JSON form markup as assistant text.',
        'Before Cloud generation call get_cloud_account. Use create_project, then start_run; its card polls get_run and updates in place.',
        'Open Design runs can take 5–30 minutes. Do not cancel unless the user asks.',
        'A browser-artifact run is delivered only when get_run returns status:succeeded plus artifactCount greater than zero and a real previewUrl. A Design System run instead requires status:succeeded plus artifactCount greater than zero.',
        'For a delivered website, prototype, or presentation, use the host in-app browser to open studioUrl and previewUrl in two separate tabs before replying. Never replace either with the Open Design root or /onboarding. If no in-app browser capability exists, show both as clickable links.',
        'Complex editing stays in Open Design.',
      ].join('\n'),
    },
  );

  const tools = TOOL_DEFS
    .filter((tool) => CHATGPT_V1_TOOL_NAMES.has(tool.name))
    .map(chatGptV1ToolDefinition);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const dsData = await getJson<DesignSystemsPayload>(`${baseUrl}/api/design-systems`)
      .catch((): DesignSystemsPayload => ({ designSystems: [] }));
    const resources = [
      {
        uri: CHATGPT_WIDGET_URI,
        name: 'Open Design artifact card',
        description: 'Interactive account, progress, and artifact result card for ChatGPT.',
        mimeType: 'text/html;profile=mcp-app',
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { frameDomains },
          },
        },
      },
      ...(dsData.designSystems ?? []).map((designSystem) => ({
        uri: `od://design-systems/${encodeURIComponent(designSystem.id)}/DESIGN.md`,
        name: `Design system: ${designSystem.title || designSystem.name || designSystem.id}`,
        description: oneLine(designSystem.summary) ?? '',
        mimeType: 'text/markdown',
      })),
    ];
    return { resources };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params?.uri;
    if (isChatGptWidgetResourceUri(uri)) {
      return {
        contents: [{
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: CHATGPT_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                frameDomains,
              },
            },
            ...(widgetRedirectDomains.length > 0
              ? {
                  'openai/widgetCSP': {
                    redirect_domains: [...new Set(widgetRedirectDomains)],
                  },
                }
              : {}),
          },
        }],
      };
    }
    const match = String(uri || '').match(/^od:\/\/(design-systems)\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`unsupported resource URI: ${uri}`);
    const [, kind, encodedId] = match as [string, 'design-systems', string, string];
    const decodedId = decodeURIComponent(encodedId);
    const data = await getJson<ResourcePayload>(
      `${baseUrl}/api/${kind}/${encodeURIComponent(decodedId)}`,
    );
    const text = data.skill?.body ?? data.skill?.content ?? data.designSystem?.body
      ?? data.designSystem?.content ?? data.body ?? data.content ?? '';
    return { contents: [{ uri, mimeType: 'text/markdown', text }] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name;
    if (typeof name !== 'string' || !CHATGPT_V1_TOOL_NAMES.has(name)) {
      return errorResult(`tool is outside the Open Design ChatGPT V1 scope: ${String(name ?? '')}`);
    }
    const args = (request.params?.arguments ?? {}) as McpArgs;
    const result = await handleChatGptV1ToolCall(baseUrl, name, args);
    const transformed = transformToolResult ? await transformToolResult(name, result) : result;
    return withChatGptWidgetResultMeta(name, transformed);
  });
  return server;
}

function chatGptV1ToolDefinition(tool: (typeof TOOL_DEFS)[number]): any {
  const requiredScopes = chatGptV1RequiredScopes(tool.name);
  const securitySchemes = tool.name === 'collect_brief'
    ? [{ type: 'noauth' }]
    : [{ type: 'oauth2', scopes: requiredScopes }];
  const authMeta = {
    ...tool._meta,
    securitySchemes,
    ui: {
      ...(tool._meta && typeof tool._meta === 'object' && 'ui' in tool._meta
        ? (tool._meta.ui as JsonObject)
        : {}),
      visibility: ['model', 'app'],
    },
    // MCP Apps `tools/call` is the primary bridge. Keep the ChatGPT-specific
    // compatibility flag so older Apps SDK hosts can also invoke polling,
    // version, restore, and export tools from the component.
    'openai/widgetAccessible': true,
  };
  const outputSchema = chatGptV1OutputSchema(tool.name);
  if (tool.name === 'start_run') {
    return {
      ...tool,
      securitySchemes,
      _meta: authMeta,
      outputSchema,
      description: 'Create or refine a V1 Open Design Cloud artifact from a confirmed structured brief. Choose the artifact type; the server selects the approved workflow and pins generation to Open Design Cloud. Returns immediately so get_run can report progress.',
      inputSchema: {
        type: 'object',
        properties: {
          project: PROJECT_ARG,
          artifactType: {
            type: 'string',
            enum: ['website', 'product-prototype', 'presentation', 'design-system'],
            description: 'The V1 deliverable type. The server maps it to the approved Open Design workflow.',
          },
          brief: {
            type: 'object',
            properties: {
              audience: { type: 'string', description: 'Who will use or view the artifact.' },
              outcome: { type: 'string', description: 'The result this artifact must achieve.' },
              contentAndFlows: { type: 'string', description: 'Required content, sections, product flows, and interactions.' },
              visualDirection: { type: 'string', description: 'Visual direction, references, brand constraints, or instruction to use the attached Design System.' },
              outputFormat: { type: 'string', description: 'Expected output, for example responsive website, interactive prototype, browser deck, PPTX-ready deck, or DESIGN.md.' },
              constraints: { type: 'string', description: 'Optional must-have or must-avoid constraints.' },
            },
            required: ['audience', 'outcome', 'contentAndFlows', 'visualDirection', 'outputFormat'],
            additionalProperties: false,
          },
          confirmed: {
            type: 'boolean',
            description: 'Must be true after the user has seen or already supplied the complete working brief.',
          },
        },
        required: ['project', 'artifactType', 'brief', 'confirmed'],
        additionalProperties: false,
      },
    };
  }
  if (tool.name === 'create_project') {
    return {
      ...tool,
      securitySchemes,
      _meta: authMeta,
      outputSchema,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable project name.' },
          id: { type: 'string', description: 'Optional project id slug.' },
          designSystem: { type: 'string', description: 'Optional Design System id to apply.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    };
  }
  return { ...tool, securitySchemes, _meta: authMeta, outputSchema };
}

function removePublicSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removePublicSecrets);
  if (!value || typeof value !== 'object') return value;
  const blocked = new Set([
    'eventslogpath',
    'accesstoken',
    'refreshtoken',
    'sessiontoken',
    'controlkey',
    'runtimekey',
    'apikey',
    'clientsecret',
    'authorization',
    'cookie',
  ]);
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([key]) => !blocked.has(key.replace(/[_-]/gu, '').toLowerCase()))
      .map(([key, child]) => [key, removePublicSecrets(child)]),
  );
}

function publicChatGptResult(name: string, result: any): any {
  if (!result?.structuredContent || typeof result.structuredContent !== 'object') return result;
  const structuredContent = removePublicSecrets(result.structuredContent) as JsonObject;
  if (name === 'start_run') {
    structuredContent.hint = 'Open Design Cloud is creating the artifact. Show the progress card and poll get_run every 30–60 seconds.';
  } else if (name === 'get_run' && ['queued', 'running'].includes(String(structuredContent.status))) {
    structuredContent.stage = structuredContent.status === 'queued' ? 'queued' : 'generating';
    structuredContent.hint = 'Open Design Cloud is still working. Keep the progress card visible and poll again in 30–60 seconds.';
  } else if (name === 'get_run') {
    // A V1 start_run always represents a confirmed artifact commission. The
    // daemon's `succeeded` status means the agent process completed cleanly;
    // it does not prove that a deliverable reached the project filesystem.
    // Never turn a clean process exit with zero touched artifacts into a
    // misleading Ready card.
    const isSucceeded = structuredContent.status === 'succeeded';
    const artifactCount = typeof structuredContent.artifactCount === 'number'
      ? structuredContent.artifactCount
      : 0;
    const isDesignSystemRun = structuredContent.skillId === 'design-md';
    const missingDeliverable = isSucceeded && artifactCount <= 0;
    const missingBrowserPreview = isSucceeded && !isDesignSystemRun && !structuredContent.previewUrl;
    const missingStudioUrl = isSucceeded && !structuredContent.studioUrl;
    if (missingDeliverable || missingBrowserPreview || missingStudioUrl) {
      structuredContent.status = 'failed';
      structuredContent.stage = 'failed';
      structuredContent.errorCode = missingDeliverable
        ? 'RUN_NO_DELIVERABLE'
        : missingBrowserPreview
          ? 'RUN_NO_PREVIEW'
          : 'RUN_NO_STUDIO_URL';
      structuredContent.error = missingDeliverable
        ? 'Open Design Cloud finished without creating or updating any project files.'
        : missingBrowserPreview
          ? 'Open Design Cloud wrote files but did not produce a reachable browser preview.'
          : 'Open Design Cloud produced files but could not resolve the exact Studio project URL.';
      structuredContent.retryable = true;
      structuredContent.hint = missingDeliverable
        ? 'Generation failed because no deliverable was written. Do not claim that an artifact is ready or offer a preview. Retry the run; if it repeats, report the Cloud tool failure.'
        : missingBrowserPreview
          ? 'Generation is incomplete because no reachable preview entry was produced. Do not claim that the Artifact is ready. Retry with an explicit HTML entry-file requirement.'
          : 'Generation is incomplete because the exact Open Design project URL is unavailable. Do not open the Open Design root or /onboarding as a substitute.';
      delete structuredContent.previewUrl;
      delete structuredContent.entryFile;
    } else {
      const terminalStage: Record<string, string> = { succeeded: 'ready', failed: 'failed', canceled: 'canceled' };
      if (terminalStage[String(structuredContent.status)]) structuredContent.stage = terminalStage[String(structuredContent.status)];
      if (isSucceeded && structuredContent.previewUrl) {
        structuredContent.hint = 'Delivery complete. Before replying, use the host in-app browser to open studioUrl and previewUrl in two separate tabs. Open these exact returned URLs; do not substitute the Open Design root or /onboarding.';
      } else if (isSucceeded && isDesignSystemRun) {
        structuredContent.hint = 'Delivery complete. Before replying, open the exact studioUrl in the host in-app browser; do not substitute the Open Design root or /onboarding.';
      }
    }
    const accountFailure = classifyAmrAccountFailure(JSON.stringify(structuredContent));
    if (accountFailure?.action === 'recharge') {
      structuredContent.accountAction = 'recharge';
      structuredContent.rechargeUrl = CHATGPT_RECHARGE_URL;
      structuredContent.nextAction = 'recharge';
      structuredContent.fallbackHint = 'After offering recharge, the user can open this project in Open Design and choose a local Code Agent or BYOK mode.';
    }
  }
  return {
    ...result,
    structuredContent,
    content: Array.isArray(result.content)
      ? result.content.map((item: any) => item?.type === 'text'
        ? { ...item, text: JSON.stringify(structuredContent, null, 2) }
        : item)
      : result.content,
  };
}

async function handleChatGptV1ToolCall(baseUrl: string, name: string, args: McpArgs): Promise<any> {
  if (name === 'collect_brief') {
    const artifactTypes = new Set(['website', 'product-prototype', 'presentation', 'design-system']);
    if (typeof args.artifactType !== 'string' || !artifactTypes.has(args.artifactType)) {
      return errorResult('artifactType must be website, product-prototype, presentation, or design-system.');
    }
    const brief = Object.fromEntries(
      ['audience', 'outcome', 'contentAndFlows', 'visualDirection', 'outputFormat', 'constraints']
        .filter((field) => typeof args[field] === 'string' && String(args[field]).trim())
        .map((field) => [field, String(args[field]).trim()]),
    );
    return ok({
      view: 'brief-form',
      artifactType: args.artifactType,
      title: typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : `New Open Design ${args.artifactType}`,
      brief,
    });
  }
  let callArgs = args;
  if (name === 'start_run') {
    const prepared = prepareChatGptV1Run(args);
    if ('error' in prepared) return errorResult(prepared.error);
    const account = await getCloudAccount(baseUrl);
    if (account.canUseCloud !== true) {
      const text = account.nextAction === 'recharge'
        ? 'Open Design Cloud balance is empty. Recharge before starting this run.'
        : account.nextAction === 'sign_in'
          ? 'Sign in to Open Design Cloud before starting this run.'
          : 'Open Design Cloud account status is unavailable. Retry the account check before starting this run.';
      return { isError: true, structuredContent: account, content: [{ type: 'text', text }] };
    }
    callArgs = {
      project: args.project,
      prompt: prepared.prompt,
      skill: prepared.skill,
      agent: 'amr',
    };
  }
  const result = await handleMcpToolCall(baseUrl, name, callArgs);
  if (name === 'start_run' && result?.structuredContent && typeof result.structuredContent === 'object') {
    result.structuredContent = {
      ...result.structuredContent,
      artifactType: args.artifactType,
      briefConfirmed: true,
      stage: result.structuredContent.status === 'queued' ? 'queued' : 'generating',
    };
  }
  return publicChatGptResult(name, result);
}

function prepareChatGptV1Run(args: McpArgs): { skill: string; prompt: string } | { error: string } {
  const skillByArtifact: Record<string, string> = {
    website: 'frontend-design',
    'product-prototype': 'frontend-design',
    presentation: 'slides',
    'design-system': 'design-md',
  };
  if (typeof args.artifactType !== 'string') {
    return { error: 'artifactType must be website, product-prototype, presentation, or design-system.' };
  }
  const skill = skillByArtifact[args.artifactType];
  if (!skill) return { error: 'artifactType must be website, product-prototype, presentation, or design-system.' };
  if (args.confirmed !== true) {
    return { error: 'confirmed:true is required after the user has supplied or approved the working brief.' };
  }
  if (!args.brief || typeof args.brief !== 'object' || Array.isArray(args.brief)) {
    return { error: 'brief is required.' };
  }
  const brief = args.brief as JsonObject;
  const required = ['audience', 'outcome', 'contentAndFlows', 'visualDirection', 'outputFormat'] as const;
  for (const field of required) {
    if (typeof brief[field] !== 'string' || !String(brief[field]).trim()) {
      return { error: `brief.${field} is required.` };
    }
  }
  const lines = [
    `Artifact type: ${args.artifactType}`,
    `Audience: ${brief.audience}`,
    `Outcome: ${brief.outcome}`,
    `Content and flows: ${brief.contentAndFlows}`,
    `Visual direction: ${brief.visualDirection}`,
    `Output format: ${brief.outputFormat}`,
    'Delivery contract: write the actual deliverable files inside the current project working directory. Project files are discovered automatically; there is no separate artifact registration command to run. For a browser artifact, create a real HTML entry file and verify it can be read back before finishing. If any write or verification tool reports an error, report that error and do not claim the file exists.',
  ];
  if (typeof brief.constraints === 'string' && brief.constraints.trim()) {
    lines.push(`Constraints: ${brief.constraints}`);
  }
  return { skill, prompt: lines.join('\n') };
}

function ok(payload: unknown) {
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return { structuredContent: payload as JsonObject, content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function requireString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${name} is required (string).`);
  }
}

// MCP tool results may contain text, embedded binary resources, or both. Keep
// this dynamic dispatcher broad at the boundary; every returned value is
// validated by the SDK's CallToolResult schema before it reaches a client.
async function handleMcpToolCall(baseUrl: string, name: unknown, args: McpArgs): Promise<any> {
  try {
    switch (name) {
      case 'list_projects':
        return ok(await getJson<ProjectsPayload>(`${baseUrl}/api/projects`));
      case 'get_active_context': {
        const data = await getJson<ActiveContext>(`${baseUrl}/api/active`);
        if (!data || data.active === false) {
          return ok({
            active: false,
            hint: 'Open Design has no active project right now. The active context expires about 5 minutes after the last user interaction with Open Design, so the user may need to click into a project (or switch tabs inside one) to wake it up. Alternatively, pass project="<id-or-name>" to other tools to bypass active context entirely.',
          });
        }
        return ok(data);
      }
      case 'get_project': {
        const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
        const data = await getJson<ProjectPayload>(`${baseUrl}/api/projects/${encodeURIComponent(id)}`);
        const project = data?.project ?? data;
        const resolvedDir = typeof data?.resolvedDir === 'string' ? data.resolvedDir : null;
        const declaredEntry = project?.metadata?.entryFile ?? null;
        const entryFile = await resolveProjectEntry(baseUrl, id, declaredEntry);
        const previewUrl = await validatePreviewUrl(rawPreviewUrl(baseUrl, id, entryFile));
        // Build the studio deep link too — needs the project's
        // default conversation, which we look up once. Cheap to skip
        // when the daemon has no webBaseUrl configured.
        const webBase = await getWebBaseUrl(baseUrl);
        const conversationId = webBase ? await getDefaultConversationId(baseUrl, id) : null;
        const studioUrl = buildStudioUrl(webBase, id, conversationId, entryFile);
        return ok(
          withActiveEcho(
            {
              ...project,
              entryFile,
              kind: project?.metadata?.kind ?? null,
              resolvedDir,
              // previewUrl: open in a browser to view the rendered
              // design directly (HTML entries render; see
              // rawPreviewUrl). studioUrl: open the OD studio page
              // that shows the rendered file alongside the chat
              // history for the project. Both omitted when their
              // prerequisites aren't met.
              ...(previewUrl ? { previewUrl } : {}),
              ...(studioUrl ? { studioUrl } : {}),
            },
            active,
            resolved,
          ),
        );
      }
      case 'list_files': {
        const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
        const params = new URLSearchParams();
        if (typeof args.since === 'number' && Number.isFinite(args.since)) params.set('since', String(args.since));
        const qs = params.toString();
        const url = `${baseUrl}/api/projects/${encodeURIComponent(id)}/files${qs ? `?${qs}` : ''}`;
        return ok(withActiveEcho(await getJson(url), active, resolved));
      }
      case 'get_file': {
        const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
        let path = typeof args.path === 'string' ? args.path : '';
        if (!path && active && active.fileName) {
          path = active.fileName;
        }
        requireString(path, 'path');
        const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0;
        const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : 2000;
        return await getFile(baseUrl, id, path, active, resolved, offset, limit);
      }
      case 'get_artifact':
        return await getArtifact(
          baseUrl,
          args.project,
          args.entry,
          args.include,
          args.maxBytes,
        );
      case 'search_files': {
        const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
        requireString(args.query, 'query');
        const params = new URLSearchParams({ q: String(args.query) });
        if (args.pattern) params.set('pattern', String(args.pattern));
        if (args.max) params.set('max', String(args.max));
        return ok(
          withActiveEcho(
            await getJson(
              `${baseUrl}/api/projects/${encodeURIComponent(id)}/search?${params.toString()}`,
            ),
            active,
            resolved,
          ),
        );
      }
      case 'create_artifact':
        return await createArtifact(baseUrl, args);
      case 'write_file':
        return await writeFile(baseUrl, args);
      case 'delete_file':
        return await deleteFile(baseUrl, args);
      case 'delete_project':
        return await deleteProject(baseUrl, args);
      case 'create_project':
        return await createProject(baseUrl, args);
      case 'get_cloud_account':
        return ok(await getCloudAccount(baseUrl));
      case 'list_skills':
        return ok(await getJson<SkillsPayload>(`${baseUrl}/api/skills`));
      case 'list_plugins':
        return ok(await listPlugins(baseUrl));
      case 'list_agents':
        return ok(await listAgents(baseUrl, args.includeUnavailable === true));
      case 'start_run':
        return await startRun(baseUrl, args);
      case 'get_run':
        return await getRun(baseUrl, args);
      case 'list_versions':
        return await listVersions(baseUrl, args);
      case 'restore_version':
        return await restoreVersion(baseUrl, args);
      case 'export_project':
        return await exportProject(baseUrl, args);
      case 'cancel_run': {
        requireString(args.runId, 'runId');
        return ok(
          await postJson<JsonObject>(
            `${baseUrl}/api/runs/${encodeURIComponent(args.runId)}/cancel`,
            {},
          ),
        );
      }
      default:
        return errorResult(`unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(formatError(err, baseUrl));
  }
}

async function getCloudAccount(baseUrl: string): Promise<JsonObject> {
  const [status, wallet] = await Promise.all([
    getJson<JsonObject>(`${baseUrl}/api/integrations/vela/status`),
    getJson<JsonObject>(`${baseUrl}/api/integrations/vela/wallet`).catch((error: unknown) => ({
      status: 'unavailable',
      error: { message: error instanceof Error ? error.message : String(error) },
    })),
  ]);
  const loggedIn = status.loggedIn === true;
  const walletRecord = wallet as JsonObject;
  const walletBalance = typeof walletRecord.balanceUsd === 'string' ? walletRecord.balanceUsd : null;
  const account = status.account && typeof status.account === 'object'
    ? status.account as JsonObject
    : null;
  const accountBalance = typeof account?.balanceUsd === 'string' ? account.balanceUsd : null;
  const balanceUsd = walletBalance ?? accountBalance;
  const parsedBalance = balanceUsd === null ? null : Number(balanceUsd);
  const balanceKnown = parsedBalance !== null && Number.isFinite(parsedBalance);
  const canUseCloud = loggedIn && balanceKnown ? parsedBalance > 0 : null;
  const nextAction = !loggedIn
    ? 'sign_in'
    : !balanceKnown
      ? 'retry_account'
      : canUseCloud
        ? 'generate'
        : 'recharge';
  return {
    loggedIn,
    user: status.user ?? null,
    account,
    wallet,
    balanceUsd,
    balanceStatus: !loggedIn ? 'signed_out' : !balanceKnown ? 'unavailable' : canUseCloud ? 'available' : 'empty',
    canUseCloud,
    nextAction,
    rechargeUrl: CHATGPT_RECHARGE_URL,
    fallback: {
      availableIn: 'Open Design',
      modes: ['local_code_agent', 'byok'],
    },
    hint: nextAction === 'generate'
      ? 'Open Design Cloud is connected and has a positive wallet balance. The ChatGPT app will use Cloud for the next run.'
      : nextAction === 'recharge'
        ? 'Open Design Cloud balance is empty. Offer recharge first. The user may instead open Open Design and choose a local Code Agent or BYOK mode.'
        : nextAction === 'sign_in'
          ? 'Open Design Cloud is not signed in. Complete Open Design authorization, then check the account again.'
          : 'Open Design Cloud wallet status is temporarily unavailable. Do not treat it as zero; retry before starting a paid run.',
  };
}

function encodeProjectRelativePath(filePath: string): string {
  return filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function resolveVersionPath(baseUrl: string, projectId: string, requested: unknown): Promise<string> {
  if (typeof requested === 'string' && requested.length > 0) return requested;
  const project = await getJson<ProjectPayload>(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}`);
  const entry = await resolveProjectEntry(baseUrl, projectId, project.project?.metadata?.entryFile ?? project.metadata?.entryFile ?? null);
  if (!entry) throw new Error('path is required because this project has no resolvable entry file');
  return entry;
}

async function listVersions(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  const filePath = await resolveVersionPath(baseUrl, id, args.path);
  const data = await getJson<JsonObject>(
    `${baseUrl}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelativePath(filePath)}/versions`,
  );
  return ok(withActiveEcho({ ...data, projectId: id, path: filePath }, active, resolved));
}

async function restoreVersion(baseUrl: string, args: McpArgs) {
  if (typeof args.project !== 'string' || !args.project) throw new Error('project is required');
  requireString(args.path, 'path');
  requireString(args.versionId, 'versionId');
  if (args.confirm !== true) return errorResult('confirm:true is required to restore a version');
  const { id, resolved } = await resolveProjectArg(baseUrl, args.project);
  const result = await postJson<JsonObject>(
    `${baseUrl}/api/projects/${encodeURIComponent(id)}/files/${encodeProjectRelativePath(args.path)}/versions/${encodeURIComponent(args.versionId)}/restore`,
    {},
  );
  return ok(withActiveEcho({ ...result, projectId: id, path: args.path }, null, resolved));
}

async function exportProject(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(id)}/archive`;
  const response = await fetch(url);
  if (!response.ok) return errorResult(await formatDaemonError(response, url));
  const bytes = Buffer.from(await response.arrayBuffer());
  const maxBytes = 12 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    return errorResult(`Project ZIP is ${bytes.length} bytes, above the ${maxBytes}-byte ChatGPT transfer limit. Open Open Design Studio to export it directly.`);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const fileName = encodedName ? decodeURIComponent(encodedName) : plainName || `${id}.zip`;
  const structuredContent = withActiveEcho({
    ok: true,
    projectId: id,
    fileName,
    mimeType: 'application/zip',
    bytes: bytes.length,
  }, active, resolved);
  return {
    structuredContent,
    content: [
      { type: 'text' as const, text: `Exported ${fileName} (${bytes.length} bytes).` },
      {
        type: 'resource' as const,
        resource: {
          uri: `od://exports/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`,
          mimeType: 'application/zip',
          blob: bytes.toString('base64'),
        },
      },
    ],
  };
}

async function writeFile(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  // The daemon route requires its argv field to be called `name`; the
  // MCP-facing surface uses `path` to match the rest of the file tools.
  requireString(args.path, 'path');
  requireString(args.content, 'content');
  const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
  // No `artifact: true` and no `overwrite: false`: the route then takes
  // the default writeProjectFile path, which overwrites the target. This
  // is the exact shape `od files write` uses (see apps/daemon/src/cli.ts).
  const url = `${baseUrl}/api/projects/${encodeURIComponent(id)}/files`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: args.path, content: args.content, encoding }),
  });
  if (!resp.ok) {
    return errorResult(await formatDaemonError(resp, url));
  }
  const json = (await resp.json()) as JsonObject;
  return ok(withActiveEcho(json, active, resolved));
}

async function deleteFile(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  requireString(args.path, 'path');
  // /api/projects/:id/raw/* accepts nested paths; /api/projects/:id/files/:name
  // does not. Mirror the create_artifact surface, which already lets agents
  // address files like "codex-product/index.html".
  const segments = args.path
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(id)}/raw/${segments.join('/')}`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok) {
    return errorResult(await formatDaemonError(resp, url));
  }
  const json = (await resp.json()) as JsonObject;
  return ok(withActiveEcho(json, active, resolved));
}

async function deleteProject(baseUrl: string, args: McpArgs) {
  // Active-context fallback is intentionally disabled: the daemon's
  // DELETE /api/projects/:id is irreversible (purges the row and the
  // on-disk project directory), so we never want it to fire against the
  // wrong project just because the user happened to have one open. The
  // confirm flag is a second belt for agents that auto-clean.
  if (typeof args.project !== 'string' || args.project.length === 0) {
    return errorResult('project is required (no active-context fallback for delete_project).');
  }
  if (args.confirm !== true) {
    return errorResult('confirm:true is required to delete a project (this cannot be undone).');
  }
  const { id, resolved } = await resolveProjectArg(baseUrl, args.project);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(id)}`;
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok) {
    return errorResult(await formatDaemonError(resp, url));
  }
  const json = (await resp.json()) as JsonObject;
  // The tool accepts a name substring (see resolveProjectId), so the
  // caller needs the resolvedProject echo to confirm which project was
  // actually destroyed — same contract write_file/delete_file follow
  // via withActiveEcho. active is always null here because the
  // active-context fallback is intentionally disabled above.
  return ok(withActiveEcho(json, null, resolved));
}

async function formatDaemonError(resp: Response, url: string): Promise<string> {
  const body = await safeText(resp);
  let detail = body || resp.statusText;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    if (parsed?.error?.message) {
      detail = `${parsed.error.code ?? 'error'}: ${parsed.error.message}`;
    }
  } catch {
    // body wasn't JSON; fall through with the raw text.
  }
  return `daemon ${resp.status} on ${url}: ${detail}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!resp.ok) {
    throw new Error(await formatDaemonError(resp, url));
  }
  return (await resp.json()) as T;
}

// Create an empty project to generate into. start_run needs an existing
// project; without this an external agent could only work on projects
// the user had already created in Open Design.
//
// skipDiscoveryBrief defaults to true: the outer agent (Codex, Cursor,
// …) IS the user-facing surface, so OD's own interactive discovery
// stage would create a confusing nested-clarification loop where OD's
// <question-form> output ends up dropped from the MCP response because
// no project file is produced. Better to let the outer agent gather
// requirements directly and pass a precise prompt to start_run.
async function createProject(baseUrl: string, args: McpArgs) {
  requireString(args.name, 'name');
  const id =
    typeof args.id === 'string' && args.id.length > 0
      ? args.id
      : slugifyProjectId(args.name);
  const body: JsonObject = { id, name: args.name, skipDiscoveryBrief: true };
  if (typeof args.designSystem === 'string' && args.designSystem.length > 0) {
    body.designSystemId = args.designSystem;
  }
  if (typeof args.skill === 'string' && args.skill.length > 0) {
    body.skillId = args.skill;
  }
  return ok(await postJson<JsonObject>(`${baseUrl}/api/projects`, body));
}

// Flatten daemon's plugin record into the few fields an external agent
// needs to pick a plugin: id, title, description, kind, tags. The raw
// record carries 16+ fields (fsPath, sourceMarketplaceId, installedAt,
// resolvedSource, …) that an agent never reasons about, and the
// human-readable description / kind live one level deeper in
// `manifest.description` / `manifest.od.kind`.
async function listPlugins(baseUrl: string): Promise<JsonObject> {
  const raw = await getJson<{ plugins?: JsonObject[] }>(`${baseUrl}/api/plugins`);
  const plugins = (raw?.plugins ?? []).map((p) => {
    const manifest = (p?.manifest as JsonObject | undefined) ?? {};
    const od = (manifest.od as JsonObject | undefined) ?? {};
    const result: JsonObject = {
      id: p?.id,
      title: manifest.title ?? p?.title ?? p?.id,
    };
    if (typeof manifest.description === 'string') result.description = manifest.description;
    const kind = od.taskKind ?? od.kind;
    if (typeof kind === 'string') result.kind = kind;
    if (Array.isArray(manifest.tags)) result.tags = manifest.tags;
    return result;
  });
  return { plugins };
}

// Flatten daemon's agent definition into the few fields an external
// agent needs to pick a value for start_run.agent. Default filters to
// `available: true` (only installed CLIs) so the outer agent doesn't
// pick an agent it can't actually run — the failure mode that left us
// with zombie "running" runs whose inner Claude binary never spawned.
// Models are truncated to 10 with `modelsCount` carrying the full
// total; that keeps the response token-economical even for agents
// (e.g. opencode) that expose 100+ models.
async function listAgents(baseUrl: string, includeUnavailable: boolean): Promise<JsonObject> {
  const raw = await getJson<{ agents?: JsonObject[] }>(`${baseUrl}/api/agents`);
  const all = raw?.agents ?? [];
  const filtered = includeUnavailable
    ? all
    : all.filter((a) => a?.available === true);
  const MAX_MODELS = 10;
  const agents = filtered.map((a) => {
    const models = Array.isArray(a?.models) ? (a.models as unknown[]) : [];
    const out: JsonObject = {
      id: a?.id,
      name: a?.name,
      models: models.slice(0, MAX_MODELS),
      modelsCount: models.length,
    };
    if (typeof a?.version === 'string' && a.version.length > 0) out.version = a.version;
    if (includeUnavailable) {
      out.available = Boolean(a?.available);
      if (typeof a?.installUrl === 'string') out.installUrl = a.installUrl;
    }
    return out;
  });
  return { agents };
}

// Derive a valid project id ([A-Za-z0-9._-], <=128) from a display name,
// with a short random suffix so repeated creates with the same name
// don't collide on the daemon's primary key.
function slugifyProjectId(name: string): string {
  const base =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) ||
    'project';
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 4)}`;
}

// Commission a generation run. The caller never runs the skill/plugin
// itself; we POST to /api/runs and the daemon spawns its own agent.
// Returns the runId immediately so the caller can poll get_run —
// start+poll because MCP is request/response and generation is
// minutes-long.
async function startRun(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  const body: JsonObject = { projectId: id };
  if (typeof args.prompt === 'string' && args.prompt.length > 0) body.message = args.prompt;
  if (typeof args.skill === 'string' && args.skill.length > 0) body.skillId = args.skill;
  if (typeof args.plugin === 'string' && args.plugin.length > 0) body.pluginId = args.plugin;
  if (typeof args.agent === 'string' && args.agent.length > 0) body.agentId = args.agent;
  if (typeof args.model === 'string' && args.model.length > 0) body.model = args.model;
  if (args.inputs !== undefined) {
    if (args.inputs === null || typeof args.inputs !== 'object' || Array.isArray(args.inputs)) {
      throw new Error('inputs must be an object');
    }
    body.pluginInputs = args.inputs;
  }
  const created = await postJson<JsonObject>(`${baseUrl}/api/runs`, body);
  // Build studioUrl (conversation-level — no entry file yet) so the
  // outer agent has a URL to give the user right away. The daemon
  // returns conversationId in the response now that POST /api/runs
  // falls back to the project's default conversation for MCP callers.
  const webBase = await getWebBaseUrl(baseUrl);
  const studioUrl = buildStudioUrl(webBase, id, created?.conversationId, null);
  return ok(
    withActiveEcho(
      {
        ...created,
        ...(studioUrl ? { studioUrl } : {}),
        hint: 'Run started. Open Design generation normally takes 5–30 minutes. Polls showing status:running with no new files / unchanged file mtimes is the inner agent thinking, NOT a hang — DO NOT cancel_run out of impatience and DO NOT substitute write_file to produce the design yourself; OD\'s pipeline is what gives the result its design quality. Poll get_run(runId) every 30–60 seconds; report "still working" to the user between polls and keep waiting. On terminal status the response carries previewUrl + agentMessage which together are the canonical deliverable. When studioUrl is present, ALWAYS show it to the user as a clickable markdown link: `[Open Open Design studio](STUDIO_URL)` — never as inline code or bare text, because Codex / Cursor / Zed render markdown links as navigable in their built-in browser pane and inline code blocks are not clickable.',
      },
      active,
      resolved,
    ),
  );
}

// Poll a run. On terminal status we enrich the daemon's status body
// with three things the outer agent needs to actually close the loop:
// (1) previewUrl when there's an entry file — open this in a browser,
// (2) agentMessage = the inner agent's textual output reassembled from
//     the SSE event stream, so when the inner agent asked a discovery
//     question back instead of producing files, the outer agent can
//     relay it to the user (without this, the run looks like a
//     "succeeded with empty output" mystery), and
// (3) a hint that tells the outer agent how to surface both.
async function getRun(baseUrl: string, args: McpArgs) {
  requireString(args.runId, 'runId');
  const status = await getJson<JsonObject>(
    `${baseUrl}/api/runs/${encodeURIComponent(args.runId)}`,
  );
  if (status.status !== 'succeeded' || typeof status.projectId !== 'string' || !status.projectId) {
    // Non-terminal (or terminal-but-failed) status. Surface
    // eventsLogPath with a tail hint so the outer agent can watch live
    // progress in its own shell instead of cancelling because polling
    // shows nothing changing.
    const webBase = await getWebBaseUrl(baseUrl);
    const studioUrl = buildStudioUrl(webBase, status.projectId, status.conversationId, null);
    const enriched: JsonObject = { ...status };
    if (studioUrl) enriched.studioUrl = studioUrl;
    if (typeof status.eventsLogPath === 'string' && status.eventsLogPath.length > 0) {
      enriched.hint = 'Run still in flight. Tail eventsLogPath in your own shell (e.g. `tail -n 50 -f "' + status.eventsLogPath + '"`) to see live text_delta / tool_use events from the inner agent — that is your in-flight progress signal. Keep polling get_run every 30–60s; do not cancel because file mtimes look static, that is the agent thinking between writes.';
      if (studioUrl) {
        enriched.hint += ` Once you have something to show the user, give them a clickable markdown link to studioUrl — render it as \`[Watch progress in Open Design studio](${studioUrl})\`, NEVER as inline code or bare text, so clients like Codex / Cursor / Zed make it navigable in their built-in browser pane.`;
      }
    }
    return ok(enriched);
  }
  const [previewUrl, agentMessage, webBase] = await Promise.all([
    buildRunPreviewUrl(baseUrl, status.projectId),
    fetchRunAgentMessage(baseUrl, String(status.id ?? args.runId)),
    getWebBaseUrl(baseUrl),
  ]);
  // Reverse-derive entryFile from previewUrl when present so we can
  // build a fully-specified studio link (project + conversation +
  // file) rather than just the conversation-level URL.
  const entryFile = previewUrl
    ? decodeURIComponent(previewUrl.split('/raw/')[1] ?? '')
    : null;
  const studioUrl = buildStudioUrl(webBase, status.projectId, status.conversationId, entryFile);
  const enriched: JsonObject = { ...status };
  if (previewUrl) enriched.previewUrl = previewUrl;
  if (agentMessage) enriched.agentMessage = agentMessage;
  if (studioUrl) enriched.studioUrl = studioUrl;
  enriched.hint = previewUrl
    ? `Run finished. studioUrl (when present) is the BEST link to hand the user — it opens the OD studio page that shows the rendered design AND the chat history (your prompts and the inner agent's replies) side by side. ALWAYS render studioUrl as a clickable markdown link: \`[Open Open Design studio](STUDIO_URL)\` — never as inline code or bare text, because clients like Codex / Cursor / Zed render markdown links as navigable in their built-in browser pane and inline code blocks are not clickable. previewUrl is the raw file URL if the user only wants the rendered output. agentMessage carries the inner agent's explanation; show it alongside the link. Call get_artifact({ project: "${status.projectId}" }) when you need the source files — always pass project explicitly; omitting it falls back to the active project, which may differ. eventsLogPath, when present, holds the full inner-agent event log for forensics.`
    : 'Run finished but produced no files. The inner agent\'s output is in agentMessage — relay it to the user verbatim. Most often this is a clarifying question (e.g. a <question-form>) you should answer by calling start_run again with a more specific prompt or a chosen plugin. When studioUrl is present, show it as a clickable markdown link (`[Open Open Design studio](STUDIO_URL)`) so the user can navigate to the OD page that shows the chat history — never render it as inline code. eventsLogPath, when present, holds the full event log if you need to inspect what happened.';
  return ok(enriched);
}

// Reassemble the inner agent's textual output from the SSE event log.
// We pull the events one-shot (the endpoint returns the full history
// for terminal runs and closes), parse out text_delta deltas, and
// concatenate. Best-effort: any HTTP / parse error returns null so the
// caller just omits the field.
async function fetchRunAgentMessage(baseUrl: string, runId: string): Promise<string | null> {
  try {
    const resp = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}/events`);
    if (!resp.ok) return null;
    const body = await resp.text();
    const parts: string[] = [];
    for (const block of body.split(/\n\n/)) {
      if (!block.trim()) continue;
      let eventName = '';
      let dataLine = '';
      for (const rawLine of block.split('\n')) {
        if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim();
        else if (rawLine.startsWith('data:')) dataLine = rawLine.slice(5).trim();
      }
      if (eventName !== 'agent' || !dataLine) continue;
      try {
        const data = JSON.parse(dataLine) as { type?: string; delta?: unknown };
        if (data?.type === 'text_delta' && typeof data.delta === 'string') {
          parts.push(data.delta);
        }
      } catch {
        // Non-JSON data lines (rare) are skipped silently.
      }
    }
    const message = parts.join('');
    return message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

// Studio deep links (browser-facing OD page that shows the file
// preview alongside the conversation history for a run). Built from
// the daemon's advertised webBaseUrl + project + conversation + entry
// file. The webBaseUrl is exposed by /api/mcp/install-info; we cache
// it briefly because each get_run/get_project poll otherwise pays for
// an extra fetch. Returns null when any required piece is missing —
// callers omit the field rather than emit a half-built URL.

interface WebBaseUrlCache {
  t: number;
  url: string | null;
}
const WEB_BASE_URL_TTL_MS = 5_000;
let webBaseUrlCache: WebBaseUrlCache | null = null;

// Internal — for tests only. Module-scoped caches persist across `it`
// blocks inside the same vitest module load, so an earlier test that
// returns `null` would otherwise poison subsequent tests for 5s. Test
// files call this in afterEach to start each case with a clean cache.
export function _resetWebBaseUrlCache(): void {
  webBaseUrlCache = null;
}

async function getWebBaseUrl(daemonBaseUrl: string): Promise<string | null> {
  const now = Date.now();
  if (webBaseUrlCache && now - webBaseUrlCache.t < WEB_BASE_URL_TTL_MS) {
    return webBaseUrlCache.url;
  }
  try {
    const data = await getJson<{ webBaseUrl?: string | null }>(
      `${daemonBaseUrl}/api/mcp/install-info`,
    );
    const url =
      typeof data?.webBaseUrl === 'string' && data.webBaseUrl.length > 0
        ? data.webBaseUrl
        : null;
    webBaseUrlCache = { t: now, url };
    return url;
  } catch {
    webBaseUrlCache = { t: now, url: null };
    return null;
  }
}

function buildStudioUrl(
  webBaseUrl: string | null,
  projectId: unknown,
  conversationId: unknown,
  entryFile: unknown,
): string | null {
  if (!webBaseUrl) return null;
  if (typeof projectId !== 'string' || !projectId) return null;
  if (typeof conversationId !== 'string' || !conversationId) return null;
  const base = `${webBaseUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`;
  if (typeof entryFile === 'string' && entryFile.length > 0) {
    const segments = entryFile
      .split('/')
      .filter((s) => s.length > 0)
      .map(encodeURIComponent)
      .join('/');
    return `${base}/files/${segments}`;
  }
  return base;
}

// For get_project / start_run: pick the project's first / default
// conversation so the studio link lands the user on a coherent page.
// create_project seeds a default conversation per project; this just
// reads the same one back. Returns null on any lookup failure — caller
// omits studioUrl.
async function getDefaultConversationId(baseUrl: string, projectId: string): Promise<string | null> {
  try {
    const data = await getJson<{ conversations?: Array<{ id?: string }> }>(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/conversations`,
    );
    const first = Array.isArray(data?.conversations) ? data.conversations[0] : null;
    return typeof first?.id === 'string' && first.id.length > 0 ? first.id : null;
  } catch {
    return null;
  }
}

// Resolve a project's entry file, preferring metadata.entryFile when
// set and falling back to scanning the file list. This matters because
// real-world writes (write_file, half-finished inner-agent runs)
// leave metadata.entryFile null even when a perfectly viewable
// index.html exists at the project root — without the fallback,
// get_project/get_run would silently omit previewUrl and force the
// outer agent to guess a file:// path.
async function resolveProjectEntry(baseUrl: string, projectId: string, declared: unknown): Promise<string | null> {
  if (typeof declared === 'string' && declared.length > 0) return declared;
  try {
    const data = await getJson<{ files?: Array<{ path?: string; name?: string; kind?: string }> }>(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/files`,
    );
    const files = data?.files ?? [];
    // index.html wins at any level — the conventional entry signal.
    const indexHtml = files.find((f) => f?.path === 'index.html' || f?.name === 'index.html');
    if (indexHtml?.path) return indexHtml.path;
    // Otherwise: if exactly one .html sits at the project root, that
    // is unambiguous enough to pick. Don't guess past one match.
    const htmlAtRoot = files.filter(
      (f) => typeof f?.path === 'string' && !f.path.includes('/') && f.path.toLowerCase().endsWith('.html'),
    );
    if (htmlAtRoot.length === 1 && htmlAtRoot[0]?.path) return htmlAtRoot[0].path;
    return null;
  } catch {
    return null;
  }
}

// Build the raw URL that renders a project's entry file. The raw route
// serves it with the right Content-Type and resolves sibling
// CSS/JS/img relative to the same dir, so this URL opens directly in a
// browser (HTML entries render; bare JSX entries that rely on
// host-injected React/Babel do not — those still need the Open Design
// UI). Returns null when there's no entry file. Pure: no I/O, so
// get_project can call it from project data it already has.
function rawPreviewUrl(baseUrl: string, projectId: string, entry: unknown): string | null {
  return buildProjectRawFileUrl(baseUrl, projectId, entry);
}

async function validatePreviewUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/html')) {
      try {
        await response.body?.cancel();
      } catch {
        // The response is already rejected as a browser preview.
      }
      return null;
    }
    try {
      await response.body?.cancel();
    } catch {
      // The successful HTML response already proved that the entry is reachable.
    }
    return url;
  } catch {
    return null;
  }
}

// Best-effort variant for get_run, which only has a projectId: fetch the
// project, then build the URL. Returns null on any lookup failure — the
// run result is still reachable via get_artifact, so this is a
// convenience only.
async function buildRunPreviewUrl(baseUrl: string, projectId: string): Promise<string | null> {
  try {
    const data = await getJson<ProjectPayload>(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}`,
    );
    const project = data?.project ?? data;
    const declared = (project as { metadata?: JsonObject } | undefined)?.metadata?.entryFile;
    const entry = await resolveProjectEntry(baseUrl, projectId, declared);
    return await validatePreviewUrl(rawPreviewUrl(baseUrl, projectId, entry));
  } catch {
    return null;
  }
}

async function createArtifact(baseUrl: string, args: McpArgs) {
  const { id, resolved, active } = await resolveProjectArg(baseUrl, args.project);
  requireString(args.name, 'name');
  requireString(args.content, 'content');
  if (
    args.artifactManifest !== undefined &&
    (args.artifactManifest === null ||
      typeof args.artifactManifest !== 'object' ||
      Array.isArray(args.artifactManifest))
  ) {
    throw new Error('artifactManifest must be an object');
  }
  const artifactManifest =
    args.artifactManifest
      ? args.artifactManifest
      : undefined;
  const payload = await postCreateArtifactRequest({
    baseUrl,
    projectId: id,
    input: {
      name: args.name,
      content: args.content,
      encoding: args.encoding === 'base64' ? 'base64' : 'utf8',
      ...(artifactManifest === undefined ? {} : { artifactManifest }),
    },
  });
  const result = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as JsonObject)
    : { result: payload };
  return ok(withActiveEcho(result, active, resolved));
}

// Resource description renderers in some MCP UIs collapse whitespace
// poorly; keep our descriptions on a single line so they don't break
// the catalog list layout.
function oneLine(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  return s.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Short-lived cache for the project list. A typical agent session
// makes several name-based lookups in quick succession; without this
// each one re-fetches /api/projects. The TTL is short so a project
// renamed in the Open Design UI shows up within a few seconds.
const PROJECT_LIST_TTL_MS = 5000;
let projectListCache: ProjectListCache | null = null;

async function fetchProjectList(baseUrl: string): Promise<ProjectSummary[]> {
  const now = Date.now();
  if (
    projectListCache &&
    projectListCache.baseUrl === baseUrl &&
    now - projectListCache.t < PROJECT_LIST_TTL_MS
  ) {
    return projectListCache.list;
  }
  const data = await getJson<ProjectsPayload>(`${baseUrl}/api/projects`);
  const list = Array.isArray(data?.projects) ? data.projects : [];
  projectListCache = { baseUrl, t: now, list };
  return list;
}

// When the agent omits `project`, fall back to whatever the user has
// open in Open Design. Returns the resolved id plus, for echo-back to the
// caller, the active-context payload that was used. Throws a clear
// error when neither is available so the agent can prompt the user
// rather than guessing.
async function resolveProjectArg(baseUrl: string, arg: unknown): Promise<{ id: string; resolved: ResolvedProject | null; active: ActiveContext | null }> {
  if (typeof arg === 'string' && arg.length > 0) {
    const resolved = await resolveProjectId(baseUrl, arg);
    return { id: resolved.id, resolved, active: null };
  }
  let active: ActiveContext;
  try {
    active = await getJson<ActiveContext>(`${baseUrl}/api/active`);
  } catch (err) {
    throw new Error(
      `project arg omitted and active context lookup failed: ${errorMessage(err)}. Pass project="<id-or-name>".`,
    );
  }
  if (!active || active.active === false || !active.projectId) {
    throw new Error(
      'project arg omitted and Open Design has no active project. The active context expires about 5 minutes after the last user interaction with Open Design - the user may need to click into a project to wake it up. Otherwise pass project="<id-or-name>".',
    );
  }
  return { id: active.projectId, resolved: null, active };
}

async function resolveProjectId(baseUrl: string, arg: unknown): Promise<ResolvedProject> {
  if (typeof arg !== 'string' || !arg) {
    throw new Error('project is required (string).');
  }
  if (UUID_RE.test(arg)) return { id: arg, name: arg, source: 'uuid' as const };

  const list = await fetchProjectList(baseUrl);
  if (list.length === 0) {
    throw new Error('no projects on this daemon');
  }

  const lower = arg.toLowerCase();
  const norm = (s: unknown): string =>
    String(s || '')
      .toLowerCase()
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/[\s_-]+/g, '-');
  const target = norm(arg);

  const idMatch = list.find((p) => p.id === arg);
  if (idMatch) return { id: idMatch.id, name: idMatch.name, source: 'id' as const };

  const exact = list.filter((p) => String(p.name || '').toLowerCase() === lower);
  if (exact.length === 1) { const p = exact[0]!; return { id: p.id, name: p.name, source: 'exact' as const }; }

  const slugged = list.filter((p) => norm(p.name) === target);
  if (slugged.length === 1) { const p = slugged[0]!; return { id: p.id, name: p.name, source: 'slug' as const }; }

  const subs = list.filter((p) =>
    String(p.name || '').toLowerCase().includes(lower),
  );
  if (subs.length === 1) { const p = subs[0]!; return { id: p.id, name: p.name, source: 'substring' as const }; }
  if (subs.length > 1) {
    const opts = subs.map((p) => `${p.name} (${p.id})`).join(', ');
    throw new Error(
      `multiple projects match "${arg}": ${opts}. Pass the UUID instead.`,
    );
  }
  throw new Error(`no project matches "${arg}"`);
}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`daemon ${resp.status} on ${url}: ${body || resp.statusText}`);
  }
  return (await resp.json()) as T;
}

async function getFile(baseUrl: string, project: string, relPath: string, active: ActiveContext | null, resolved?: ResolvedProject | null, offset = 0, limit = 2000) {
  const segments = String(relPath)
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(project)}/raw/${segments.join('/')}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await safeText(resp);
    return errorResult(
      `daemon ${resp.status} on ${url}: ${body || resp.statusText}`,
    );
  }
  const mime = ((resp.headers.get('content-type') || 'application/octet-stream').split(';')[0] ?? 'application/octet-stream').trim();
  if (!isTextualMime(mime)) {
    return errorResult(
      `file at "${relPath}" has mime "${mime}"; binary content is not yet supported by od mcp. Use list_files to inspect its metadata.`,
    );
  }
  const text = await resp.text();
  const allLines = text.split('\n');
  const totalLines = allLines.length;
  const start = Math.min(offset, totalLines);
  const slice = allLines.slice(start, start + limit);
  const returnedLines = slice.length;
  const truncated = start + returnedLines < totalLines;

  const extra: string[] = [];
  if (active) extra.push(formatActiveEchoLine(active, relPath));
  if (resolved && (resolved.source === 'slug' || resolved.source === 'substring')) {
    extra.push(`[od:resolved-project id="${resolved.id}" name="${resolved.name}" via="${resolved.source}"]`);
  }
  if (truncated || start > 0) {
    const nextOffset = start + returnedLines;
    const next = truncated ? `; call get_file again with offset=${nextOffset} to read more` : '';
    extra.push(
      `[od:file-window offset=${start} returnedLines=${returnedLines} totalLines=${totalLines}${next}]`,
    );
  }
  return {
    content: [
      ...extra.map((t) => ({ type: 'text', text: t })),
      { type: 'text', text: slice.join('\n') },
    ],
  };
}

// Stamp `usedActiveContext` onto JSON tool responses when the
// project came from /api/active. Plain pass-through when the caller
// supplied project explicitly - keeps token overhead at zero for the
// explicit path.
function withActiveEcho<T extends JsonObject>(payload: T, active: ActiveContext | null, resolved?: ResolvedProject | null): T & JsonObject {
  const result = active ? { ...payload, usedActiveContext: activeEchoPayload(active) } : payload;
  if (resolved && (resolved.source === 'slug' || resolved.source === 'substring')) {
    return { ...result, resolvedProject: { id: resolved.id, name: resolved.name } };
  }
  return result;
}

function activeEchoPayload(active: ActiveContext) {
  return {
    projectId: active.projectId,
    projectName: active.projectName ?? null,
    fileName: active.fileName ?? null,
    ageMs: active.ageMs ?? null,
  };
}

function formatActiveEchoLine(active: ActiveContext, resolvedPath: string): string {
  const proj = active.projectName || active.projectId;
  const note = `[od:active-context project="${proj}" file="${resolvedPath}"]`;
  return active.fileName === resolvedPath
    ? note
    : `${note} (active file: ${active.fileName ?? 'none'})`;
}

const VALID_INCLUDE_MODES = new Set(['auto', 'all', 'shallow']);
const DEFAULT_MAX_BYTES = 1_500_000;
const MAX_FILES = 200;

// Tracks total textual content bytes accumulated; binary stubs don't
// count (their content is null). Once we cross the cap the caller
// stops fetching and stamps `truncated: true` on the bundle.
function totalTextBytes(files: ProjectFileBundleEntry[]): number {
  let n = 0;
  for (const f of files) {
    if (!f.binary && typeof f.content === 'string') n += f.content.length;
  }
  return n;
}

async function getArtifact(baseUrl: string, projectArg: unknown, entryArg: unknown, includeMode: unknown, maxBytesArg: unknown) {
  const include = includeMode == null || includeMode === '' ? 'auto' : includeMode;
  if (typeof include !== 'string' || !VALID_INCLUDE_MODES.has(include)) {
    return errorResult(
      `invalid include "${includeMode}"; expected one of: auto, all, shallow`,
    );
  }
  const maxBytes =
    typeof maxBytesArg === 'number' && Number.isFinite(maxBytesArg) && maxBytesArg > 0 ? maxBytesArg : DEFAULT_MAX_BYTES;

  const { id, active, resolved } = await resolveProjectArg(baseUrl, projectArg);
  const data = await getJson<ProjectPayload>(`${baseUrl}/api/projects/${encodeURIComponent(id)}`);
  const project = (data.project ?? data) as ProjectSummary;
  // Active-file beats project default entry when project also came
  // from active context - if the user is on landing.html and asks
  // "bundle this", they mean landing.html, not whatever
  // metadata.entryFile happens to be.
  const explicitEntry = typeof entryArg === 'string' && entryArg.length > 0;
  const metadataEntry = typeof project.metadata?.entryFile === 'string' ? project.metadata.entryFile : undefined;
  const entry: string | undefined = explicitEntry
    ? String(entryArg)
    : (active && active.fileName) || metadataEntry;
  if (!entry) {
    return errorResult(
      `no entry file: pass entry="..." or set the project's metadata.entryFile`,
    );
  }

  if (include === 'shallow') {
    let file;
    try {
      file = await fetchProjectFile(baseUrl, id, entry);
    } catch (err) {
      return errorResult(errorMessage(err));
    }
    return okBundle({ project, entry, files: [file], truncated: false, active, resolved });
  }

  if (include === 'all') {
    const meta = await getJson<{ files?: Array<{ name: string }> }>(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    const allFiles = Array.isArray(meta?.files) ? meta.files : [];
    const fetched: ProjectFileBundleEntry[] = [];
    let truncated = false;
    for (const f of allFiles) {
      if (fetched.length >= MAX_FILES || totalTextBytes(fetched) >= maxBytes) {
        truncated = true;
        break;
      }
      try {
        const remaining = maxBytes - totalTextBytes(fetched);
        fetched.push(await fetchProjectFile(baseUrl, id, f.name, remaining));
      } catch (err) {
        if (err instanceof BudgetExceededError) truncated = true;
        // Skip files that fail to fetch; keep going.
      }
    }
    return okBundle({ project, entry, files: fetched, truncated, active, resolved });
  }

  // Auto mode: BFS from entry. The entry's own fetch must succeed - 
  // a 404 there almost always means the agent typo'd `entry:`, and
  // returning an empty bundle would hide that.
  let entryFile;
  try {
    entryFile = await fetchProjectFile(baseUrl, id, entry);
  } catch (err) {
    return errorResult(errorMessage(err));
  }
  const MAX_DEPTH = 3;
  const visited = new Set([entry]);
  const fetched = [entryFile];
  let truncated = false;
  let frontier: string[] = [];
  if (isTextualMime(entryFile.mime)) {
    frontier = extractRelativeRefs(entryFile.content || '', entry, entryFile.mime).filter(
      (r) => !visited.has(r),
    );
  }
  outer: for (let depth = 1; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const refPath of frontier) {
      if (visited.has(refPath)) continue;
      visited.add(refPath);
      if (fetched.length >= MAX_FILES || totalTextBytes(fetched) >= maxBytes) {
        truncated = true;
        break outer;
      }
      let file;
      try {
        const remaining = maxBytes - totalTextBytes(fetched);
        file = await fetchProjectFile(baseUrl, id, refPath, remaining);
      } catch (err) {
        if (err instanceof BudgetExceededError) truncated = true;
        continue;
      }
      fetched.push(file);
      if (!isTextualMime(file.mime)) continue;
      const refs = extractRelativeRefs(file.content || '', refPath, file.mime);
      for (const ref of refs) {
        if (!visited.has(ref)) next.push(ref);
      }
    }
    frontier = next;
  }
  return okBundle({ project, entry, files: fetched, truncated, active, resolved });
}

// Thrown by fetchProjectFile when the server-advertised content-length exceeds
// the remaining byte budget. Distinguished from generic fetch errors (404,
// network) so callers can set truncated: true without treating it as a hard
// failure of the whole bundle.
class BudgetExceededError extends Error {}

async function fetchProjectFile(baseUrl: string, projectId: string, relPath: string, remainingBytes = Infinity): Promise<ProjectFileBundleEntry> {
  const segments = String(relPath)
    .split('/')
    .filter((s) => s.length > 0)
    .map(encodeURIComponent);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/raw/${segments.join('/')}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`daemon ${resp.status} on ${url}: ${body || resp.statusText}`);
  }
  const mime = ((resp.headers.get('content-type') || 'application/octet-stream').split(';')[0] ?? 'application/octet-stream').trim();
  const headerSize = Number(resp.headers.get('content-length'));
  const size = Number.isFinite(headerSize) && headerSize >= 0 ? headerSize : null;
  if (!isTextualMime(mime)) {
    return { name: relPath, mime, size, content: null, binary: true };
  }
  // If the server advertises a size that already exceeds our remaining
  // budget, skip reading the body to avoid a large allocation.
  if (size !== null && size > remainingBytes) {
    throw new BudgetExceededError(`file ${relPath} (${size} bytes) exceeds remaining budget`);
  }
  const content = await resp.text();
  return { name: relPath, mime, size: size ?? content.length, content, binary: false };
}

// Patterns common to HTML and CSS (also fine to run on plain markdown).
const HTML_REF_PATTERNS = [
  /<script\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<link\b[^>]*\bhref=["']([^"']+)["']/gi,
  /<img\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<source\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<video\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<audio\b[^>]*\bsrc=["']([^"']+)["']/gi,
  /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi,
];

const CSS_REF_PATTERNS = [
  /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
  /@import\s+(?:url\()?\s*["']([^"')]+)["']/gi,
];

// JS/TS only - running these on prose creates false positives on words
// like "imported from 'X'".
const JS_REF_PATTERNS = [
  /\bimport\s+[^'"]*?['"]([^'"]+)['"]/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// `srcset` can list multiple comma-separated candidates.
const SRCSET_PATTERN = /\bsrcset=["']([^"']+)["']/gi;

function isJsLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /javascript|typescript/i.test(mime)) return true;
  return /\.(?:m?jsx?|tsx?|cjs)$/i.test(fromPath);
}

function isCssLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/css\b/i.test(mime)) return true;
  return /\.css$/i.test(fromPath);
}

function isHtmlLike(mime: string | undefined, fromPath: string): boolean {
  if (mime && /^text\/html\b/i.test(mime)) return true;
  return /\.html?$/i.test(fromPath);
}

function extractRelativeRefs(text: string, fromPath: string, fromMime: string): string[] {
  if (!text) return [];
  const refs = new Set<string>();
  const runPatterns: RegExp[] = [];
  if (isHtmlLike(fromMime, fromPath)) {
    runPatterns.push(...HTML_REF_PATTERNS, ...CSS_REF_PATTERNS);
  }
  if (isCssLike(fromMime, fromPath)) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }
  if (isJsLike(fromMime, fromPath)) {
    runPatterns.push(...JS_REF_PATTERNS);
  }
  // Fallback for unknown textual files: only the safest pattern,
  // url() in case it's a CSS-in-something we don't recognize.
  if (runPatterns.length === 0) {
    runPatterns.push(...CSS_REF_PATTERNS);
  }

  const candidates: string[] = [];
  for (const re of runPatterns) {
    for (const m of text.matchAll(re)) {
      const ref = (m[1] || '').trim();
      if (ref) candidates.push(ref);
    }
  }
  // Pull every candidate URL out of any srcset attributes in HTML.
  if (isHtmlLike(fromMime, fromPath)) {
    for (const m of text.matchAll(SRCSET_PATTERN)) {
      const list = m[1] || '';
      for (const part of list.split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      }
    }
  }

  for (const raw of candidates) {
    if (/^(?:https?:|\/\/|data:|mailto:|tel:|#)/i.test(raw)) continue;
    const dir = fromPath.includes('/')
      ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1)
      : '';
    const resolved = raw.startsWith('/') ? raw.slice(1) : dir + raw;
    const stripped = resolved.replace(/[?#].*$/, '');
    const segs = stripped.split('/').filter(Boolean);
    const out: string[] = [];
    let escaped = false;
    for (const s of segs) {
      if (s === '.') continue;
      if (s === '..') {
        if (out.length === 0) { escaped = true; break; }
        out.pop();
        continue;
      }
      out.push(s);
    }
    if (escaped || out.length === 0) continue;
    refs.add(out.join('/'));
  }
  return [...refs];
}

function okBundle(bundle: BundleInput) {
  const payload = {
    entryFile: bundle.entry,
    projectId: bundle.project?.id,
    projectName: bundle.project?.name,
    truncated: bundle.truncated === true,
    files: bundle.files.map((f) => ({
      name: f.name,
      mime: f.mime,
      size: f.size,
      binary: f.binary === true,
      content: f.binary ? null : f.content,
    })),
    manifest: bundle.project?.metadata ?? null,
  };
  return ok(withActiveEcho(payload, bundle.active, bundle.resolved));
}

function isTextualMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return TEXTUAL_MIME_PATTERNS.some((re) => re.test(mime));
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function formatError(err: unknown, daemonUrl: string): string {
  const e = err as ErrorWithCode | null | undefined;
  const code = e && (e.cause?.code || e.code);
  const msg = errorMessage(err);
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return `cannot reach the Open Design daemon at ${daemonUrl}. Is it running? Start it with \`pnpm tools-dev\`.`;
  }
  return msg;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Exported for unit tests only.
export { extractRelativeRefs, resolveProjectId, resolveProjectArg, withActiveEcho, fetchProjectFile, getArtifact, getFile, createArtifact, handleMcpToolCall };
