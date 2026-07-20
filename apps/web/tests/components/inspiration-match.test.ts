import { describe, expect, it } from 'vitest';
import {
  buildTemplateMatchDoc,
  filterBySearch,
  matchesAllTokens,
  rankByRelevance,
  scoreTemplateDoc,
  swatchVividness,
  tokenizeQuery,
  tokenizeSearch,
  type TemplateMatchInput,
} from '../../src/components/inspiration-match';

const TEMPLATES: TemplateMatchInput[] = [
  {
    id: 'blog-post',
    name: 'Editorial Blog Post',
    triggers: ['blog', 'article', 'editorial', '博客', '文章'],
    category: 'marketing-gtm',
    categoryLabel: '市场增长',
    scenario: 'marketing',
    description: 'A long-form editorial blog post with a hero and pull quotes.',
  },
  {
    id: 'pitch-deck',
    name: 'Investor Pitch Deck',
    triggers: ['pitch', 'deck', 'investor', 'fundraising', '融资', '路演'],
    category: 'fundraising-pitch',
    categoryLabel: '融资路演',
    scenario: 'finance',
    description: 'Seed-stage investor deck: problem, solution, traction, ask.',
  },
  {
    id: 'clinical-case-report',
    // Mirrors the real catalogue: an English-only name whose Chinese reach
    // comes entirely from triggers.
    name: 'Clinical Case Report',
    nameAliases: ['临床病例报告'],
    triggers: ['clinical', 'patient', 'case report', '病例', '临床'],
    category: 'academic-research',
    categoryLabel: '学术研究',
    scenario: 'healthcare',
    description: 'Structured clinical case write-up for peer review.',
  },
];

const docs = new Map(TEMPLATES.map((tpl) => [tpl.id, buildTemplateMatchDoc(tpl)]));
const docFor = (id: string) => docs.get(id);
const rankIds = (query: string) =>
  rankByRelevance(
    TEMPLATES.map((tpl) => tpl.id),
    tokenizeQuery(query),
    docFor,
  );

describe('tokenizeQuery', () => {
  it('splits latin text into words and drops filler', () => {
    expect(tokenizeQuery('I need a deck for the investors')).toEqual([
      'deck',
      'investors',
    ]);
  });

  it('expands a CJK run into the run plus its bigrams', () => {
    expect(tokenizeQuery('融资路演')).toEqual(['融资路演', '融资', '资路', '路演']);
  });

  it('keeps both sides of a mixed latin/CJK run', () => {
    expect(tokenizeQuery('b2b销售')).toContain('b2b');
    expect(tokenizeQuery('b2b销售')).toContain('销售');
  });

  it('returns nothing for empty or punctuation-only input', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('  —— !! ')).toEqual([]);
  });
});

describe('scoreTemplateDoc', () => {
  it('scores a name hit above a description-only hit', () => {
    const nameHit = scoreTemplateDoc(docFor('pitch-deck')!, tokenizeQuery('pitch'));
    const descHit = scoreTemplateDoc(docFor('pitch-deck')!, tokenizeQuery('traction'));
    expect(nameHit).toBeGreaterThan(descHit);
    expect(descHit).toBeGreaterThan(0);
  });

  it('is zero when nothing matches', () => {
    expect(scoreTemplateDoc(docFor('blog-post')!, tokenizeQuery('kubernetes'))).toBe(0);
  });

  it('rewards covering more of the query', () => {
    const broad = scoreTemplateDoc(
      docFor('pitch-deck')!,
      tokenizeQuery('investor pitch deck fundraising'),
    );
    const narrow = scoreTemplateDoc(docFor('pitch-deck')!, tokenizeQuery('investor'));
    expect(broad).toBeGreaterThan(narrow);
  });
});

describe('rankByRelevance', () => {
  it('surfaces the template that fits the request, not catalog order', () => {
    expect(rankIds('a fundraising deck for seed investors')[0]).toBe('pitch-deck');
    expect(rankIds('write up a patient case for peer review')[0]).toBe(
      'clinical-case-report',
    );
  });

  it('matches a Chinese task summary through trigger keywords', () => {
    expect(rankIds('帮我做一个融资路演的材料')[0]).toBe('pitch-deck');
    expect(rankIds('我要写一篇博客文章')[0]).toBe('blog-post');
  });

  it('matches through the localized category label', () => {
    expect(rankIds('学术研究相关的东西')[0]).toBe('clinical-case-report');
  });

  it('keeps catalog order when there is no query', () => {
    expect(rankIds('')).toEqual(['blog-post', 'pitch-deck', 'clinical-case-report']);
  });

  it('leaves non-matching templates behind the matches in catalog order', () => {
    // Only the deck matches; the other two keep their relative order.
    expect(rankIds('investor')).toEqual([
      'pitch-deck',
      'blog-post',
      'clinical-case-report',
    ]);
  });
});

