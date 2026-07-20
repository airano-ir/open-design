/**
 * Relevance matching for the inspiration template catalog.
 *
 * The catalog ships far more attributes than the picker used to read: every
 * template carries `triggers` (~8 keywords each), a `category` slug, a
 * `scenario`, and a localized name/description. Ignoring them meant the
 * inline grid always showed the first four templates in catalog order — the
 * same four for "a pitch deck for investors" and "a clinical case report".
 *
 * Two jobs share one tokenizer here:
 *
 *  - **ranking** — order the catalog by how well each template fits the
 *    question's task summary, so the four inline cards are the four most
 *    relevant ones for *this* request;
 *  - **searching** — multi-keyword AND filtering in the browse-all gallery,
 *    matched across every attribute rather than the name alone.
 *
 * CJK has no word boundaries and we have no segmenter, so a Han/Kana/Hangul
 * run is expanded into its character bigrams ("落地页" -> 落地, 地页). Only
 * the query side needs expanding: a bigram is already a substring of the
 * haystack it should match, so plain `includes` connects a Chinese task
 * summary to a template's Chinese display name or trigger list.
 */

/** Longest CJK run we bother expanding — beyond this it is a sentence, not a term. */
const MAX_CJK_RUN = 16;
/** Ranking is a relevance hint, not a search index; a long brief is capped. */
const MAX_TOKENS = 24;

// Latin filler that would otherwise match nearly every description, plus the
// handful of Chinese function words that survive bigram expansion.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'for', 'from',
  'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'need',
  'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them', 'then', 'they',
  'this', 'to', 'up', 'use', 'want', 'was', 'we', 'what', 'when', 'which',
  'will', 'with', 'you', 'your',
  '一个', '我们', '我的', '需要', '想要',
  '可以', '一份', '这个', '那个', '什么',
  '帮我', '一下', '的话',
]);

// Han + Hiragana/Katakana + Hangul, written as escapes so the intent survives
// any re-encoding of this file.
const CJK_RANGE =
  '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af';
const CJK = new RegExp(`[${CJK_RANGE}]`);
const CJK_ONLY = new RegExp(`^[${CJK_RANGE}]+$`);
const CJK_RUN = new RegExp(`([${CJK_RANGE}]+)`);
const SEPARATORS = /[^\p{L}\p{N}]+/u;

/**
 * Split free text into comparable tokens. Latin words come through whole;
 * CJK runs come through as the run itself plus its character bigrams, which
 * is what lets a Chinese query hit a Chinese haystack without segmentation.
 */
