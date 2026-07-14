import { describe, expect, it } from 'vitest';

import { createFlowSnapshot } from '@open-design/contracts';
import { applyInspireChoice } from '../src/inspire/choice.js';
import {
  filterInspireCatalogue,
  rankInspireCatalogue,
  searchInspireCatalogue,
} from '../src/inspire/rank.js';

describe('inspiration keyword ranking', () => {
  const catalogue = [
    {
      id: 'z-neutral',
      name: 'Neutral Grid',
      mode: 'deck',
      description: 'A general presentation system',
    },
    {
      id: 'coffee-story',
      name: 'Coffee Editorial',
      mode: 'deck',
      description: 'Editorial storytelling for a coffee market',
      tags: ['coffee', 'editorial'],
    },
    {
      id: 'coffee-story',
      name: 'Duplicate Coffee Editorial',
      mode: 'deck',
      description: 'This duplicate must not appear twice',
    },
    {
      id: 'a-minimal',
      name: 'Minimal',
      mode: 'deck',
    },
    {
      id: 'b-bold',
      name: 'Bold',
      mode: 'deck',
    },
    {
      id: 'c-classic',
      name: 'Classic',
      mode: 'deck',
    },
    {
      id: 'saas-landing',
      name: 'SaaS Landing',
      mode: 'prototype',
      platform: 'desktop',
      tags: ['landing-template'],
    },
    {
      id: 'wireframe-greybox',
      name: 'Wireframe Greybox',
      mode: 'prototype',
      platform: 'desktop',
      tags: ['prototype-template'],
    },
    {
      id: 'mobile-app',
      name: 'Mobile App',
      mode: 'prototype',
      platform: 'mobile',
      tags: ['mobile-template'],
    },
    {
      id: 'dashboard',
      name: 'Dashboard',
      mode: 'prototype',
      platform: 'desktop',
      tags: ['webapp-template'],
    },
    {
      id: 'board-decision-memo',
      name: 'Board Decision Memo',
      mode: 'template',
      tags: ['document-template', 'corporate-strategy'],
    },
    {
      id: 'executive-operating-review',
      name: 'Executive Operating Review',
      mode: 'template',
      tags: ['report-template', 'corporate-strategy'],
    },
    {
      id: 'generic-template',
      name: 'Generic Template',
      mode: 'template',
    },
  ] as const;

  it('filters by the shape registry, de-duplicates, and ranks every eligible id', () => {
    const result = rankInspireCatalogue(
      {
        brief: 'Coffee market pitch',
        outlineTitles: ['Brand story', 'Market opportunity'],
        mode: 'deck',
      },
      catalogue,
    );

    expect(result.ranked).toEqual([
      'coffee-story',
      'a-minimal',
      'b-bold',
      'c-classic',
      'z-neutral',
    ]);
    expect(new Set(result.ranked).size).toBe(result.ranked.length);
    expect(result.reasons['coffee-story']).toContain('coffee');
    expect(Object.keys(result.reasons)).toHaveLength(4);
    expect(result.reasons['z-neutral']).toBeUndefined();
  });

  it('honors platform filters declared by other flow shapes', () => {
    expect(filterInspireCatalogue('landing', catalogue)).toEqual([
      {
        id: 'saas-landing',
        name: 'SaaS Landing',
        mode: 'prototype',
        platform: 'desktop',
        tags: ['landing-template'],
      },
    ]);
  });

  it('prefers fundraising inspiration for a seed pitch over generic sales decks', () => {
    const result = rankInspireCatalogue(
      {
        brief: 'A six-slide seed pitch for a privacy-first product',
        outlineTitles: ['Team wedge', 'Seed ask'],
        mode: 'deck',
      },
      [
        {
          id: 'sales-rollout',
          name: 'Pitch a Team Rollout',
          mode: 'deck',
          tags: ['sales', 'product', 'pitch-deck'],
        },
        {
          id: 'demo-day',
          name: 'Write a Demo Day Pitch',
          mode: 'deck',
          tags: ['fundraising', 'investor-deck', 'accelerator'],
        },
      ],
    );

    expect(result.ranked[0]).toBe('demo-day');
    expect(result.reasons['demo-day']).toContain('fundraising');
  });

  it('isolates each prototype-family catalogue by platform and shape tag', () => {
    expect(
      filterInspireCatalogue('prototype', catalogue).map((entry) => entry.id),
    ).toEqual(['wireframe-greybox']);
    expect(
      filterInspireCatalogue('landing', catalogue).map((entry) => entry.id),
    ).toEqual(['saas-landing']);
    expect(
      filterInspireCatalogue('mobile', catalogue).map((entry) => entry.id),
    ).toEqual(['mobile-app']);
    expect(
      filterInspireCatalogue('webapp', catalogue).map((entry) => entry.id),
    ).toEqual(['dashboard']);
  });

  it('separates document and report catalogues by declared tags', () => {
    expect(
      filterInspireCatalogue('document', catalogue).map((entry) => entry.id),
    ).toEqual(['board-decision-memo']);
    expect(
      filterInspireCatalogue('report', catalogue).map((entry) => entry.id),
    ).toEqual(['executive-operating-review']);
  });
});

describe('community semantic search', () => {
  it('matches bilingual presentation intent and keeps source filters isolated', () => {
    const result = searchInspireCatalogue(
      {
        query: '专业商务 PPT',
        source: 'community',
        mode: 'deck',
        limit: 1,
      },
      [
        {
          id: 'investor-review',
          name: 'Investor Review',
          title: 'Investor Review',
          description: 'Finance board presentation with polished slides',
          mode: 'deck',
          tags: ['business', 'slides'],
          triggers: [],
          source: 'community',
          preview: { kind: 'none' },
        },
        {
          id: 'template-only',
          name: 'Template only',
          title: 'Template only',
          description: 'Professional presentation',
          mode: 'deck',
          tags: ['business'],
          triggers: [],
          source: 'design-template',
          preview: { kind: 'none' },
        },
      ],
    );

    expect(result.total).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      id: 'investor-review',
      source: 'community',
    });
    expect(result.results[0]?.reason).toContain('意图');
  });
});

describe('durable inspiration choice', () => {
  it('applies a template once and treats an exact retry as unchanged', () => {
    const initial = createFlowSnapshot('deck', { now: 1 });
    const first = applyInspireChoice(
      initial,
      { action: 'apply', templateId: 'coffee-story' },
      2,
    );
    expect(first.status).toBe('updated');
    expect(first.flow.inspireChoice).toEqual({
      templateId: 'coffee-story',
      skipped: false,
    });
    expect(first.flow.stages.find((stage) => stage.id === 'inspire')?.state).toBe(
      'complete',
    );

    const retry = applyInspireChoice(
      first.flow,
      { action: 'apply', templateId: 'coffee-story' },
      3,
    );
    expect(retry).toEqual({ status: 'unchanged', flow: first.flow });
    expect(
      applyInspireChoice(first.flow, { action: 'skip' }, 3).status,
    ).toBe('conflict');
  });

  it('records an explicit skip with the default-style detail', () => {
    const result = applyInspireChoice(
      createFlowSnapshot('deck', { now: 1 }),
      { action: 'skip' },
      2,
    );
    expect(result.status).toBe('updated');
    expect(result.flow.inspireChoice).toEqual({ templateId: null, skipped: true });
    expect(result.flow.stages.find((stage) => stage.id === 'inspire')).toMatchObject({
      state: 'skipped',
      detail: 'Skipped · Using the default style',
    });
  });
});