describe('tokenizeSearch', () => {
  it('keeps a CJK phrase whole instead of expanding it into bigrams', () => {
    // The ranking tokenizer expands; the search tokenizer must not, or the
    // junk bigram straddling the word boundary would be ANDed in.
    expect(tokenizeQuery('临床病例')).toContain('床病');
    expect(tokenizeSearch('临床病例')).toEqual(['临床病例']);
  });

  it('splits on whitespace so each typed word is its own requirement', () => {
    expect(tokenizeSearch('investor  deck')).toEqual(['investor', 'deck']);
  });

  it('keeps a single CJK character but drops a single latin one', () => {
    expect(tokenizeSearch('报')).toEqual(['报']);
    expect(tokenizeSearch('a')).toEqual([]);
  });
});

describe('matchesAllTokens', () => {
  it('finds a CJK phrase by substring rather than demanding every bigram', () => {
    const clinical = docFor('clinical-case-report')!;
    // The regression this guards: ranking tokens include "床病", which the
    // alias "临床病例报告" does contain — but "例报告" style boundaries in
    // other names would not, so search must go through tokenizeSearch.
    expect(matchesAllTokens(clinical, tokenizeSearch('临床病例'))).toBe(true);
    expect(matchesAllTokens(clinical, tokenizeSearch('病例报告'))).toBe(true);
    expect(matchesAllTokens(clinical, tokenizeSearch('融资'))).toBe(false);
  });

  it('reaches an English-only template from a translated UI via aliases', () => {
    // Half the real catalogue has no zh-CN display name; the alias field is
    // what keeps those templates searchable in either language.
    expect(matchesAllTokens(docFor('clinical-case-report')!, tokenizeSearch('clinical'))).toBe(
      true,
    );
    expect(matchesAllTokens(docFor('clinical-case-report')!, tokenizeSearch('临床病例报告'))).toBe(
      true,
    );
  });

  it('requires every keyword to hit some attribute (AND, not OR)', () => {
    const deck = docFor('pitch-deck')!;
    // "investor" is in the name, "fundraising" is a trigger — both hit.
    expect(matchesAllTokens(deck, tokenizeQuery('investor fundraising'))).toBe(true);
    // "investor" hits but "clinical" does not, so the AND fails.
    expect(matchesAllTokens(deck, tokenizeQuery('investor clinical'))).toBe(false);
  });

  it('matches keywords spread across different attributes', () => {
    // name + category label + scenario, none of which share a field.
    expect(
      matchesAllTokens(docFor('clinical-case-report')!, tokenizeQuery('report 学术 healthcare')),
    ).toBe(true);
  });

  it('accepts everything when the search box is empty', () => {
    expect(matchesAllTokens(docFor('blog-post')!, [])).toBe(true);
  });
});

describe('swatchVividness', () => {
  it('ranks a palette with a real accent above a greyscale one', () => {
    const accent = swatchVividness(['#111111', '#f5f1e8', '#c96442']);
    const grey = swatchVividness(['#222222', '#eeeeee']);
    expect(accent).toBeGreaterThan(grey);
    expect(grey).toBe(0);
  });

  it('rewards a second chromatic swatch', () => {
    const one = swatchVividness(['#ffffff', '#ff0000']);
    const two = swatchVividness(['#00ff00', '#ff0000']);
    expect(two).toBeGreaterThan(one);
  });

  it('survives short hex, missing values, and unparseable entries', () => {
    expect(swatchVividness(['#f00'])).toBeGreaterThan(0);
    expect(swatchVividness([])).toBe(0);
    expect(swatchVividness(undefined)).toBe(0);
    expect(swatchVividness(['transparent', 'rebeccapurple'])).toBe(0);
  });
});

describe('rankByRelevance appeal weighting', () => {
  const appeal = (id: string) => (id === 'blog-post' ? 1 : 0);
  const ranked = (query: string) =>
    rankByRelevance(
      TEMPLATES.map((tpl) => tpl.id),
      tokenizeQuery(query),
      docFor,
      appeal,
    );

  it('orders purely by appeal when there is no query', () => {
    expect(ranked('')[0]).toBe('blog-post');
  });

  it('never lets a good-looking entry outrank a relevant one', () => {
    // blog-post has maximum appeal but nothing to do with fundraising.
    expect(ranked('investor pitch deck fundraising')[0]).toBe('pitch-deck');
  });

  it('keeps a strong name match ahead of a pretty description match', () => {
    // "report" hits blog-post (description, plus full appeal) and clinical
    // (name); the name hit still wins, so appeal nudges rather than overrides.
    expect(ranked('report')[0]).toBe('clinical-case-report');
  });
});

describe('filterBySearch', () => {
  const ids = TEMPLATES.map((tpl) => tpl.id);
  const run = (query: string) =>
    filterBySearch(ids, tokenizeSearch(query), tokenizeQuery(query), docFor);

  it('narrows as keywords are added', () => {
    expect(run('investor deck')).toEqual(['pitch-deck']);
  });

  it('returns everything when the query is empty', () => {
    expect(run('')).toEqual(ids);
  });

  it('falls back to any-keyword matches instead of an empty gallery', () => {
    // No single template carries both terms, so strict AND finds nothing —
    // the fallback still surfaces matches rather than a blank grid.
    const hits = run('临床 融资');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('clinical-case-report');
  });

  it('returns nothing when no keyword matches at all', () => {
    expect(run('kubernetes helm')).toEqual([]);
  });
});
