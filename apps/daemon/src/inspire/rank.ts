import {
  FLOW_SHAPES,
  type InspireCatalogueEntry,
  type InspireRankRequest,
  type InspireRankResponse,
} from '@open-design/contracts';

const TOP_REASON_LIMIT = 4;
const LATIN_STOP_WORDS = new Set([
  'and',
  'are',
  'for',
  'from',
  'into',
  'that',
  'the',
  'this',
  'with',
]);

interface ScoredEntry {
  entry: InspireCatalogueEntry;
  matched: Array<{ token: string; weight: number }>;
  score: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function isCjkCharacter(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);
}

function addCjkTokens(segment: string, tokens: Set<string>): void {
  const characters = Array.from(segment).filter(isCjkCharacter);
  if (characters.length === 1 && characters[0]) {
    tokens.add(characters[0]);
    return;
  }
  for (let index = 0; index < characters.length - 1; index += 1) {
    const left = characters[index];
    const right = characters[index + 1];
    if (left && right) tokens.add(left + right);
  }
}

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  const segments = normalizedText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const segment of segments) {
    if (Array.from(segment).some(isCjkCharacter)) {
      addCjkTokens(segment, tokens);
      continue;
    }
    if (segment.length < 2 || LATIN_STOP_WORDS.has(segment)) continue;
    tokens.add(segment);
  }
  return tokens;
}

function entryFields(
  entry: InspireCatalogueEntry,
): Array<{ value: string; weight: number }> {
  return [
    { value: entry.id, weight: 6 },
    { value: entry.name, weight: 6 },
    { value: (entry.tags ?? []).join(' '), weight: 4 },
    { value: (entry.triggers ?? []).join(' '), weight: 4 },
    { value: (entry.defaultFor ?? []).join(' '), weight: 4 },
    { value: entry.category ?? '', weight: 4 },
    { value: entry.scenario ?? '', weight: 4 },
    { value: entry.description ?? '', weight: 2 },
    { value: entry.examplePrompt ?? '', weight: 2 },
  ];
}

function scoreEntry(entry: InspireCatalogueEntry, queryTokens: ReadonlySet<string>): ScoredEntry {
  const weights = new Map<string, number>();
  for (const field of entryFields(entry)) {
    for (const token of tokenize(field.value)) {
      weights.set(token, Math.max(weights.get(token) ?? 0, field.weight));
    }
  }

  const matched: Array<{ token: string; weight: number }> = [];
  let score = 0;
  for (const token of queryTokens) {
    const weight = weights.get(token);
    if (weight === undefined) continue;
    matched.push({ token, weight });
    score += weight;
  }
  matched.sort(
    (left, right) => right.weight - left.weight || compareText(left.token, right.token),
  );
  return { entry, matched, score };
}

function reasonFor(scored: ScoredEntry): string {
  const matched = scored.matched.slice(0, 3).map(({ token }) => token);
  if (matched.length > 0) {
    return 'Matches ' + matched.join(', ') + ' in ' + scored.entry.name + '.';
  }
  return scored.entry.name + ' is an eligible ' + scored.entry.mode + ' template.';
}

/**
 * Applies the shape registry filter and keeps the first valid entry for each id.
 */
export function filterInspireCatalogue(
  mode: InspireRankRequest['mode'],
  catalogue: readonly InspireCatalogueEntry[],
): InspireCatalogueEntry[] {
  const filter = FLOW_SHAPES[mode].inspireFilter;
  const modes = new Set(filter.modes.map((value) => value.toLowerCase()));
  const platform = filter.platform?.toLowerCase();
  const tags = new Set(
    (filter.tags ?? []).map((value) => value.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const filtered: InspireCatalogueEntry[] = [];

  for (const entry of catalogue) {
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    if (!modes.has(entry.mode.trim().toLowerCase())) continue;
    if (platform && entry.platform?.trim().toLowerCase() !== platform) continue;
    if (
      tags.size > 0 &&
      !(entry.tags ?? []).some((tag) => tags.has(tag.trim().toLowerCase()))
    ) {
      continue;
    }
    seen.add(id);
    filtered.push(id === entry.id ? entry : { ...entry, id });
  }
  return filtered;
}

/**
 * Produces a complete deterministic ranking without network or model calls.
 */
export function rankInspireCatalogue(
  request: InspireRankRequest,
  catalogue: readonly InspireCatalogueEntry[],
): InspireRankResponse {
  const queryTokens = tokenize([request.brief, ...request.outlineTitles].join(' '));
  const scored = filterInspireCatalogue(request.mode, catalogue)
    .map((entry) => scoreEntry(entry, queryTokens))
    .sort(
      (left, right) =>
        right.score - left.score || compareText(left.entry.id, right.entry.id),
    );
  const ranked = scored.map(({ entry }) => entry.id);
  const reasons: Record<string, string> = {};
  for (const candidate of scored.slice(0, TOP_REASON_LIMIT)) {
    reasons[candidate.entry.id] = reasonFor(candidate);
  }
  return { ranked, reasons };
}
