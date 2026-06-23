import { describe, expect, it } from 'vitest';

import {
  buildBrandEnrichmentPrompt,
  installedBrandEnrichmentSkillIds,
} from '../../src/runtime/brand-enrichment';

describe('brand enrichment runtime helpers', () => {
  it('keeps the default skill bundle hidden and filters it to installed skills', () => {
    expect(installedBrandEnrichmentSkillIds([
      { id: 'color-expert' },
      { id: 'unrelated' },
      { id: 'design-md' },
      { id: 'brand-guidelines' },
    ])).toEqual(['design-md', 'color-expert', 'brand-guidelines']);
  });

  it('builds a complete fallback prompt when no seeded prompt is available', () => {
    const prompt = buildBrandEnrichmentPrompt('');

    expect(prompt).toContain('AI optimize this Open Design design system in place.');
    expect(prompt).toContain('Do not create a duplicate system.');
    expect(prompt).toContain('10-20');
    expect(prompt).toContain('anti-bot verification page');
  });

  it('appends the quality bar to an existing extraction prompt without replacing context', () => {
    const prompt = buildBrandEnrichmentPrompt('Existing source URL: https://example.com');

    expect(prompt).toContain('Existing source URL: https://example.com');
    expect(prompt).toContain('AI Optimize quality bar:');
    expect(prompt).toContain('DESIGN.md, README.md, SKILL.md');
  });
});
