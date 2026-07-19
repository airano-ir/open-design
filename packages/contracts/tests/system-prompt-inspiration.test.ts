import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../src/prompts/system.js';

const HEADING = '## Inspiration step — ground ungrounded tasks';

describe('composeSystemPrompt — inspiration step (BYOK/API mirror)', () => {
  it('offers the inspiration step for ungrounded runs', () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).toContain(HEADING);
    expect(prompt).toContain('"type": "inspiration"');
  });

  it('suppresses it when a design system is active', () => {
    const prompt = composeSystemPrompt({
      designSystemTitle: 'Editorial',
      designSystemBody: '# Editorial\n\n--accent: #101010',
    });
    expect(prompt).not.toContain(HEADING);
  });

  it('suppresses it when a template/skill is picked', () => {
    const prompt = composeSystemPrompt({
      skillName: 'Deck',
      skillBody: '# Deck skill\n\nFollow the deck workflow.',
    });
    expect(prompt).not.toContain(HEADING);
  });

  it('suppresses it in the automated direct-generation modes', () => {
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
