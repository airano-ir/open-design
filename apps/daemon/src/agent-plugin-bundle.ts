// Local agent-plugin bundle resolution + the shared install executor.
//
// The planner (agent-plugin-install.ts) is pure; this module owns the IO
// both executors share: resolving the on-disk bundle (`plugins/open-design`
// with its skills/), copying skills for the 'skills-dir' strategy, and
// running 'host-cli' plan steps. cli.ts and agent-plugin-routes.ts stay
// thin wrappers over these helpers so the CLI and the web one-click
// install cannot drift apart.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyJsonInstall,
  removeJsonInstall,
} from './mcp-agent-install.js';
import type {
  AgentPluginBundleInfo,
  AgentPluginInstallPlan,
} from './agent-plugin-install.js';

/**
 * Walk up from `startDir` looking for the repo checkout that carries the
 * agent-plugin bundle. The invariant we anchor on is
 * `<root>/plugins/open-design/skills` existing as a directory — that is
 * the one artifact every install strategy needs.
 */
export function resolveAgentPluginBundle(
  startDir: string = path.dirname(fileURLToPath(import.meta.url)),
): AgentPluginBundleInfo {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    const bundleDir = path.join(dir, 'plugins', 'open-design');
    const skillsDir = path.join(bundleDir, 'skills');
    if (isDir(skillsDir)) {
      return {
        bundleDir,
        repoRoot: dir,
        skillNames: listSkillNames(skillsDir),
        version: readBundleVersion(bundleDir),
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { bundleDir: null, repoRoot: null, skillNames: [], version: null };
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listSkillNames(skillsDir: string): string[] {
  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function readBundleVersion(bundleDir: string): string | null {
  try {
    const raw = fs.readFileSync(
      path.join(bundleDir, '.claude-plugin', 'plugin.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** True when `bin` resolves on PATH — best-effort host detection. */
export function agentPluginBinDetected(bin: string): boolean {
  const pathVar = process.env.PATH ?? '';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const entry of pathVar.split(path.delimiter)) {
    if (!entry) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(entry, bin + ext.toLowerCase()), fs.constants.X_OK);
        return true;
      } catch {
        /* keep scanning */
      }
    }
  }
  return false;
}

export interface AgentPluginExecResult {
  ok: boolean;
  message: string;
  /** Steps actually performed (host-cli) or paths touched (skills-dir). */
  performed: string[];
}

/**
 * Execute an install/uninstall plan. `dryRun` performs no IO and reports
 * what would happen. Manual plans always come back ok=false with the
 * ready-to-paste instructions in `message`.
 */
export async function executeAgentPluginPlan(
  plan: AgentPluginInstallPlan,
  opts: { uninstall?: boolean; dryRun?: boolean } = {},
): Promise<AgentPluginExecResult> {
  const uninstall = Boolean(opts.uninstall);
  const dryRun = Boolean(opts.dryRun);

  if (plan.kind === 'manual') {
    return {
      ok: false,
      message: `${plan.slug}: manual setup required. ${plan.reason}\n${plan.instructions}`,
      performed: [],
    };
  }

  if (plan.kind === 'host-cli') {
    const steps = uninstall ? plan.uninstallSteps : plan.installSteps;
    const performed: string[] = [];
    for (const step of steps) {
      const rendered = `${plan.bin} ${step.argv.join(' ')}`;
      if (dryRun) {
        performed.push(`would run: ${rendered}`);
        continue;
      }
      const code = await runHostCommand(plan.bin, step.argv);
      if (code !== 0) {
        return {
          ok: false,
          message: `${rendered} exited with code ${code} (${step.description})`,
          performed,
        };
      }
      performed.push(rendered);
    }
    return {
      ok: true,
      message: dryRun
        ? `dry run — nothing executed for ${plan.slug}`
        : uninstall
          ? `removed the Open Design plugin from ${plan.slug}`
          : `installed the Open Design plugin into ${plan.slug}`,
      performed,
    };
  }

  // plan.kind === 'skills-dir'
  const performed: string[] = [];
  for (const name of plan.skillNames) {
    const target = path.join(plan.skillsDir, name);
    if (uninstall) {
      if (dryRun) {
        performed.push(`would remove: ${target}`);
      } else {
        await fsp.rm(target, { recursive: true, force: true });
        performed.push(`removed: ${target}`);
      }
      continue;
    }
    if (dryRun) {
      performed.push(`would copy: ${path.join(plan.sourceSkillsDir, name)} → ${target}`);
      continue;
    }
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(plan.skillsDir, { recursive: true });
    await fsp.cp(path.join(plan.sourceSkillsDir, name), target, { recursive: true });
    performed.push(`copied: ${target}`);
  }

  let existing: string | null = null;
  try {
    existing = await fsp.readFile(plan.mcp.configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (uninstall) {
    const next = removeJsonInstall(existing, plan.mcp);
    if (next != null) {
      if (dryRun) {
        performed.push(`would update: ${plan.mcp.configPath}`);
      } else {
        await fsp.writeFile(plan.mcp.configPath, next, 'utf8');
        performed.push(`updated: ${plan.mcp.configPath}`);
      }
    }
  } else {
    const next = applyJsonInstall(existing, plan.mcp);
    if (dryRun) {
      performed.push(`would update: ${plan.mcp.configPath}`);
    } else {
      await fsp.mkdir(path.dirname(plan.mcp.configPath), { recursive: true });
      await fsp.writeFile(plan.mcp.configPath, next, 'utf8');
      performed.push(`updated: ${plan.mcp.configPath}`);
    }
  }

  return {
    ok: true,
    message: dryRun
      ? `dry run — nothing written for ${plan.slug}`
      : uninstall
        ? `removed ${plan.skillNames.length} Open Design skills + MCP entry from ${plan.slug}`
        : `installed ${plan.skillNames.length} Open Design skills + MCP entry into ${plan.slug}`,
    performed,
  };
}

function runHostCommand(bin: string, argv: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}
