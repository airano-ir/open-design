import type { SkillSummary } from '../types';

export const DEFAULT_BRAND_ENRICHMENT_SKILL_IDS = [
  'design-md',
  'design-review',
  'color-expert',
  'brand-guidelines',
] as const;

const AI_OPTIMIZE_QUALITY_BAR = [
  'AI Optimize quality bar:',
  '- Treat this as a longer background-quality pass that may take 10-20 minutes; prioritize completeness and recoverable incremental progress over a quick superficial answer.',
  '- Keep this run scoped to the current design-system project and update the existing registered design system in place. Do not create a duplicate system.',
  '- Use the attached design-system skills as internal lenses: DESIGN.md structure, design review, color expertise, and brand-guideline completeness. Do not ask the user to choose skills.',
  '- Read the current project evidence before editing: context/source notes, DESIGN.md, BRAND.md, brand.json, system/variables.css, system/theme.json, kit.html, kit.dark.html, preview cards, assets/, logos/, imagery/, fonts/, and source_examples/ when present.',
  '- Re-measure reachable website, HTML, CSS, Figma, GitHub, or local-code evidence instead of guessing. Extract exact color literals and semantic roles, @font-face/font-family data, spacing, radius, shadows, layout posture, motion/interaction states, copy voice, logo candidates, and representative hero/product imagery.',
  '- Preserve real assets. Save useful logos, icons, cover images, screenshots, illustrations, and fonts as project files when source evidence exposes them; do not redraw brand marks or substitute generated placeholders when real files are available.',
  '- Strengthen the complete reusable package: DESIGN.md, README.md, SKILL.md, brand.json, colors/type tokens, light and dark kit quality, focused preview cards, and component/UI-kit guidance. Keep file manifests synchronized with the files you actually write.',
  '- Progressively write valid partial updates and keep the preview recoverable. If a field group is ready, update it and continue; do not wait until the end to write everything.',
  '- Run the available preview/finalize/audit commands for this project when they exist, fix validation errors, and leave explicit caveats for evidence that could not be measured.',
  '- Do not get stuck on blocked sources. If the live site is an anti-bot verification page, emit a question-form asking the user to complete verification; otherwise continue from existing local evidence and record the limitation.',
  '- Finish by summarizing what was improved, which files changed, and any remaining gaps.',
].join('\n');

const FALLBACK_BRAND_ENRICHMENT_PROMPT = [
  'AI optimize this Open Design design system in place.',
  '',
  'A fast programmatic extraction already produced a usable design system, but it may be thin or approximate. Run a deeper asynchronous extraction pass now and turn it into a production-usable design-system package.',
  '',
  AI_OPTIMIZE_QUALITY_BAR,
].join('\n');

export function installedBrandEnrichmentSkillIds(
  skills: readonly Pick<SkillSummary, 'id'>[],
): string[] {
  const installed = new Set(skills.map((skill) => skill.id));
  return DEFAULT_BRAND_ENRICHMENT_SKILL_IDS.filter((id) => installed.has(id));
}

export function buildBrandEnrichmentPrompt(existingPrompt?: string | null): string {
  const trimmed = existingPrompt?.trim();
  if (!trimmed) return FALLBACK_BRAND_ENRICHMENT_PROMPT;
  if (trimmed.includes('AI Optimize quality bar:')) return trimmed;
  return [
    trimmed,
    '',
    AI_OPTIMIZE_QUALITY_BAR,
  ].join('\n');
}