export function tokenizeQuery(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();

  const push = (token: string) => {
    if (token.length === 0 || seen.has(token) || STOPWORDS.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };

  for (const rawSegment of text.toLowerCase().split(SEPARATORS)) {
    if (rawSegment.length === 0 || tokens.length >= MAX_TOKENS) continue;
    if (!CJK.test(rawSegment)) {
      // Single Latin letters/digits carry no signal on their own.
      if (rawSegment.length >= 2) push(rawSegment);
      continue;
    }
    if (CJK_ONLY.test(rawSegment)) {
      if (rawSegment.length <= MAX_CJK_RUN) push(rawSegment);
      for (let i = 0; i + 2 <= rawSegment.length && i < MAX_CJK_RUN; i += 1) {
        push(rawSegment.slice(i, i + 2));
      }
      continue;
    }
    // Mixed run (e.g. "b2b销售"): keep it whole, and let each side through too.
    push(rawSegment);
    for (const part of rawSegment.split(CJK_RUN)) {
      if (part.length >= 2 && part !== rawSegment) push(part);
    }
  }

  return tokens.slice(0, MAX_TOKENS);
}

/**
 * Tokens for the search box, where the rules are different from ranking.
 *
 * Bigram expansion is a *ranking* device: it lets a loose sentence brush
 * against a name. Applying it to an AND filter would be a bug — typing
 * 临床病例 would expand to 临床病例 + 临床 + 床病 + 病例 and demand that a
 * template contain all four, so the junk bigram straddling the word boundary
 * ("床病") would return zero results for a perfectly good query.
 *
 * A search box wants plain substring semantics per typed word, which CJK
 * already gets for free: "临床病例" is a substring of "临床病例报告".
 */
export function tokenizeSearch(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const segment of text.toLowerCase().split(SEPARATORS)) {
    if (segment.length === 0 || seen.has(segment)) continue;
    // A lone Latin character is noise; a lone CJK character is a real word.
    if (segment.length < 2 && !CJK.test(segment)) continue;
    seen.add(segment);
    tokens.push(segment);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

/** Per-attribute weights: a name hit means far more than a description hit. */
const FIELD_WEIGHTS = [
  ['name', 6],
  ['triggers', 4],
  ['category', 3],
  ['scenario', 2],
  ['description', 1.5],
  ['id', 1],
] as const;

export interface TemplateMatchDoc {
  id: string;
  name: string;
  triggers: string;
  category: string;
  scenario: string;
  description: string;
  featured: number;
}

export interface TemplateMatchInput {
  id: string;
  /** Localized display name. */
  name: string;
  /**
   * Every other display name the template carries (its other locales, plus
   * the raw skill name). Only about half the catalog is translated, so a
   * Chinese-UI user searching "clinical" must still reach an English-only
   * template — and vice versa. Aliases are searched, never displayed.
   */
  nameAliases?: readonly string[];
  triggers?: string[] | null;
  /** Raw slug plus the localized category label, both searchable. */
  category?: string | null;
  categoryLabel?: string;
  scenario?: string | null;
  /** Localized description. */
  description?: string;
  featured?: number | null;
}

/** Pre-lowercase every searchable attribute once, so scoring stays cheap. */
export function buildTemplateMatchDoc(input: TemplateMatchInput): TemplateMatchDoc {
  return {
    id: input.id.toLowerCase(),
    name: [input.name, ...(input.nameAliases ?? [])].join(' ').toLowerCase(),
    triggers: (input.triggers ?? []).join(' ').toLowerCase(),
    category: `${input.category ?? ''} ${input.categoryLabel ?? ''}`.toLowerCase(),
    scenario: (input.scenario ?? '').toLowerCase(),
    description: (input.description ?? '').toLowerCase(),
    featured: input.featured ?? 0,
  };
}

/**
 * Relevance of one template to a tokenized query. Each token contributes the
 * weight of the *strongest* attribute it hits (so a token repeated across a
 * long description cannot outrank a name match), and the total is scaled by
 * how many of the query's concepts were covered — a template matching three
 * of four ideas beats one matching a single idea very hard.
 *
 * Returns 0 when nothing matched, which callers treat as "unranked".
 */
export function scoreTemplateDoc(doc: TemplateMatchDoc, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  let matched = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [field, weight] of FIELD_WEIGHTS) {
      if (weight > best && doc[field].includes(token)) best = weight;
    }
    if (best > 0) {
      matched += 1;
      total += best;
    }
  }
  if (matched === 0) return 0;
  const coverage = 1 + matched / tokens.length;
  return total * coverage + doc.featured * 0.01;
}

/** True when every token appears in at least one attribute (AND semantics). */
export function matchesAllTokens(doc: TemplateMatchDoc, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((token) =>
    FIELD_WEIGHTS.some(([field]) => doc[field].includes(token)),
  );
}

/**
 * The catalogue search used by both the template and the design-system
 * gallery, so the two behave identically.
 *
 * Strict AND first, because that is what makes extra keywords *narrow*.
 * When AND finds nothing, fall back to matching ANY keyword rather than
 * showing an empty gallery — against a half-translated catalogue a perfectly
 * reasonable pair like "设计打磨 落地页" (a category label plus a surface
 * word) is carried by no single entry. Either way the survivors come back
 * ranked, so the closest match still leads.
 *
 * `searchTokens` should come from `tokenizeSearch` (substring semantics) and
 * `rankTokens` from `tokenizeQuery` (bigram-expanded, for ordering only).
 */
