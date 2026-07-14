import { describe, expect, it } from 'vitest';

import type {
  InspireChoiceRequest,
  InspireRankRequest,
  InspireRankResponse,
  InspireSearchRequest,
  InspireSearchResponse,
} from '../src/index';

describe('inspiration API contracts', () => {
  it('keeps the rank request and response wire shapes explicit', () => {
    const request: InspireRankRequest = {
      brief: 'Coffee market pitch',
      outlineTitles: ['Brand story'],
      mode: 'deck',
    };
    const response: InspireRankResponse = {
      ranked: ['coffee-story'],
      reasons: { 'coffee-story': 'Matches coffee.' },
    };

    expect(request.mode).toBe('deck');
    expect(response.ranked).toEqual(['coffee-story']);
  });

  it('uses a discriminated apply-or-skip choice', () => {
    const choices: InspireChoiceRequest[] = [
      { action: 'apply', templateId: 'coffee-story' },
      { action: 'skip' },
    ];
    expect(choices.map((choice) => choice.action)).toEqual(['apply', 'skip']);
  });

  it('keeps semantic search results previewable without exposing local paths', () => {
    const request: InspireSearchRequest = {
      query: 'professional business presentation',
      source: 'community',
      mode: 'deck',
      limit: 6,
      locale: 'en',
    };
    const response: InspireSearchResponse = {
      query: request.query,
      semantic: true,
      total: 1,
      results: [
        {
          id: 'example-business-deck',
          title: 'Business deck',
          source: 'community',
          mode: 'deck',
          tags: ['slides'],
          preview: {
            kind: 'html',
            url: '/api/plugins/example-business-deck/preview',
          },
          score: 42,
          reason: 'Matches presentation and professional intent.',
        },
      ],
    };

    expect(response.results[0]?.preview.kind).toBe('html');
    expect(JSON.stringify(response)).not.toContain('fsPath');
  });
});
