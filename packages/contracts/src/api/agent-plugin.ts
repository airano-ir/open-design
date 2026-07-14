// Agent-plugin install surface.
//
// The Open Design agent plugin is the distributable bundle under
// `plugins/open-design/` (workflow skills + stdio MCP config) that external
// coding agents install so they can drive design generation through the
// local daemon and verify results in their own browser surface. These are
// the wire shapes between the web Integrations → Agent plugin panel and
// the daemon's /api/agent-plugin/* routes; `od agent-plugin` renders the
// same shapes with --json.

/** Hosts the installer knows how to target. */
export type AgentPluginHostSlug = 'codex' | 'claude' | 'cursor';

/** How the plugin lands in a given host. */
export type AgentPluginStrategy = 'host-cli' | 'skills-dir' | 'manual';

export interface AgentPluginBundleSummary {
  name: string;
  /** Bundle version (from the plugin manifest), null when unresolved. */
  version: string | null;
  /** Skill folder names shipped by the bundle. */
  skills: string[];
  /** Whether the daemon could resolve the bundle on local disk. */
  resolvedLocally: boolean;
}

export interface AgentPluginHostInfo {
  slug: AgentPluginHostSlug;
  label: string;
  /** Host binary the installer drives / probes (e.g. `codex`). */
  bin: string;
  /** True when the host binary resolves on the daemon machine's PATH. */
  binDetected: boolean;
  strategy: AgentPluginStrategy;
  /** Human label of the host's browser surface (e.g. "Codex browser"). */
  browser: string;
  /** Preview of the exact commands / file operations an install would run. */
  installPreview: string[];
}

/** Response for GET /api/agent-plugin/hosts. */
export interface AgentPluginHostsResponse {
  bundle: AgentPluginBundleSummary;
  hosts: AgentPluginHostInfo[];
}

/** Body for POST /api/agent-plugin/install and /api/agent-plugin/uninstall. */
export interface AgentPluginInstallRequest {
  host: AgentPluginHostSlug;
  /** 'github' (default) installs from the published repo; 'local' from the
   *  daemon's own checkout — the dev-loop path. */
  source?: 'github' | 'local';
}

/** Result of an install/uninstall execution (HTTP response and CLI --json). */
export interface AgentPluginInstallResult {
  ok: boolean;
  host: AgentPluginHostSlug;
  strategy: AgentPluginStrategy;
  message: string;
  /** Human-readable log of steps performed (or previewed for dry runs). */
  performed: string[];
}
