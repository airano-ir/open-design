import {
  FLOW_SHAPES,
  type FlowShapeId,
  type FlowSnapshot,
  type InspireCatalogueEntry,
  type InspireChoiceRequest,
  type InspireChoiceResponse,
  type InspireRankRequest,
  type InspireRankResponse,
  type InspireSearchCandidate,
  type InspireSearchRequest,
  type InspireSearchResponse,
} from '@open-design/contracts';
import type { Express } from 'express';

import { applyInspireChoice } from '../inspire/choice.js';
import {
  filterInspireCatalogue,
  rankInspireCatalogue,
  searchInspireCatalogue,
} from '../inspire/rank.js';

type MaybePromise<T> = T | Promise<T>;

export interface RegisterInspireRoutesDeps {
  listCatalogueEntries: () => MaybePromise<readonly InspireCatalogueEntry[]>;
  listSearchEntries?: (
    locale?: string,
  ) => MaybePromise<readonly InspireSearchCandidate[]>;
  loadConversationFlow: (
    conversationId: string,
  ) => MaybePromise<FlowSnapshot | null | undefined>;
  saveConversationFlow: (
    conversationId: string,
    flow: FlowSnapshot,
  ) => MaybePromise<void>;
  applyTemplate?: (
    conversationId: string,
    templateId: string,
  ) => MaybePromise<void>;
  now?: () => number;
}

function parseSearchRequest(value: unknown): InspireSearchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return null;
  const source = body.source;
  if (
    source !== undefined &&
    source !== 'all' &&
    source !== 'community' &&
    source !== 'design-template'
  ) {
    return null;
  }
  if (body.mode !== undefined && !isFlowShapeId(body.mode)) return null;
  const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
    ? body.limit
    : undefined;
  const locale = typeof body.locale === 'string' && body.locale.trim()
    ? body.locale.trim()
    : undefined;
  return {
    query,
    ...(source ? { source } : {}),
    ...(body.mode ? { mode: body.mode } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(locale ? { locale } : {}),
  };
}

function isFlowShapeId(value: unknown): value is FlowShapeId {
  return typeof value === 'string' && Object.hasOwn(FLOW_SHAPES, value);
}

function parseRankRequest(value: unknown): InspireRankRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.brief !== 'string' || !body.brief.trim()) return null;
  if (!Array.isArray(body.outlineTitles) || !body.outlineTitles.every(
    (title) => typeof title === 'string',
  )) {
    return null;
  }
  if (!isFlowShapeId(body.mode)) return null;
  return {
    brief: body.brief.trim(),
    outlineTitles: body.outlineTitles.map((title) => title.trim()),
    mode: body.mode,
  };
}

function parseChoiceRequest(value: unknown): InspireChoiceRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.action === 'skip') return { action: 'skip' };
  if (body.action !== 'apply' || typeof body.templateId !== 'string') return null;
  const templateId = body.templateId.trim();
  return templateId ? { action: 'apply', templateId } : null;
}

export function registerInspireRoutes(
  app: Express,
  deps: RegisterInspireRoutesDeps,
): void {
  const now = deps.now ?? Date.now;

  app.post('/api/inspire/rank', async (req, res) => {
    const request = parseRankRequest(req.body);
    if (!request) {
      res.status(400).json({
        error: 'brief, outlineTitles, and a valid flow mode are required',
      });
      return;
    }
    try {
      const body: InspireRankResponse = rankInspireCatalogue(
        request,
        await deps.listCatalogueEntries(),
      );
      res.json(body);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/inspire/search', async (req, res) => {
    const request = parseSearchRequest(req.body);
    if (!request) {
      res.status(400).json({
        error: 'query is required; source and mode must be valid when provided',
      });
      return;
    }
    if (!deps.listSearchEntries) {
      res.status(501).json({ error: 'inspiration search is not configured' });
      return;
    }
    try {
      const body: InspireSearchResponse = searchInspireCatalogue(
        request,
        await deps.listSearchEntries(request.locale),
      );
      res.json(body);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/conversations/:id/flow/inspire', async (req, res) => {
    const request = parseChoiceRequest(req.body);
    if (!request) {
      res.status(400).json({ error: 'action must be apply or skip' });
      return;
    }

    const conversationId = String(req.params.id ?? '');
    try {
      const current = await deps.loadConversationFlow(conversationId);
      if (current === undefined) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }
      if (current === null) {
        res.status(409).json({ error: 'conversation flow is not initialized' });
        return;
      }

      if (!current.inspireChoice && request.action === 'apply') {
        const eligible = filterInspireCatalogue(
          current.shape,
          await deps.listCatalogueEntries(),
        );
        if (!eligible.some((entry) => entry.id === request.templateId)) {
          res.status(400).json({ error: 'templateId is not eligible for this flow' });
          return;
        }
      }

      const result = applyInspireChoice(current, request, now());
      if (result.status === 'conflict') {
        res.status(409).json({ error: 'inspiration choice is already finalized' });
        return;
      }
      if (result.status === 'updated') {
        if (request.action === 'apply') {
          await deps.applyTemplate?.(conversationId, request.templateId);
        }
        await deps.saveConversationFlow(conversationId, result.flow);
      }
      const body: InspireChoiceResponse = {
        conversationId,
        flow: result.flow,
      };
      res.json(body);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
