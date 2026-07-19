import { describe, expect, it } from 'vitest';

import {
  findFirstQuestionForm,
  formatFormAnswers,
  inspirationEntryForDesignSystem,
  inspirationEntryForTemplate,
  parseInspirationSelection,
  splitOnQuestionForms,
} from '../../src/artifacts/question-form';
import { parseSubmittedAnswers } from '../../src/components/QuestionForm';

const inspirationFormMarkup = `Before we build, want to ground this in a reference?

<question-form id="inspiration" title="Pick a reference — optional">
{
  "questions": [
    {
      "id": "inspiration",
      "label": "Ground this task in a reference",
      "type": "inspiration",
      "query": "product landing page",
      "sources": ["templates", "design-systems", "upload"],
      "help": "Skipping is fine."
    }
  ]
}
</question-form>`;

describe('inspiration question parsing', () => {
  it('parses the inspiration type with sources and query', () => {
    const found = findFirstQuestionForm(inspirationFormMarkup);
    expect(found).not.toBeNull();
    const q = found!.form.questions[0]!;
    expect(q.type).toBe('inspiration');
    expect(q.query).toBe('product landing page');
    expect(q.sources).toEqual(['templates', 'design-systems', 'upload']);
  });

  it('normalizes type aliases to inspiration', () => {
    for (const alias of ['inspiration-picker', 'inspiration-cards', 'INSPIRATION']) {
      const markup = `<question-form id="i"><!-- -->
{ "questions": [ { "id": "q", "label": "Ref", "type": "${alias}" } ] }
</question-form>`.replace('<!-- -->', '');
      const found = findFirstQuestionForm(markup);
      expect(found?.form.questions[0]?.type).toBe('inspiration');
    }
  });

  it('drops unknown sources and keeps the question renderable prose-free', () => {
    const markup = `<question-form id="i">
{ "questions": [ { "id": "q", "label": "Ref", "type": "inspiration", "sources": ["templates", "bogus"] } ] }
</question-form>`;
    const segments = splitOnQuestionForms(markup);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.kind).toBe('form');
    const q = segments[0]!.kind === 'form' ? segments[0]!.form.questions[0]! : null;
    expect(q?.sources).toEqual(['templates']);
  });
});

describe('inspiration selection wire format', () => {
  it('builds entries whose labels stay readable and ids machine-stable', () => {
    const entry = inspirationEntryForTemplate('deck-fundraising', 'Fundraising, [Pitch]');
    expect(entry).toBe('Fundraising Pitch [template:deck-fundraising]');
    const dsEntry = inspirationEntryForDesignSystem('user:editorial', 'Editorial');
    expect(dsEntry).toBe('Editorial [ds:user:editorial]');
  });

  it('round-trips template, design-system, and upload entries', () => {
    const value = [
      inspirationEntryForTemplate('deck-fundraising', 'Fundraising Pitch'),
      inspirationEntryForDesignSystem('user:editorial', 'Editorial'),
      'reference-shot.png',
    ];
    const selection = parseInspirationSelection(value);
    expect(selection.templates).toEqual([
      { id: 'deck-fundraising', label: 'Fundraising Pitch' },
    ]);
    expect(selection.designSystems).toEqual([
      { id: 'user:editorial', label: 'Editorial' },
    ]);
    expect(selection.uploads).toEqual(['reference-shot.png']);
  });

  it('treats empty and skipped values as no selection', () => {
    expect(parseInspirationSelection(undefined)).toEqual({
      templates: [],
      designSystems: [],
      uploads: [],
    });
    expect(parseInspirationSelection(['(skipped)']).templates).toEqual([]);
    expect(parseInspirationSelection('').uploads).toEqual([]);
  });

  it('survives the formatFormAnswers → parseSubmittedAnswers round trip', () => {
    const found = findFirstQuestionForm(inspirationFormMarkup);
    const form = found!.form;
    const answers = {
      inspiration: [
        inspirationEntryForTemplate('deck-fundraising', 'Fundraising Pitch'),
        inspirationEntryForDesignSystem('user:editorial', 'Editorial'),
      ],
    };
    const text = formatFormAnswers(form, answers);
    expect(text).toContain('[form answers — inspiration]');
    expect(text).toContain('Fundraising Pitch [template:deck-fundraising]');

    const parsedBack = parseSubmittedAnswers(form, text);
    expect(parsedBack).not.toBeNull();
    const selection = parseInspirationSelection(parsedBack!.inspiration);
    expect(selection.templates.map((t) => t.id)).toEqual(['deck-fundraising']);
    expect(selection.designSystems.map((d) => d.id)).toEqual(['user:editorial']);
  });

  it('serializes an empty pick as (skipped)', () => {
    const found = findFirstQuestionForm(inspirationFormMarkup);
    const text = formatFormAnswers(found!.form, { inspiration: [] });
    expect(text).toContain('Ground this task in a reference: (skipped)');
  });
});
