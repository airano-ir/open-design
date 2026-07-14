import { describe, expect, it } from 'vitest';
import type { FlowShapeId } from '@open-design/contracts';

import {
  defaultFlowPlan,
  parseFlowPlanMarkdown,
  primaryFlowPlanArtifact,
  serializeFlowPlanMarkdown,
} from '../../src/runtime/flow-plan';

describe('shape-aware staged-flow plans', () => {
  it.each([
    ['deck', 'generated/outline.md', 'Deck outline', 'Slide'],
    ['prototype', 'generated/prototype-plan.md', 'Prototype plan', 'View'],
    ['landing', 'generated/structure.md', 'Landing-page structure', 'Section'],
    ['mobile', 'generated/flows.md', 'Mobile flow', 'Screen'],
    ['webapp', 'generated/plan.md', 'Web-app plan', 'Page'],
    ['document', 'generated/toc.md', 'Document table of contents', 'Chapter'],
    ['report', 'generated/outline.md', 'Report outline', 'Chapter'],
  ] as const)(
    'round-trips the %s plan grammar',
    (shape, artifactPath, heading, itemLabel) => {
      expect(primaryFlowPlanArtifact(shape)).toBe(artifactPath);
      const defaults = defaultFlowPlan(shape);
      const markdown = serializeFlowPlanMarkdown(defaults, shape);
      expect(markdown).toContain(`# ${heading}`);
      expect(markdown).toContain('## 1.');

      const parsed = parseFlowPlanMarkdown(markdown, shape);
      expect(parsed).toEqual(defaults);
      expect(parsed[0]?.title).not.toBe(`${itemLabel} 1`);
    },
  );

  it('uses shape defaults when an artifact is empty or incomplete', () => {
    const shapes: FlowShapeId[] = [
      'prototype',
      'landing',
      'mobile',
      'webapp',
      'document',
      'report',
    ];
    for (const shape of shapes) {
      expect(parseFlowPlanMarkdown('', shape)).toEqual(defaultFlowPlan(shape));
    }
  });
});
