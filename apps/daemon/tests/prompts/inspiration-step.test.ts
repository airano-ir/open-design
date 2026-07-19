import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeSystemPrompt, INSPIRATION_STEP_GUIDANCE } from '../../src/prompts/system.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');

const HEADING = '## Inspiration step — ground ungrounded tasks';

describe('inspiration step guidance — composition gating', () => {
  it('is composed for ungrounded runs (no design system, no skill)', () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).toContain(HEADING);
    expect(prompt).toContain('"type": "inspiration"');
    expect(prompt).toContain('<question-form id="inspiration"');
  });

  it('is suppressed when a design system is active', () => {
    const prompt = composeSystemPrompt({
      designSystemTitle: 'Editorial',
      designSystemBody: '# Editorial\n\n--accent: #101010',
    });
    expect(prompt).not.toContain(HEADING);
  });

  it('is suppressed when a template/skill is picked', () => {
    const prompt = composeSystemPrompt({
      skillName: 'Deck',
      skillBody: '# Deck skill\n\nFollow the deck workflow.',
    });
    expect(prompt).not.toContain(HEADING);
  });

  it('is suppressed in ask mode', () => {
    const prompt = composeSystemPrompt({ sessionMode: 'chat' });
    expect(prompt).not.toContain(HEADING);
  });

  it('is suppressed in the automated direct-generation modes', () => {
    const examplePrompt = composeSystemPrompt({
      metadata: { examplePrompt: true } as never,
    });
    expect(examplePrompt).not.toContain(HEADING);
    const skipBrief = composeSystemPrompt({
      metadata: { skipDiscoveryBrief: true } as never,
    });
    expect(skipBrief).not.toContain(HEADING);
  });
});

// The guidance ships in two deliberate copies (daemon composer + the
// contracts composer used by BYOK/API runs). Sources are compared textually
// because the contracts package is consumed through its build output, and the
// drift we guard against is a source-level edit landing in only one copy.
describe('inspiration step guidance — daemon/contracts mirror parity', () => {
  function extractGuidance(sourcePath: string): string {
    const source = readFileSync(resolve(repoRoot, sourcePath), 'utf8');
    const match = /export const INSPIRATION_STEP_GUIDANCE = `([\s\S]*?)`;/.exec(source);
    return match?.[1] ?? '';
  }

  it('both copies exist and are identical', () => {
    const daemonCopy = extractGuidance('apps/daemon/src/prompts/system.ts');
    const contractsCopy = extractGuidance('packages/contracts/src/prompts/system.ts');
    expect(daemonCopy).not.toBe('');
    expect(contractsCopy).toBe(daemonCopy);
  });

  it('the runtime export matches the daemon source copy', () => {
    // `\`` escapes in the source literal resolve to plain backticks at
    // runtime; normalize the source copy the same way before comparing.
    const daemonCopy = extractGuidance('apps/daemon/src/prompts/system.ts').replace(
      /\\`/g,
      '`',
    );
    expect(INSPIRATION_STEP_GUIDANCE).toBe(daemonCopy);
  });
});
