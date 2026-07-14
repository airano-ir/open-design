import {
  FLOW_SHAPES,
  type InspireCatalogueEntry,
  type InspireRankRequest,
  type InspireRankResponse,
  type InspireSearchCandidate,
  type InspireSearchRequest,
  type InspireSearchResponse,
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
  intentMatches: string[];
  matched: Array<{ token: string; weight: number }>;
  score: number;
}

const INTENT_AFFINITIES = [
  {
    label: 'fundraising',
    query: ['seed', 'fundraising', 'fundraise', 'investor', 'venture', 'funding'],
    entry: ['accelerator', 'angel', 'fundraising', 'investor', 'raise', 'venture'],
  },
  {
    label: 'sales',
    query: ['account', 'customer', 'renewal', 'sales'],
    entry: ['account', 'customer', 'renewal', 'sales'],
  },
  {
    label: 'launch',
    query: ['adoption', 'gtm', 'launch', 'release', 'rollout'],
    entry: ['adoption', 'gtm', 'launch', 'release', 'rollout'],
  },
  {
    label: 'operating review',
    query: ['operating', 'qbr', 'quarterly'],
    entry: ['metrics', 'operating', 'qbr', 'quarterly', 'review'],
  },
  {
    label: 'decision document',
    query: ['decision', 'memo', 'proposal', 'rfc'],
    entry: ['decision', 'memo', 'proposal', 'rfc'],
  },
] as const;

const SEMANTIC_CONCEPTS = [
  {
    label: 'presentation',
    query: ['deck', 'keynote', 'pitch', 'powerpoint', 'ppt', 'presentation', 'slides', '幻灯', '演示', '路演'],
    entry: ['deck', 'keynote', 'pitch', 'powerpoint', 'ppt', 'presentation', 'slides', '幻灯', '演示', '路演'],
  },
  {
    label: 'professional business',
    query: ['business', 'corporate', 'executive', 'professional', '商务', '商业', '专业', '企业', '高管'],
    entry: ['business', 'corporate', 'executive', 'finance', 'investor', 'minimal', 'professional', 'report', '商务', '商业', '专业', '企业'],
  },
  {
    label: 'website',
    query: ['homepage', 'landing', 'marketing site', 'website', 'web page', '官网', '网页', '落地页'],
    entry: ['homepage', 'landing', 'marketing', 'prototype', 'site', 'website', 'web', '官网', '网页', '落地页'],
  },
  {
    label: 'product interface',
    query: ['app', 'dashboard', 'mobile', 'product', 'prototype', 'ui', 'wireframe', '产品', '原型', '应用', '界面', '看板', '移动端', '线框'],
    entry: ['app', 'dashboard', 'mobile', 'product', 'prototype', 'ui', 'wireframe', '产品', '原型', '应用', '界面', '看板', '移动端', '线框'],
  },
  {
    label: 'document and report',
    query: ['brief', 'document', 'memo', 'proposal', 'report', '文档', '报告', '方案', '简报'],
    entry: ['brief', 'document', 'memo', 'proposal', 'report', '文档', '报告', '方案', '简报'],
  },
  {
    label: 'image and poster',
    query: ['artwork', 'image', 'illustration', 'poster', 'visual', '图片', '图像', '插画', '海报', '视觉'],
    entry: ['artwork', 'image', 'illustration', 'poster', 'visual', '图片', '图像', '插画', '海报', '视觉'],
  },
  {
    label: 'video and motion',
    query: ['animation', 'motion', 'reel', 'video', '动画', '动效', '视频', '短片'],
    entry: ['animation', 'hyperframes', 'motion', 'reel', 'video', '动画', '动效', '视频', '短片'],
  },
  {
    label: 'audio and voice',
    query: ['audio', 'music', 'podcast', 'speech', 'voice', 'voiceover', '声音', '播客', '语音', '配音', '音乐', '音频'],
    entry: ['audio', 'music', 'podcast', 'speech', 'voice', 'voiceover', '声音', '播客', '语音', '配音', '音乐', '音频'],
  },
  {
    label: 'editorial',
    query: ['editorial', 'magazine', 'publication', 'storytelling', '叙事', '杂志', '编辑感'],
    entry: ['editorial', 'magazine', 'publication', 'storytelling', '叙事', '杂志', '编辑感'],
  },
  {
    label: 'minimal',
    query: ['clean', 'minimal', 'minimalist', 'simple', '克制', '极简', '简洁'],
    entry: ['clean', 'minimal', 'minimalist', 'simple', '克制', '极简', '简洁'],
  },
  {
    label: 'bold and expressive',
    query: ['bold', 'brutalist', 'creative', 'experimental', 'expressive', '大胆', '创意', '实验', '粗野'],
    entry: ['bold', 'brutalist', 'creative', 'experimental', 'expressive', '大胆', '创意', '实验', '粗野'],
  },
  {
    label: 'warm and playful',
    query: ['friendly', 'playful', 'soft', 'warm', '亲切', '柔和', '温暖', '活泼'],
    entry: ['friendly', 'playful', 'soft', 'warm', '亲切', '柔和', '温暖', '活泼'],
  },
  {
    label: 'premium',
    query: ['elegant', 'luxury', 'premium', 'refined', '奢华', '精致', '高级'],
    entry: ['elegant', 'luxury', 'premium', 'refined', '奢华', '精致', '高级'],
  },
] as const;

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
  const entryTokens = new Set(weights.keys());
  const intentMatches: string[] = [];
  for (const affinity of INTENT_AFFINITIES) {
    if (!affinity.query.some((token) => queryTokens.has(token))) continue;
    const matchingEntryTokens = affinity.entry.filter((token) => entryTokens.has(token));
    if (matchingEntryTokens.length === 0) continue;
    intentMatches.push(affinity.label);
    score += 12 + matchingEntryTokens.length * 2;
  }
  matched.sort(
    (left, right) => right.weight - left.weight || compareText(left.token, right.token),
  );
  return { entry, intentMatches, matched, score };
}

