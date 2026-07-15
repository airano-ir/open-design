import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Task Progress and Computer motion', () => {
  it('uses asymmetric disclosure timing for both Task Progress surfaces', () => {
    const pinned = read('src/components/PinnedTaskProgress.module.css');
    const computer = read('src/components/OdComputerPanel.module.css');

    expect(pinned).toMatch(/\.root\[data-collapsed='false'\] \.body[\s\S]*200ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(pinned).toMatch(/\.root\[data-collapsed='true'\] \.body[\s\S]*140ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(computer).toMatch(/\.taskProgress\[data-collapsed='false'\] \.taskProgressBody[\s\S]*200ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(computer).toMatch(/\.taskProgress\[data-collapsed='true'\] \.taskProgressBody[\s\S]*140ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  });

  it('animates Computer steps directionally and disables spatial motion when requested', () => {
    const computer = read('src/components/OdComputerPanel.module.css');
    const shell = read('src/components/ComputerWorkspaceShell.module.css');
    const overlay = read('src/components/OdComputerOverlay.module.css');

    expect(computer).toContain(".stepTransition[data-direction='forward']");
    expect(computer).toContain(".stepTransition[data-direction='backward']");
    expect(computer).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.stepTransition/);
    expect(shell).toContain(".shell[data-open='false'] .frame");
    expect(overlay).toContain(".layer[data-state='closing'] .shell");
  });

  it('owns an isolated paint layer so a previous GPU preview cannot bleed into an empty replay', () => {
    const computer = read('src/components/OdComputerPanel.module.css');

    expect(computer).toMatch(/\.root \{[\s\S]*isolation: isolate;[\s\S]*contain: paint;/);
    expect(computer).toMatch(/\.body \{[\s\S]*background: var\(--bg-panel, #fff\);/);
  });

  it('keeps a stable three-track grid and disables easing during direct resize', () => {
    const shell = read('src/styles/shell.css');

    expect(shell).toMatch(/\.split \{[\s\S]*transition:\s*grid-template-columns 200ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(shell).toMatch(/\.split\.is-resizing-chat \{[\s\S]*transition: none/);
  });
});
