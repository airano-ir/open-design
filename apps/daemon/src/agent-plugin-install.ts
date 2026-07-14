// Per-host agent-plugin installation planner.
//
// `od agent-plugin install <host>` (and the Integrations → Agent plugin
// panel that calls POST /api/agent-plugin/install) installs the Open
// Design agent plugin — the workflow skills bundle under
// `plugins/open-design/` plus the stdio MCP server — into an external
// coding agent so that agent can drive design generation through the
// local daemon and verify results in its own browser surface.
//
// This is a different axis from mcp-agent-install.ts (which registers
// ONLY the MCP server): here the deliverable is the skills workflow, with
// MCP as the bundled enhancement. Hosts differ in what they can consume,
// so each host maps onto one of three strategies:
//
//   - 'host-cli'   : the host ships a native plugin system that consumes
//                    the repo's marketplace manifests directly. We shell
//                    out to `<bin> plugin …` so skills AND MCP install in
//                    one step and upgrades stay host-managed. Used for
//                    codex (.agents/plugins/marketplace.json) and claude
//                    (.claude-plugin/marketplace.json).
//   - 'skills-dir' : the host has no plugin system but discovers Agent
//                    Skills from a well-known directory. We copy the
//                    bundle's skills there and register MCP through the
//                    existing per-agent MCP planner. Used for cursor
//                    (~/.cursor/skills + ~/.cursor/mcp.json).
//   - 'manual'     : we cannot resolve the local bundle (e.g. a trimmed
//                    install without the repo checkout). We refuse to
//                    write anything and print the host's own install
//                    commands against the published GitHub repo instead.
//
// Planning functions are pure (no fs / spawn) so they unit-test against a
// fake home dir + a fixed bundle description; executors in cli.ts and
// agent-plugin-routes.ts perform the IO.

import path from 'node:path';

import {
  planAgentInstall,
  type JsonInstallPlan,
  type McpLaunchSpec,
} from './mcp-agent-install.js';

export const AGENT_PLUGIN_HOST_SLUGS = ['codex', 'claude', 'cursor'] as const;

export type AgentPluginHostSlug = (typeof AGENT_PLUGIN_HOST_SLUGS)[number];

export function isAgentPluginHostSlug(value: string): value is AgentPluginHostSlug {
  return (AGENT_PLUGIN_HOST_SLUGS as readonly string[]).includes(value);
}

/** Published marketplace source: `<bin> plugin marketplace add <this>`. */
export const AGENT_PLUGIN_GITHUB_SOURCE = 'nexu-io/open-design';
/** Plugin name inside the marketplace manifests. */
export const AGENT_PLUGIN_NAME = 'open-design';
/** Marketplace name declared by both marketplace manifests. */
export const AGENT_PLUGIN_MARKETPLACE = 'open-design';

export type AgentPluginSource = 'github' | 'local';

/** Static, data-oriented per-host definition. Adding a host = adding one
 *  entry here (plus, for 'host-cli', its argv recipe in planners below). */
export interface AgentPluginHostDef {
  slug: AgentPluginHostSlug;
  label: string;
  /** Host binary probed for detection and used by 'host-cli' plans. */
  bin: string;
  strategy: 'host-cli' | 'skills-dir';
  /** Human label of the host's browser surface used for visual verification. */
  browser: string;
}

export const AGENT_PLUGIN_HOSTS: readonly AgentPluginHostDef[] = [
  { slug: 'codex', label: 'Codex', bin: 'codex', strategy: 'host-cli', browser: 'Codex browser' },
  { slug: 'claude', label: 'Claude Code', bin: 'claude', strategy: 'host-cli', browser: 'Claude browser' },
  { slug: 'cursor', label: 'Cursor', bin: 'cursor-agent', strategy: 'skills-dir', browser: 'Cursor browser' },
];

