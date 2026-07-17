#!/usr/bin/env node

import { createServer } from 'node:http';

const WIDGET_URI = 'ui://open-design/artifact-card-v7.html';

interface JsonRpcResponse {
  error?: { message?: string };
  result?: Record<string, unknown>;
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
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

async function readWidget(endpoint: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: WIDGET_URI },
    }),
  });
  const body = parseMcpBody(await response.text(), response.headers.get('content-type') ?? '');
  if (!response.ok || body.error) throw new Error(body.error?.message || `MCP returned HTTP ${response.status}`);
  const contents = body.result?.contents as Array<Record<string, unknown>> | undefined;
  const html = contents?.find((content) => content.uri === WIDGET_URI)?.text;
  if (typeof html !== 'string') throw new Error(`MCP resource ${WIDGET_URI} is missing`);
  return html;
}

function stateOutput(state: string, origin: string): Record<string, unknown> {
  if (state === 'brief') {
    return {
      view: 'brief-form',
      artifactType: 'website',
      title: 'Launch website',
      brief: {
        audience: 'Product teams evaluating AI design tools',
        outcome: 'Explain the product clearly and convert qualified visitors.',
        outputFormat: 'Responsive browser website',
      },
    };
  }
  if (state === 'account') {
    return {
      loggedIn: false,
      balanceStatus: 'signed_out',
      canUseCloud: null,
      nextAction: 'sign_in',
    };
  }
  if (state === 'authorized') {
    return {
      loggedIn: true,
      user: { name: 'Sun Qingyu', email: 'sunqingyu@example.com' },
      balanceUsd: '18.40',
      balanceStatus: 'available',
      canUseCloud: true,
      nextAction: 'generate',
    };
  }
  if (state === 'running') {
    return {
      id: 'run-local-001',
      runId: 'run-local-001',
      projectId: 'local-card-gallery',
      projectName: 'Launch website',
      artifactType: 'website',
      briefConfirmed: true,
      stage: 'generating',
      status: 'running',
      hint: 'Open Design is translating your confirmed brief into a responsive website.',
    };
  }
  if (state === 'recharge') {
    return {
      loggedIn: true,
      user: { name: 'Sun Qingyu', email: 'sunqingyu@example.com' },
      balanceUsd: '0.00',
      balanceStatus: 'empty',
      canUseCloud: false,
      nextAction: 'recharge',
      rechargeUrl: 'https://open-design.ai/amr/wallet',
      hint: 'Your Open Design Cloud balance is empty. Recharge first, or continue in Open Design with a local Code Agent or BYOK.',
    };
  }
  return {
    id: 'run-local-001',
    runId: 'run-local-001',
    projectId: 'local-card-gallery',
    projectName: 'Launch website',
    artifactType: 'website',
    briefConfirmed: true,
    stage: 'ready',
    status: 'succeeded',
    entryFile: 'index.html',
    previewUrl: `${origin}/artifact`,
    studioUrl: `${origin}/studio`,
    hint: 'Review the result here, then continue detailed editing, versions, and export in Open Design.',
  };
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function mcpAppsHostScript(output: Record<string, unknown>, origin: string, widget: string): string {
  const complete = stateOutput('complete', origin);
  return `<script>
    (() => {
      const frame = document.getElementById('artifact-card');
      const status = document.getElementById('local-host-status');
      const initialOutput = ${scriptJson(output)};
      const completeOutput = ${scriptJson(complete)};
      const widgetSource = ${scriptJson(widget)};
      const initializeDelayMs = 1500;
      let initialized = false;
      let lastHeight = null;

      const setStatus = (message) => {
        if (status) status.textContent = message;
      };
      const send = (message) => {
        frame?.contentWindow?.postMessage(message, '*');
      };
      const asToolResult = (structuredContent) => ({
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      });
      const toolResult = (name) => {
        if (name === 'get_run') return asToolResult(completeOutput);
        if (name === 'list_versions') return asToolResult({
          projectId: 'local-card-gallery', path: 'index.html', versions: [
            { id: 'v1', version: 1, label: 'Initial direction' },
            { id: 'v2', version: 2, label: 'Refined hero', current: true }
          ]
        });
        if (name === 'restore_version') return asToolResult({ ok: true });
        if (name === 'export_project') return asToolResult({
          ok: true, projectId: 'local-card-gallery', fileName: 'local-card-gallery.zip', bytes: 4096
        });
        return asToolResult({});
      };
      const sendInitialToolResult = () => {
        send({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            content: [{ type: 'text', text: JSON.stringify(initialOutput) }],
            structuredContent: initialOutput,
          },
        });
      };

      window.addEventListener('message', (event) => {
        if (event.source !== frame?.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== '2.0') return;

        if (message.method === 'ui/initialize' && message.id !== undefined) {
          setStatus('MCP Apps · negotiating host connection…');
          window.setTimeout(() => {
            send({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: message.params?.protocolVersion || '2026-01-26',
                hostInfo: { name: 'open-design-local-card-gallery', version: '1.0.0' },
                hostCapabilities: {
                  openLinks: {},
                  serverTools: {},
                },
                hostContext: {
                  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
                  displayMode: 'inline',
                  availableDisplayModes: ['inline'],
                  locale: navigator.language,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  platform: 'desktop',
                  containerDimensions: {
                    maxWidth: frame?.clientWidth || 760,
                    maxHeight: frame?.clientHeight || 570,
                  },
                  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
                },
              },
            });
          }, initializeDelayMs);
          return;
        }

        if (message.method === 'ui/notifications/initialized') {
          if (initialized) return;
          initialized = true;
          setStatus('MCP Apps · connected; initial tool result delivered');
          sendInitialToolResult();
          return;
        }

        if (message.method === 'tools/call' && message.id !== undefined) {
          const name = String(message.params?.name || '');
          const result = toolResult(name);
          send({ jsonrpc: '2.0', id: message.id, result });
          setStatus('MCP Apps · handled tools/call: ' + (name || 'unknown'));
          return;
        }

        if (message.method === 'ui/open-link' && message.id !== undefined) {
          send({ jsonrpc: '2.0', id: message.id, result: {} });
          setStatus('MCP Apps · open-link: ' + String(message.params?.url || ''));
          return;
        }

        if (message.method === 'ui/update-model-context' && message.id !== undefined) {
          send({ jsonrpc: '2.0', id: message.id, result: {} });
          setStatus('MCP Apps · brief added to model context');
          return;
        }

        if (message.method === 'ui/message' && message.id !== undefined) {
          send({ jsonrpc: '2.0', id: message.id, result: {} });
          const content = Array.isArray(message.params?.content) ? message.params.content : [];
          const submitted = String(content.find((item) => item?.type === 'text')?.text || '').split('\\n')[0];
          setStatus('MCP Apps · message submitted: ' + submitted);
          return;
        }

        if (message.method === 'ui/notifications/size-changed') {
          const nextHeight = Number(message.params?.height);
          if (Number.isFinite(nextHeight) && nextHeight > 0 && frame) {
            lastHeight = Math.max(120, Math.min(900, Math.ceil(nextHeight)));
            frame.style.height = lastHeight + 'px';
          }
          setStatus('MCP Apps · connected' + (lastHeight ? ' · widget height ' + lastHeight + 'px' : ''));
        }
      });

      setStatus('MCP Apps · waiting for ui/initialize (1.5s simulated host delay)');
      if (frame) frame.srcdoc = widgetSource;
    })();
  </script>`;
}

function galleryHtml(widget: string, state: string, origin: string): string {
  const output = stateOutput(state, origin);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Open Design · Local Card Gallery</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #f3f1ec; color: #171717; }
      body { margin: 0; padding: 32px; }
      header { max-width: 760px; margin: 0 auto 20px; }
      h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -.03em; }
      p { margin: 0; color: #666; font-size: 13px; }
      nav { display: flex; gap: 8px; margin-top: 16px; }
      nav a { color: #222; text-decoration: none; padding: 7px 11px; border-radius: 999px; background: #fff; border: 1px solid #ddd8ce; font-size: 12px; font-weight: 700; }
      nav a[aria-current=true] { color: #fff; background: #111; border-color: #111; }
      iframe { display: block; width: min(760px, 100%); height: 570px; margin: 0 auto; border: 0; transition: height 200ms cubic-bezier(.23, 1, .32, 1); }
      #local-host-status { max-width: 720px; margin: 12px auto 0; min-height: 18px; color: #666; font-size: 12px; }
    </style></head><body>
    <header><h1>Open Design Artifact Card</h1><p>Real MCP Apps resource with a local host simulator.</p>
      <nav>${['brief', 'account', 'authorized', 'running', 'recharge', 'complete'].map((item) => `<a href="/?state=${item}" aria-current="${item === state}">${item}</a>`).join('')}</nav>
    </header>
    <iframe id="artifact-card" title="Open Design Artifact Card"></iframe>
    <div id="local-host-status"></div>
    ${mcpAppsHostScript(output, origin, widget)}
  </body></html>`;
}

const endpoint = option('--endpoint', 'http://127.0.0.1:17456/mcp');
const port = Number(option('--port', '17640'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535');
const widget = await readWidget(endpoint);
const origin = `http://127.0.0.1:${port}`;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', origin);
  if (url.pathname === '/artifact') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#15171c,#414b6d);color:white;font-family:system-ui}.hero{text-align:center}.pill{display:inline-block;padding:6px 10px;border:1px solid #ffffff44;border-radius:999px;font-size:12px}h1{font-size:36px;margin:14px 0 8px}p{margin:0;color:#d9def0}</style><body><div class="hero"><span class="pill">OPEN DESIGN</span><h1>Build what matters.</h1><p>A generated website preview inside the ChatGPT card.</p></div></body></html>');
    return;
  }
  if (url.pathname === '/studio') {
    response.statusCode = 302;
    response.setHeader('location', 'http://127.0.0.1:17574/');
    response.end();
    return;
  }
  const state = ['brief', 'account', 'authorized', 'running', 'recharge', 'complete'].includes(url.searchParams.get('state') ?? '')
    ? String(url.searchParams.get('state'))
    : 'complete';
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(galleryHtml(widget, state, origin));
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Open Design local card gallery: ${origin}/?state=complete\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
