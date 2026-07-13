import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');

const promptPaths = [
  'packages/contracts/src/prompts/discovery.ts',
  'apps/daemon/src/prompts/discovery.ts',
] as const;

const languageMatchRule =
  "Match the user's chat language. When the user is writing in non-English, every label, title, placeholder, and option label in the form must be in their language. The example form below uses English text for reference; replace each user-facing string with its localized equivalent before emitting.";

const localizationBullet =
  '- Localize every user-facing string in the form (\\`title\\`, \\`description\\`, the per-question \\`label\\`, \\`placeholder\\`, and option \\`label\\`s) to the user\'s chat language — write what a native speaker would naturally say, never a word-for-word translation (the Chinese title is 快速确认 · 30秒, not the literal 快速简报). Set the top-level \\`"lang"\\` field to the BCP-47 tag of that language (e.g. \\`"zh-CN"\\`, \\`"ja"\\`) so the host renders its built-in controls (the "Other" chip, the custom-answer field) in the same language. \\`id\\`, \\`type\\`, option \\`value\\`, and the stable branch values (\\`pick_direction\\`, \\`brand_spec\\`, \\`reference_match\\`) MUST stay in English because later branch rules match against them.';

describe('discovery prompt localization rules', () => {
  it.each(promptPaths)('%s includes the localized form wording', (promptPath) => {
    const source = readFileSync(resolve(repoRoot, promptPath), 'utf8');

    expect(source).toContain(languageMatchRule);
    expect(source).toContain(localizationBullet);
  });
});