export function agentPluginHostDef(slug: AgentPluginHostSlug): AgentPluginHostDef {
  const def = AGENT_PLUGIN_HOSTS.find((h) => h.slug === slug);
  if (!def) throw new Error(`unknown agent-plugin host: ${slug}`);
  return def;
}

/** Resolved description of the local bundle (`plugins/open-design/`).
 *  Produced by resolveAgentPluginBundle (agent-plugin-bundle.ts); null
 *  fields mean the checkout does not carry the bundle. */
export interface AgentPluginBundleInfo {
  /** Absolute path to plugins/open-design, or null when unresolved. */
  bundleDir: string | null;
  /** Absolute path to the repo root holding the marketplace manifests. */
  repoRoot: string | null;
  /** Skill directory names under <bundleDir>/skills. */
  skillNames: string[];
  /** Version from .claude-plugin/plugin.json (display only). */
  version: string | null;
}

export interface AgentPluginPlanContext {
  /** Absolute home directory (os.homedir()). Injected for testability. */
  home: string;
  platform: NodeJS.Platform;
  source: AgentPluginSource;
  bundle: AgentPluginBundleInfo;
  /** Launch spec for the bundled MCP server (skills-dir strategy only). */
  mcpSpec: McpLaunchSpec;
}

export interface AgentPluginStep {
  argv: string[];
  description: string;
}

/** Host owns a native plugin system; we drive `<bin> plugin …`. */
export interface HostCliPluginPlan {
  kind: 'host-cli';
  slug: AgentPluginHostSlug;
  bin: string;
  installSteps: AgentPluginStep[];
  uninstallSteps: AgentPluginStep[];
}

/** Host discovers SKILL.md folders from a directory; MCP merges via the
 *  per-agent JSON planner. */
export interface SkillsDirPluginPlan {
  kind: 'skills-dir';
  slug: AgentPluginHostSlug;
  /** Where the host discovers skills (absolute). */
  skillsDir: string;
  /** Skill folder names to copy from / remove at skillsDir. */
  skillNames: string[];
  /** Copy source: <bundleDir>/skills (absolute). */
  sourceSkillsDir: string;
  mcp: JsonInstallPlan;
}

/** Bundle unresolved — print the host's own commands, never write. */
export interface ManualPluginPlan {
  kind: 'manual';
  slug: AgentPluginHostSlug;
  instructions: string;
  reason: string;
}

export type AgentPluginInstallPlan =
  | HostCliPluginPlan
  | SkillsDirPluginPlan
  | ManualPluginPlan;

/** Marketplace source argument for `<bin> plugin marketplace add`. */
function marketplaceSource(ctx: AgentPluginPlanContext): string | null {
  if (ctx.source === 'github') return AGENT_PLUGIN_GITHUB_SOURCE;
  return ctx.bundle.repoRoot;
}

/**
 * Build the installation plan for one host. Pure — all IO happens in the
 * executors. Throws on an unknown slug so callers surface a clear error.
 */
