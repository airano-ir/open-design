// Web client for the daemon's agent-plugin install endpoints.
//
// The Integrations → Agent plugin panel lists installable hosts
// (codex / claude / cursor) and drives one-click install/uninstall of the
// Open Design agent plugin (workflow skills + MCP). Same planner/executor
// as `od agent-plugin` — see apps/daemon/src/agent-plugin-routes.ts.

import type {
  AgentPluginHostSlug,
  AgentPluginHostsResponse,
  AgentPluginInstallResult,
} from '@open-design/contracts';

export type {
  AgentPluginHostSlug,
  AgentPluginHostsResponse,
  AgentPluginInstallResult,
};

export async function fetchAgentPluginHosts(): Promise<AgentPluginHostsResponse | null> {
  try {
    const res = await fetch('/api/agent-plugin/hosts');
    if (!res.ok) return null;
    const data = (await res.json()) as AgentPluginHostsResponse;
    if (!data || !Array.isArray(data.hosts)) return null;
    return data;
  } catch {
    return null;
  }
}

async function postAgentPluginAction(
  path: '/api/agent-plugin/install' | '/api/agent-plugin/uninstall',
  host: AgentPluginHostSlug,
): Promise<AgentPluginInstallResult | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host }),
    });
    // The daemon answers 200 on success and 502 with the same result shape
    // when a host command failed — both carry a renderable message.
    const data = (await res.json().catch(() => null)) as AgentPluginInstallResult | null;
    if (data && typeof data.message === 'string') return data;
    return null;
  } catch {
    return null;
  }
}

export function installAgentPlugin(host: AgentPluginHostSlug) {
  return postAgentPluginAction('/api/agent-plugin/install', host);
}

export function uninstallAgentPlugin(host: AgentPluginHostSlug) {
  return postAgentPluginAction('/api/agent-plugin/uninstall', host);
}