export function filterBySearch<T>(
  items: readonly T[],
  searchTokens: string[],
  rankTokens: string[],
  docFor: (item: T) => TemplateMatchDoc | undefined,
  appealFor?: (item: T) => number,
): T[] {
  if (searchTokens.length === 0) return items.slice();
  const rank = (subset: T[]) => rankByRelevance(subset, rankTokens, docFor, appealFor);
  const strict = items.filter((item) => {
    const doc = docFor(item);
    return doc ? matchesAllTokens(doc, searchTokens) : false;
  });
  if (strict.length > 0) return rank(strict);
  const loose = items.filter((item) => {
    const doc = docFor(item);
    return doc ? searchTokens.some((token) => matchesAllTokens(doc, [token])) : false;
  });
  return rank(loose);
}

/**
 * How eye-catching a swatch row is, 0..1 — the "颜色色块很酷的" signal for
 * design systems. Every system in the catalogue ships exactly four swatches,
 * so the count says nothing; what separates a striking palette from a beige
 * one is whether any swatch carries real chroma.
 *
 * Chroma here is plain RGB range (max - min channel), which is enough to tell
 * a vivid accent from a grey, and a second chromatic swatch adds a smaller
 * bonus so two-colour palettes beat a single pop of colour on white.
 * Unparseable entries (named colours, `transparent`, gradients) score 0.
 */
export function swatchVividness(swatches: readonly string[] | undefined): number {
  if (!swatches || swatches.length === 0) return 0;
  const chromas: number[] = [];
  for (const swatch of swatches) {
    const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(swatch.trim());
    if (!hex) continue;
    let body = hex[1]!;
    if (body.length === 3) body = body.replace(/./g, (c) => c + c);
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    chromas.push((Math.max(r, g, b) - Math.min(r, g, b)) / 255);
  }
  if (chromas.length === 0) return 0;
  chromas.sort((a, b) => b - a);
  // Weighted rather than clamped: a saturated accent would otherwise peg the
  // score at 1 and swallow the second swatch's contribution entirely, so two
  // vivid colours would tie with one. This stays in 0..1 by construction.
  return chromas[0]! * 0.8 + (chromas[1] ?? 0) * 0.2;
}

/**
 * How much visual appeal is allowed to move an item. Deliberately smaller
 * than a name hit (6) and larger than a description hit (1.5): a pretty
 * template can jump a weak match, never a strong one.
 */
const APPEAL_WEIGHT = 3;

/**
 * Stable relevance sort with an optional visual-appeal nudge.
 *
 * Ordering contract, in priority order:
 *  1. anything the query matched outranks anything it did not — appeal can
 *     never promote an off-topic entry above a relevant one;
 *  2. within the matches, relevance dominates and appeal breaks near-ties;
 *  3. within the non-matches (and when there is no query at all), the
 *     best-looking entries come first.
 *
 * With neither tokens nor an appeal function the input order is preserved.
 */
export function rankByRelevance<T>(
  items: readonly T[],
  tokens: string[],
  docFor: (item: T) => TemplateMatchDoc | undefined,
  appealFor?: (item: T) => number,
): T[] {
  if (tokens.length === 0 && !appealFor) return items.slice();
  return items
    .map((item, index) => {
      const doc = docFor(item);
      const relevance = doc && tokens.length > 0 ? scoreTemplateDoc(doc, tokens) : 0;
      const appeal = appealFor?.(item) ?? 0;
      return {
        item,
        index,
        appeal,
        // -1 keeps every unmatched entry strictly behind every matched one.
        score: relevance > 0 ? relevance + appeal * APPEAL_WEIGHT : -1,
      };
    })
    .sort((a, b) => b.score - a.score || b.appeal - a.appeal || a.index - b.index)
    .map((entry) => entry.item);
}