function reasonFor(scored: ScoredEntry): string {
  if (scored.intentMatches.length > 0) {
    return 'Matches the ' + scored.intentMatches.join(' and ') + ' intent.';
  }
  const matched = scored.matched.slice(0, 3).map(({ token }) => token);
  if (matched.length > 0) {
    return 'Matches ' + matched.join(', ') + ' in ' + scored.entry.name + '.';
  }
  return scored.entry.name + ' is an eligible ' + scored.entry.mode + ' template.';
}

function searchableText(entry: InspireCatalogueEntry): string {
  return normalizedText(
    entryFields(entry)
      .map((field) => field.value)
      .join(' '),
  );
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(normalizedText(needle)));
}

function semanticMatches(query: string, entry: InspireCatalogueEntry): string[] {
  const normalizedQuery = normalizedText(query);
  const normalizedEntry = searchableText(entry);
  return SEMANTIC_CONCEPTS.flatMap((concept) =>
    includesAny(normalizedQuery, concept.query) && includesAny(normalizedEntry, concept.entry)
      ? [concept.label]
      : [],
  );
}

function shapeAffinity(
  request: InspireSearchRequest,
  entry: InspireSearchCandidate,
): number {
  if (!request.mode) return 0;
  const filter = FLOW_SHAPES[request.mode].inspireFilter;
  let score = 0;
  if (filter.modes.some((mode) => mode.toLowerCase() === entry.mode.toLowerCase())) {
    score += 10;
  }
  if (
    filter.platform &&
    entry.platform?.toLowerCase() === filter.platform.toLowerCase()
  ) {
    score += 4;
  }
  const wantedTags = new Set((filter.tags ?? []).map((tag) => tag.toLowerCase()));
  if ((entry.tags ?? []).some((tag) => wantedTags.has(tag.toLowerCase()))) {
    score += 6;
  }
  return score;
}

function searchReason(
  query: string,
  scored: ScoredEntry,
  concepts: readonly string[],
): string {
  const chinese = /[\u3400-\u9fff]/u.test(query);
  if (concepts.length > 0) {
    const joined = concepts.slice(0, 2).join(chinese ? '、' : ' and ');
    return chinese ? `匹配「${joined}」意图。` : `Matches ${joined} intent.`;
  }
  const matched = scored.matched.slice(0, 3).map(({ token }) => token);
  if (matched.length > 0) {
    return chinese
      ? `匹配关键词：${matched.join('、')}。`
      : `Matches ${matched.join(', ')}.`;
  }
  return chinese ? '匹配当前内容形态。' : 'Matches the requested artifact shape.';
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

/** Semantic-ish local search across community plugins and design templates.
 * It combines exact metadata tokens with bilingual intent/style concepts, so
 * broad asks such as "professional business presentation" can match an
 * investor deck even when those exact words are absent. */
export function searchInspireCatalogue(
  request: InspireSearchRequest,
  catalogue: readonly InspireSearchCandidate[],
): InspireSearchResponse {
  const query = request.query.trim();
  const queryTokens = tokenize(query);
  const source = request.source ?? 'all';
  const requestedLimit = Number.isFinite(request.limit) ? Math.floor(request.limit ?? 12) : 12;
  const limit = Math.max(1, Math.min(50, requestedLimit));
  const seen = new Set<string>();
  const scored = catalogue.flatMap((entry) => {
    if (source !== 'all' && entry.source !== source) return [];
    const key = `${entry.source}:${entry.id.trim()}`;
    if (!entry.id.trim() || seen.has(key)) return [];
    seen.add(key);
    const base = scoreEntry(entry, queryTokens);
    const concepts = semanticMatches(query, entry);
    const exactPhrase = searchableText(entry).includes(normalizedText(query)) ? 40 : 0;
    const score = base.score + concepts.length * 16 + shapeAffinity(request, entry) + exactPhrase;
    if (score <= 0) return [];
    return [{ entry, base: { ...base, score }, concepts, score }];
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      compareText(left.entry.source, right.entry.source) ||
      compareText(left.entry.id, right.entry.id),
  );

  return {
    query,
    semantic: true,
    total: scored.length,
    results: scored.slice(0, limit).map(({ entry, base, concepts, score }) => ({
      id: entry.id,
      title: entry.title,
      ...(entry.description ? { description: entry.description } : {}),
      source: entry.source,
      mode: entry.mode,
      ...(entry.platform !== undefined ? { platform: entry.platform } : {}),
      ...(entry.category !== undefined ? { category: entry.category } : {}),
      ...(entry.scenario !== undefined ? { scenario: entry.scenario } : {}),
      tags: [...(entry.tags ?? [])],
      preview: entry.preview,
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      score,
      reason: searchReason(query, base, concepts),
    })),
  };
}