export function planAgentPluginInstall(
  slug: AgentPluginHostSlug,
  ctx: AgentPluginPlanContext,
): AgentPluginInstallPlan {
  const def = agentPluginHostDef(slug);

  switch (slug) {
    case 'codex': {
      const source = marketplaceSource(ctx);
      if (!source) return manualFallback(slug, ctx);
      return {
        kind: 'host-cli',
        slug,
        bin: def.bin,
        installSteps: [
          {
            argv: ['plugin', 'marketplace', 'add', source],
            description: 'register the Open Design plugin marketplace',
          },
          {
            argv: ['plugin', 'add', `${AGENT_PLUGIN_NAME}@${AGENT_PLUGIN_MARKETPLACE}`],
            description: 'install the Open Design plugin (skills + MCP)',
          },
        ],
        uninstallSteps: [
          {
            // Codex requires the <plugin>@<marketplace> form on remove
            // (verified against codex CLI: bare names error out).
            argv: ['plugin', 'remove', `${AGENT_PLUGIN_NAME}@${AGENT_PLUGIN_MARKETPLACE}`],
            description: 'remove the Open Design plugin',
          },
        ],
      };
    }
    case 'claude': {
      const source = marketplaceSource(ctx);
      if (!source) return manualFallback(slug, ctx);
      return {
        kind: 'host-cli',
        slug,
        bin: def.bin,
        installSteps: [
          {
            argv: ['plugin', 'marketplace', 'add', source],
            description: 'register the Open Design plugin marketplace',
          },
          {
            argv: ['plugin', 'install', `${AGENT_PLUGIN_NAME}@${AGENT_PLUGIN_MARKETPLACE}`],
            description: 'install the Open Design plugin (skills + MCP)',
          },
        ],
        uninstallSteps: [
          {
            argv: ['plugin', 'uninstall', AGENT_PLUGIN_NAME],
            description: 'remove the Open Design plugin',
          },
        ],
      };
    }
    case 'cursor': {
      const { bundleDir, skillNames } = ctx.bundle;
      if (!bundleDir || skillNames.length === 0) return manualFallback(slug, ctx);
      const mcp = planAgentInstall('cursor', ctx.mcpSpec, {
        home: ctx.home,
        platform: ctx.platform,
        serverName: AGENT_PLUGIN_NAME,
      });
      if (mcp.kind !== 'json') {
        // planAgentInstall('cursor') is a JSON plan by contract; guard so a
        // future strategy change there cannot silently corrupt this one.
        throw new Error(`cursor MCP plan changed strategy: ${mcp.kind}`);
      }
      return {
        kind: 'skills-dir',
        slug,
        skillsDir: path.join(ctx.home, '.cursor', 'skills'),
        skillNames: [...skillNames],
        sourceSkillsDir: path.join(bundleDir, 'skills'),
        mcp,
      };
    }
    default: {
      const exhaustive: never = slug;
      throw new Error(`unknown agent-plugin host: ${String(exhaustive)}`);
    }
  }
}

function manualFallback(
  slug: AgentPluginHostSlug,
  ctx: AgentPluginPlanContext,
): ManualPluginPlan {
  const def = agentPluginHostDef(slug);
  const lines =
    def.strategy === 'host-cli'
      ? [
          `${def.bin} plugin marketplace add ${AGENT_PLUGIN_GITHUB_SOURCE}`,
          `${def.bin} plugin ${slug === 'claude' ? 'install' : 'add'} ${AGENT_PLUGIN_NAME}@${AGENT_PLUGIN_MARKETPLACE}`,
        ]
      : [
          `git clone https://github.com/${AGENT_PLUGIN_GITHUB_SOURCE}.git`,
          `cp -R open-design/plugins/open-design/skills/* ~/.cursor/skills/`,
          `od mcp install cursor`,
        ];
  return {
    kind: 'manual',
    slug,
    instructions: lines.join('\n'),
    reason:
      ctx.source === 'local'
        ? 'the local Open Design checkout does not carry the agent-plugin bundle (plugins/open-design/skills); install from GitHub instead'
        : 'the agent-plugin bundle could not be resolved on this machine; run the host commands against the published repo',
  };
}

/** Preview of the exact commands a plan will run / files it will touch —
 *  shared by `--print` output, the hosts endpoint, and the web panel. */
export function describeAgentPluginPlan(plan: AgentPluginInstallPlan): string[] {
  if (plan.kind === 'host-cli') {
    return plan.installSteps.map((s) => `${plan.bin} ${s.argv.join(' ')}`);
  }
  if (plan.kind === 'skills-dir') {
    return [
      `copy ${plan.skillNames.length} skills → ${plan.skillsDir}`,
      `merge MCP server "${plan.mcp.serverKey}" → ${plan.mcp.configPath}`,
    ];
  }
  return plan.instructions.split('\n');
}
