import express, { type Express } from 'express';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import {
  createFlowSnapshot,
  type FlowSnapshot,
  type InspireChoiceResponse,
  type InspireRankResponse,
  type InspireSearchResponse,
} from '@open-design/contracts';
import { registerInspireRoutes } from '../src/routes/inspire.js';

async function withServer<T>(
  app: Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  try {
    return await run('http://127.0.0.1:' + port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('inspiration routes', () => {
  const catalogue = [
    {
      id: 'coffee-story',
      name: 'Coffee Editorial',
      description: 'Coffee market storytelling',
      mode: 'deck',
    },
    {
      id: 'plain-deck',
      name: 'Plain Deck',
      description: 'General slides',
      mode: 'deck',
    },
    {
      id: 'mobile-app',
      name: 'Mobile App',
      mode: 'prototype',
      platform: 'mobile',
    },
  ];

  it('serves the deterministic catalogue ranking', async () => {
    const app = express();
    app.use(express.json());
    registerInspireRoutes(app, {
      listCatalogueEntries: () => catalogue,
      loadConversationFlow: () => undefined,
      saveConversationFlow: () => {},
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/inspire/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief: 'Coffee market pitch',
          outlineTitles: ['Brand story'],
          mode: 'deck',
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as InspireRankResponse;
      expect(body.ranked).toEqual(['coffee-story', 'plain-deck']);
      expect(body.reasons['coffee-story']).toContain('coffee');
    });
  });

  it('serves semantic community search with preview metadata', async () => {
    const app = express();
    app.use(express.json());
    registerInspireRoutes(app, {
      listCatalogueEntries: () => catalogue,
      listSearchEntries: () => [
        {
          id: 'business-deck',
          name: 'Investor review',
          title: 'Investor review',
          description: 'A polished finance and board presentation',
          mode: 'deck',
          source: 'community',
          tags: ['finance', 'slides'],
          preview: {
            kind: 'html',
            url: '/api/plugins/business-deck/preview',
          },
        },
        {
          id: 'mobile-app',
          name: 'Mobile App',
          title: 'Mobile App',
          mode: 'prototype',
          source: 'community',
          tags: ['mobile'],
          preview: { kind: 'none' },
        },
      ],
      loadConversationFlow: () => undefined,
      saveConversationFlow: () => {},
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/inspire/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'professional business presentation',
          source: 'community',
          mode: 'deck',
          limit: 6,
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as InspireSearchResponse;
      expect(body.semantic).toBe(true);
      expect(body.results[0]).toMatchObject({
        id: 'business-deck',
        source: 'community',
        preview: { kind: 'html' },
      });
      expect(body.results[0]?.reason).toContain('professional business');
    });
  });

  it('validates template ids and persists an apply exactly once', async () => {
    const flows = new Map<string, FlowSnapshot | null>([
      ['conversation-1', createFlowSnapshot('deck', { now: 1 })],
    ]);
    const saveConversationFlow = vi.fn((id: string, flow: FlowSnapshot) => {
      flows.set(id, flow);
    });
    const applyTemplate = vi.fn();
    const app = express();
    app.use(express.json());
    registerInspireRoutes(app, {
      listCatalogueEntries: () => catalogue,
      loadConversationFlow: (id) => flows.has(id) ? flows.get(id) : undefined,
      saveConversationFlow,
      applyTemplate,
      now: () => 10,
    });

    await withServer(app, async (baseUrl) => {
      const postChoice = async (body: unknown) => {
        const response = await fetch(
          baseUrl + '/api/conversations/conversation-1/flow/inspire',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        return {
          status: response.status,
          body: await response.json(),
        };
      };

      const invalid = await postChoice({
        action: 'apply',
        templateId: 'mobile-app',
      });
      expect(invalid.status).toBe(400);
      expect(saveConversationFlow).not.toHaveBeenCalled();

      const applied = await postChoice({
        action: 'apply',
        templateId: 'coffee-story',
      });
      expect(applied.status).toBe(200);
      expect((applied.body as InspireChoiceResponse).flow.inspireChoice).toEqual({
        templateId: 'coffee-story',
        skipped: false,
      });
      expect(saveConversationFlow).toHaveBeenCalledTimes(1);
      expect(applyTemplate).toHaveBeenCalledOnce();
      expect(applyTemplate).toHaveBeenCalledWith('conversation-1', 'coffee-story');

      const retry = await postChoice({
        action: 'apply',
        templateId: 'coffee-story',
      });
      expect(retry.status).toBe(200);
      expect(saveConversationFlow).toHaveBeenCalledTimes(1);
      expect(applyTemplate).toHaveBeenCalledOnce();

      const conflict = await postChoice({ action: 'skip' });
      expect(conflict.status).toBe(409);
      expect(saveConversationFlow).toHaveBeenCalledTimes(1);
    });
  });

  it('persists an explicit skip idempotently', async () => {
    let flow = createFlowSnapshot('deck', { now: 1 });
    const saveConversationFlow = vi.fn((_id: string, next: FlowSnapshot) => {
      flow = next;
    });
    const app = express();
    app.use(express.json());
    registerInspireRoutes(app, {
      listCatalogueEntries: () => catalogue,
      loadConversationFlow: () => flow,
      saveConversationFlow,
      now: () => 10,
    });

    await withServer(app, async (baseUrl) => {
      const url = baseUrl + '/api/conversations/conversation-2/flow/inspire';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'skip' }),
        });
        expect(response.status).toBe(200);
      }
      expect(saveConversationFlow).toHaveBeenCalledTimes(1);
      expect(flow.inspireChoice).toEqual({ templateId: null, skipped: true });
    });
  });
});
