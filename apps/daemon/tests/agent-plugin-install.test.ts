import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

import {
  AGENT_PLUGIN_HOST_SLUGS,
  AGENT_PLUGIN_HOSTS,
  describeAgentPluginPlan,
  isAgentPluginHostSlug,
  planAgentPluginInstall,
  type AgentPluginBundleInfo,
  type AgentPluginPlanContext,
} from '../src/agent-plugin-install.js';
import {
  executeAgentPluginPlan,
  resolveAgentPluginBundle,
} from '../src/agent-plugin-bundle.js';
import type { McpLaunchSpec } from '../src/mcp-agent-install.js';

const SPEC: McpLaunchSpec = {
  command: '/usr/local/bin/node',
  args: ['/opt/open-design/cli.js', 'mcp', '--daemon-url', 'http://127.0.0.1:7456'],
  env: { OD_DATA_DIR: '/home/u/.open-design' },
};

const BUNDLE: AgentPluginBundleInfo = {
  bundleDir: '/repo/plugins/open-design',
  repoRoot: '/repo',
  skillNames: ['open-design-basics', 'open-design-create'],
  version: '1.1.0',
};

const NO_BUNDLE: AgentPluginBundleInfo = {
  bundleDir: null,
  repoRoot: null,
  skillNames: [],
  version: null,
};

const ctx = (over: Partial<AgentPluginPlanContext> = {}): AgentPluginPlanContext => ({
  home: '/home/u',
  platform: 'linux',
  source: 'github',
  bundle: BUNDLE,
  mcpSpec: SPEC,
  ...over,
});

describe('host slug guard', () => {
  it('accepts every documented host and rejects others', () => {
    for (const s of AGENT_PLUGIN_HOST_SLUGS) expect(isAgentPluginHostSlug(s)).toBe(true);
    expect(isAgentPluginHostSlug('gemini')).toBe(false);
    expect(AGENT_PLUGIN_HOSTS.map((h) => h.slug)).toEqual([...AGENT_PLUGIN_HOST_SLUGS]);
  });
});

describe('host-cli hosts (codex / claude)', () => {
  it('codex installs via marketplace add + plugin add against the GitHub source', () => {
    const plan = planAgentPluginInstall('codex', ctx());
    if (plan.kind !== 'host-cli') throw new Error('expected host-cli');
    expect(plan.bin).toBe('codex');
    expect(plan.installSteps.map((s) => s.argv)).toEqual([
      ['plugin', 'marketplace', 'add', 'nexu-io/open-design'],
      ['plugin', 'add', 'open-design@open-design'],
    ]);
    expect(plan.uninstallSteps.map((s) => s.argv)).toEqual([
      ['plugin', 'remove', 'open-design@open-design'],
    ]);
  });

  it('claude uses the install/uninstall verbs', () => {
    const plan = planAgentPluginInstall('claude', ctx());
    if (plan.kind !== 'host-cli') throw new Error('expected host-cli');
    expect(plan.bin).toBe('claude');
    expect(plan.installSteps[1]!.argv).toEqual(['plugin', 'install', 'open-design@open-design']);
    expect(plan.uninstallSteps[0]!.argv).toEqual(['plugin', 'uninstall', 'open-design']);
  });

  it('source=local points the marketplace at the repo checkout', () => {
    const plan = planAgentPluginInstall('codex', ctx({ source: 'local' }));
    if (plan.kind !== 'host-cli') throw new Error('expected host-cli');
    expect(plan.installSteps[0]!.argv).toEqual(['plugin', 'marketplace', 'add', '/repo']);
  });

  it('source=local without a resolved checkout degrades to a manual plan', () => {
    const plan = planAgentPluginInstall('claude', ctx({ source: 'local', bundle: NO_BUNDLE }));
    expect(plan.kind).toBe('manual');
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.instructions).toContain('claude plugin marketplace add nexu-io/open-design');
    expect(plan.instructions).toContain('claude plugin install open-design@open-design');
  });
});

describe('skills-dir host (cursor)', () => {
  it('copies bundle skills into ~/.cursor/skills and merges ~/.cursor/mcp.json', () => {
    const plan = planAgentPluginInstall('cursor', ctx());
    if (plan.kind !== 'skills-dir') throw new Error('expected skills-dir');
    expect(plan.skillsDir).toBe('/home/u/.cursor/skills');
    expect(plan.sourceSkillsDir).toBe('/repo/plugins/open-design/skills');
    expect(plan.skillNames).toEqual(['open-design-basics', 'open-design-create']);
    expect(plan.mcp.configPath).toBe('/home/u/.cursor/mcp.json');
    expect(plan.mcp.serverKey).toBe('open-design');
  });

  it('degrades to a manual plan when the bundle is unresolved', () => {
    const plan = planAgentPluginInstall('cursor', ctx({ bundle: NO_BUNDLE }));
    expect(plan.kind).toBe('manual');
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.instructions).toContain('od mcp install cursor');
  });
});

