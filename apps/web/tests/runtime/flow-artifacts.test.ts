import { describe, expect, it } from 'vitest';
import { createFlowSnapshot } from '@open-design/contracts';

import {
  flowStageArtifactPaths,
  isFlowStageArtifactPath,
  renderableStreamingDeckHtml,
} from '../../src/runtime/flow-artifacts';
import type { ProjectFile } from '../../src/types';

function file(
  name: string,
  kind: ProjectFile['kind'],
  mtime: number,
): ProjectFile {
  return {
    name,
    size: 1,
    mtime,
    kind,
    mime: 'text/plain',
  };
}

describe('flowStageArtifactPaths', () => {
  it('recognizes durable stage markdown that should open in preview mode', () => {
    expect(isFlowStageArtifactPath('generated/brief.md')).toBe(true);
    expect(isFlowStageArtifactPath('generated/outline.md')).toBe(true);
    expect(isFlowStageArtifactPath('research/market.md')).toBe(true);
    expect(isFlowStageArtifactPath('notes.md')).toBe(false);
  });

  it('maps durable workflow files and final output back to their stages', () => {
    const result = flowStageArtifactPaths(createFlowSnapshot('deck'), [
      file('generated/brief.md', 'text', 1),
      file('research/market.md', 'text', 2),
      file('generated/outline.md', 'text', 3),
      file('generated/inspiration.json', 'text', 4),
      file('alternate.html', 'html', 6),
      file('index.html', 'html', 5),
      file('deck.pdf', 'pdf', 7),
    ]);

    expect(result).toEqual({
      clarify: ['generated/brief.md'],
      research: ['research/market.md'],
      plan: ['generated/outline.md'],
      inspire: ['generated/inspiration.json'],
      generate: ['index.html', 'alternate.html'],
      deliver: ['deck.pdf'],
    });
  });

  it.each([
    ['prototype', 'generated/prototype-plan.md', 'concept.html', 'html'],
    ['landing', 'generated/structure.md', 'index.html', 'html'],
    ['mobile', 'generated/flows.md', 'mobile.html', 'html'],
    ['webapp', 'generated/plan.md', 'dashboard.html', 'html'],
    ['document', 'generated/toc.md', 'decision-memo.md', 'text'],
    ['report', 'generated/outline.md', 'operating-review.html', 'html'],
  ] as const)(
    'maps %s plan and generation artifacts from the shared registry',
    (shape, planPath, artifactPath, kind) => {
      const result = flowStageArtifactPaths(createFlowSnapshot(shape), [
        file(planPath, 'text', 1),
        file(artifactPath, kind, 2),
      ]);

      expect(result.plan).toEqual([planPath]);
      expect(result.generate).toEqual([artifactPath]);
    },
  );

  it('keeps the template shell visible until streamed deck HTML has body content', () => {
    expect(
      renderableStreamingDeckHtml('<html><head><style>body{color:red}</style>'),
    ).toBeUndefined();
    expect(
      renderableStreamingDeckHtml('<html><head></head><body><script>boot()</script>'),
    ).toBeUndefined();

    const visible =
      '<html><head></head><body><section class="slide">Opening</section>';
    expect(renderableStreamingDeckHtml(visible)).toBe(visible);
  });
});
