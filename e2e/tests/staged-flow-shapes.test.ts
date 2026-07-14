import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLOW_SHAPES,
  type FlowShapeId,
} from '@open-design/contracts';
import { describe, expect, it } from 'vitest';

interface TemplateMetadata {
  id: string;
  mode: string;
  platform?: string;
  tags: string[];
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const templatesRoot = path.join(repoRoot, 'design-templates');
const REQUESTED_SHAPES: readonly FlowShapeId[] = [
  'prototype',
  'landing',
  'mobile',
  'webapp',
  'document',
  'report',
];

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  return new RegExp(`^  ${key}:\\s*([^\\n]+)$`, 'mu')
    .exec(frontmatter)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/gu, '');
}

function frontmatterTags(frontmatter: string): string[] {
  const block = /^tags:\s*\n((?:  - .+(?:\n|$))*)/mu.exec(frontmatter)?.[1] ?? '';
  return block
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*-\s*/u, '').replace(/^['"]|['"]$/gu, '').trim())
    .filter(Boolean);
}

async function readTemplateMetadata(): Promise<TemplateMetadata[]> {
  const entries = await readdir(templatesRoot, { withFileTypes: true });
  const templates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<TemplateMetadata | null> => {
        const skillPath = path.join(templatesRoot, entry.name, 'SKILL.md');
        const content = await readFile(skillPath, 'utf8').catch(() => '');
        const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1] ?? '';
        const mode = frontmatterValue(frontmatter, 'mode');
        if (!mode) return null;
        const platform = frontmatterValue(frontmatter, 'platform');
        return {
          id: entry.name,
          mode,
          ...(platform ? { platform } : {}),
          tags: frontmatterTags(frontmatter),
        };
      }),
  );
  return templates.filter(
    (template): template is TemplateMetadata => template !== null,
  );
}

describe('staged-flow shape resource closure', () => {
  it('[P1] keeps valuable inspiration choices available for every requested shape', async () => {
    const templates = await readTemplateMetadata();

    for (const shape of REQUESTED_SHAPES) {
      const filter = FLOW_SHAPES[shape].inspireFilter;
      const eligible = templates.filter(
        (template) =>
          filter.modes.includes(template.mode) &&
          (!filter.platform || template.platform === filter.platform) &&
          (!filter.tags?.length ||
            template.tags.some((tag) => filter.tags?.includes(tag))),
      );

      expect(
        eligible.length,
        `${shape} needs at least three tagged inspiration templates`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
