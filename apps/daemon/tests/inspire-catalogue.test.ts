import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord, PluginManifest } from '@open-design/contracts';

import { communityInspireCandidates } from '../src/inspire/catalogue.js';

function plugin(
  id: string,
  od: NonNullable<PluginManifest['od']>,
): InstalledPluginRecord {
  return {
    id,
    title: id,
    version: '1.0.0',
    sourceKind: 'local',
    source: `/fixtures/${id}`,
    fsPath: `/fixtures/${id}`,
    trust: 'trusted',
    capabilitiesGranted: [],
    installedAt: 1,
    updatedAt: 1,
    manifest: {
      $schema: 'https://open-design.ai/schemas/plugin.v1.json',
      name: id,
      version: '1.0.0',
      title: id,
      description: `Description for ${id}`,
      od,
    } as PluginManifest,
  };
}

describe('community inspiration catalogue', () => {
  it('maps visual plugin metadata to safe same-origin card previews', () => {
    const [candidate] = communityInspireCandidates([
      plugin('business-deck', {
        mode: 'deck',
        scenario: 'presentation',
        preview: { type: 'html', entry: 'preview/index.html' },
        useCase: { query: { en: 'Create a professional investor presentation' } },
      }),
    ], 'en');

    expect(candidate).toMatchObject({
      id: 'business-deck',
      source: 'community',
      mode: 'deck',
      prompt: 'Create a professional investor presentation',
      preview: {
        kind: 'html',
        url: '/api/plugins/business-deck/preview',
      },
    });
  });

  it('excludes atomic helpers and rejects remote preview URLs', () => {
    const candidates = communityInspireCandidates([
      plugin('internal-atom', { kind: 'atom', mode: 'utility' }),
      plugin('remote-image', {
        mode: 'image',
        preview: { type: 'image', poster: 'https://example.com/tracker.png' },
      }),
    ]);

    expect(candidates.map((candidate) => candidate.id)).toEqual(['remote-image']);
    expect(candidates[0]?.preview).toEqual({ kind: 'none' });
  });
});
