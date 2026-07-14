// /api/agent-plugin/* — install the Open Design agent plugin (workflow
// skills + MCP) into external coding agents from the web Integrations
// panel. The CLI twin is `od agent-plugin` in cli.ts; both surfaces run
// the same pure planner (agent-plugin-install.ts) and the same executor
// (agent-plugin-bundle.ts), so a one-click install and a terminal install
// cannot diverge. Local-same-origin gated like the MCP install routes:
// these endpoints shell out to host binaries and write into the user's
// home directory.

import type { Express } from 'express';
import os from 'node:os';

import type {
  AgentPluginHostInfo,
  AgentPluginHostsResponse,
  AgentPluginInstallResult,
} from '@open-design/contracts';
import {
  AGENT_PLUGIN_HOSTS,
  AGENT_PLUGIN_NAME,
  describeAgentPluginPlan,
  isAgentPluginHostSlug,
  planAgentPluginInstall,
  type AgentPluginPlanContext,
  type AgentPluginSource,
} from './agent-plugin-install.js';
import {
  agentPluginBinDetected,
  executeAgentPluginPlan,
  resolveAgentPluginBundle,
} from './agent-plugin-bundle.js';
import { computeLiveMcpInstallPayload } from './mcp-install-live.js';
import type { RouteDeps } from './server-context.js';

export interface RegisterAgentPluginRoutesDeps extends RouteDeps<'http' | 'paths'> {}

export function registerAgentPluginRoutes(app: Express, ctx: RegisterAgentPluginRoutesDeps) {
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  const { OD_BIN, RUNTIME_DATA_DIR } = ctx.paths;
  const getResolvedPort = () => resolvedPortRef.current;

  function planContext(source: AgentPluginSource): AgentPluginPlanContext {
    const payload = computeLiveMcpInstallPayload({
      odBin: OD_BIN,
      dataDir: RUNTIME_DATA_DIR,
      port: getResolvedPort(),
    });
    return {
      home: os.homedir(),
      platform: process.platform,
      source,
      bundle: resolveAgentPluginBundle(),
      mcpSpec: { command: payload.command, args: payload.args, env: payload.env },
    };
  }

  function requestedSource(body: unknown): AgentPluginSource {
    const source = (body as { source?: unknown } | null)?.source;
    return source === 'local' ? 'local' : 'github';
  }

  app.get('/api/agent-plugin/hosts', (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const context = planContext('github');
    const hosts: AgentPluginHostInfo[] = AGENT_PLUGIN_HOSTS.map((def) => {
      const plan = planAgentPluginInstall(def.slug, context);
      return {
        slug: def.slug,
        label: def.label,
        bin: def.bin,
        binDetected: agentPluginBinDetected(def.bin),
        strategy: plan.kind,
        browser: def.browser,
        installPreview: describeAgentPluginPlan(plan),
      };
    });
    const payload: AgentPluginHostsResponse = {
      bundle: {
        name: AGENT_PLUGIN_NAME,
        version: context.bundle.version,
        skills: context.bundle.skillNames,
        resolvedLocally: context.bundle.bundleDir != null,
      },
      hosts,
    };
    res.json(payload);
  });

  const handleInstall = (uninstall: boolean) => async (req: any, res: any) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const host = typeof req.body?.host === 'string' ? req.body.host : '';
    if (!isAgentPluginHostSlug(host)) {
      return sendApiError(res, 400, 'UNKNOWN_AGENT_PLUGIN_HOST', `unknown host: ${host}`);
    }
    try {
      const plan = planAgentPluginInstall(host, planContext(requestedSource(req.body)));
      const exec = await executeAgentPluginPlan(plan, { uninstall });
      const payload: AgentPluginInstallResult = {
        ok: exec.ok,
        host,
        strategy: plan.kind,
        message: exec.message,
        performed: exec.performed,
      };
      res.status(exec.ok ? 200 : 502).json(payload);
    } catch (err) {
      sendApiError(
        res,
        500,
        uninstall ? 'AGENT_PLUGIN_UNINSTALL_FAILED' : 'AGENT_PLUGIN_INSTALL_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  app.post('/api/agent-plugin/install', handleInstall(false));
  app.post('/api/agent-plugin/uninstall', handleInstall(true));
}