describe('describeAgentPluginPlan', () => {
  it('previews host-cli commands verbatim', () => {
    const plan = planAgentPluginInstall('codex', ctx());
    expect(describeAgentPluginPlan(plan)).toEqual([
      'codex plugin marketplace add nexu-io/open-design',
      'codex plugin add open-design@open-design',
    ]);
  });

  it('previews skills-dir copy + MCP merge targets', () => {
    const plan = planAgentPluginInstall('cursor', ctx());
    const lines = describeAgentPluginPlan(plan);
    expect(lines[0]).toContain('/home/u/.cursor/skills');
    expect(lines[1]).toContain('/home/u/.cursor/mcp.json');
  });
});

describe('resolveAgentPluginBundle', () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeRepo = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-agent-plugin-'));
    tmpRoots.push(root);
    const skills = path.join(root, 'plugins', 'open-design', 'skills');
    for (const name of ['b-skill', 'a-skill']) {
      fs.mkdirSync(path.join(skills, name), { recursive: true });
      fs.writeFileSync(path.join(skills, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
    fs.mkdirSync(path.join(root, 'plugins', 'open-design', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'plugins', 'open-design', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'open-design', version: '9.9.9' }),
    );
    return root;
  };

  it('walks up from a nested module dir to the repo root and sorts skills', () => {
    const root = makeRepo();
    const nested = path.join(root, 'apps', 'daemon', 'dist');
    fs.mkdirSync(nested, { recursive: true });
    const bundle = resolveAgentPluginBundle(nested);
    expect(bundle.repoRoot).toBe(root);
    expect(bundle.bundleDir).toBe(path.join(root, 'plugins', 'open-design'));
    expect(bundle.skillNames).toEqual(['a-skill', 'b-skill']);
    expect(bundle.version).toBe('9.9.9');
  });

  it('returns an empty bundle when no checkout is found', () => {
    const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'od-lonely-'));
    tmpRoots.push(lonely);
    const bundle = resolveAgentPluginBundle(lonely);
    expect(bundle.bundleDir).toBeNull();
    expect(bundle.skillNames).toEqual([]);
  });

  it('resolves the real repository bundle from the daemon source tree', () => {
    const bundle = resolveAgentPluginBundle(path.join(HERE, '..', 'src'));
    expect(bundle.bundleDir).not.toBeNull();
    expect(bundle.skillNames).toContain('open-design-basics');
    expect(bundle.skillNames).toContain('open-design-preview-verify');
  });
});

describe('executeAgentPluginPlan — skills-dir', () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-agent-exec-'));
    tmpRoots.push(root);
    const source = path.join(root, 'bundle', 'skills');
    fs.mkdirSync(path.join(source, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(source, 'demo-skill', 'SKILL.md'), 'demo');
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    return { source, home };
  };

  const planFor = (source: string, home: string) => ({
    kind: 'skills-dir' as const,
    slug: 'cursor' as const,
    skillsDir: path.join(home, '.cursor', 'skills'),
    skillNames: ['demo-skill'],
    sourceSkillsDir: source,
    mcp: {
      kind: 'json' as const,
      slug: 'cursor' as const,
      configPath: path.join(home, '.cursor', 'mcp.json'),
      keyPath: ['mcpServers'],
      serverKey: 'open-design',
      entry: { type: 'stdio', command: 'od', args: ['mcp'] },
    },
  });

  it('dry-run previews without touching the filesystem', async () => {
    const { source, home } = makeFixture();
    const result = await executeAgentPluginPlan(planFor(source, home), { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.performed.some((l) => l.startsWith('would copy:'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.cursor'))).toBe(false);
  });

  it('copies skills, merges mcp.json, and uninstall reverses both', async () => {
    const { source, home } = makeFixture();
    const plan = planFor(source, home);
    const installed = await executeAgentPluginPlan(plan);
    expect(installed.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(home, '.cursor', 'skills', 'demo-skill', 'SKILL.md'), 'utf8'),
    ).toBe('demo');
    const cfg = JSON.parse(fs.readFileSync(plan.mcp.configPath, 'utf8'));
    expect(cfg.mcpServers['open-design']).toEqual({ type: 'stdio', command: 'od', args: ['mcp'] });

    const removed = await executeAgentPluginPlan(plan, { uninstall: true });
    expect(removed.ok).toBe(true);
    expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'demo-skill'))).toBe(false);
    const after = JSON.parse(fs.readFileSync(plan.mcp.configPath, 'utf8'));
    expect(after.mcpServers['open-design']).toBeUndefined();
  });

  it('reports manual plans as not-ok with paste-ready instructions', async () => {
    const plan = planAgentPluginInstall('cursor', ctx({ bundle: NO_BUNDLE }));
    const result = await executeAgentPluginPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('od mcp install cursor');
  });
});
