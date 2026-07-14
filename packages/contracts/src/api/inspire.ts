import type { FlowShapeId, FlowSnapshot } from './flow.js';

/** Minimal template metadata consumed by deterministic inspiration ranking. */
export interface InspireCatalogueEntry {
  id: string;
  name: string;
  description?: string;
  mode: string;
  platform?: string | null;
  tags?: readonly string[];
  triggers?: readonly string[];
  category?: string | null;
  scenario?: string | null;
  examplePrompt?: string;
  defaultFor?: readonly string[];
}

/** `POST /api/inspire/rank` request. */
export interface InspireRankRequest {
  brief: string;
  outlineTitles: string[];
  mode: FlowShapeId;
}

/** `POST /api/inspire/rank` response. */
export interface InspireRankResponse {
  /** Every eligible template id, ordered best-first and de-duplicated. */
  ranked: string[];
  /** One-line explanations for the leading recommendations only. */
  reasons: Record<string, string>;
}

export type InspireSearchSource = 'community' | 'design-template';

export type InspireSearchPreview =
  | { kind: 'html'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string; posterUrl?: string }
  | { kind: 'none' };

/** Searchable community/template metadata. Kept free of daemon filesystem
 * details so the same shape can safely cross HTTP and CLI boundaries. */
export interface InspireSearchCandidate extends InspireCatalogueEntry {
  title: string;
  source: InspireSearchSource;
  preview: InspireSearchPreview;
  /** Localized starter prompt supplied by the catalogue entry, when present. */
  prompt?: string;
}

/** `POST /api/inspire/search` request. */
export interface InspireSearchRequest {
  query: string;
  /** Omit to search every source. */
  source?: InspireSearchSource | 'all';
  /** Optional staged-flow shape used as a structural relevance hint. */
  mode?: FlowShapeId;
  /** Defaults to 12 and is clamped by the daemon. */
  limit?: number;
  /** Locale used for catalogue titles, descriptions, and starter prompts. */
  locale?: string;
}

export interface InspireSearchResult {
  id: string;
  title: string;
  description?: string;
  source: InspireSearchSource;
  mode: string;
  platform?: string | null;
  category?: string | null;
  scenario?: string | null;
  tags: string[];
  preview: InspireSearchPreview;
  prompt?: string;
  score: number;
  reason: string;
}

/** `POST /api/inspire/search` response. */
export interface InspireSearchResponse {
  query: string;
  /** True means intent/synonym concepts participated in ranking. */
  semantic: true;
  /** Matches before the response limit is applied. */
  total: number;
  results: InspireSearchResult[];
}

/** `POST /api/conversations/:id/flow/inspire` request. */
export type InspireChoiceRequest =
  | { action: 'apply'; templateId: string }
  | { action: 'skip' };

/** `POST /api/conversations/:id/flow/inspire` response. */
export interface InspireChoiceResponse {
  conversationId: string;
  flow: FlowSnapshot;
}
