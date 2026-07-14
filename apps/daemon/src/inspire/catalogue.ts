import {
  resolveLocalizedText,
  type InspireSearchCandidate,
  type InstalledPluginRecord,
  type SkillSummary,
} from '@open-design/contracts';

function encodeAssetPath(value: string): string {
  return value
    .replace(/^\.\//, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function pluginAssetUrl(pluginId: string, value: string | undefined): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path || /^https?:/iu.test(path)) return null;
  if (path.startsWith('/api/')) return path;
  const encoded = encodeAssetPath(path);
  return encoded
    ? `/api/plugins/${encodeURIComponent(pluginId)}/asset/${encoded}`
    : null;
}

function exampleStem(path: string | undefined): string | null {
  if (!path) return null;
  const base = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? '';
  return base.replace(/\.[^.]+$/u, '') || null;
}

function pluginPreview(plugin: InstalledPluginRecord): InspireSearchCandidate['preview'] {
  const preview = plugin.manifest.od?.preview;
  const type = preview?.type?.toLowerCase();
  const videoPath = preview?.video;
  if (type === 'video' || videoPath) {
    const url = pluginAssetUrl(plugin.id, videoPath);
    const posterUrl = pluginAssetUrl(plugin.id, preview?.poster ?? preview?.gif);
    if (url) {
      return {
        kind: 'video',
        url,
        ...(posterUrl ? { posterUrl } : {}),
      };
    }
  }
  if (type === 'image' || preview?.poster || preview?.gif) {
    const url = pluginAssetUrl(plugin.id, preview?.poster ?? preview?.gif);
    if (url) return { kind: 'image', url };
  }
  if (type === 'html' || preview?.entry) {
    return {
      kind: 'html',
      url: `/api/plugins/${encodeURIComponent(plugin.id)}/preview`,
    };
  }
  const firstExample = plugin.manifest.od?.useCase?.exampleOutputs?.[0];
  const stem = exampleStem(firstExample?.path);
  if (stem) {
    return {
      kind: 'html',
      url: `/api/plugins/${encodeURIComponent(plugin.id)}/example/${encodeURIComponent(stem)}`,
    };
  }
  return { kind: 'none' };
}

export function communityInspireCandidates(
  plugins: readonly InstalledPluginRecord[],
  locale?: string,
): InspireSearchCandidate[] {
  return plugins.flatMap((plugin) => {
    if (plugin.manifest.od?.kind === 'atom') return [];
    const title =
      resolveLocalizedText(plugin.manifest.title_i18n, locale) ||
      plugin.title ||
      plugin.manifest.title ||
      plugin.id;
    const description =
      resolveLocalizedText(plugin.manifest.description_i18n, locale) ||
      plugin.manifest.description;
    const prompt = resolveLocalizedText(plugin.manifest.od?.useCase?.query, locale);
    const mode = plugin.manifest.od?.mode ?? 'utility';
    const scenario = plugin.manifest.od?.scenario;
    const tags = Array.from(new Set([
      ...(plugin.manifest.tags ?? []),
      mode,
      ...(scenario ? [scenario] : []),
      ...(plugin.manifest.od?.taskKind ? [plugin.manifest.od.taskKind] : []),
    ]));
    return [{
      id: plugin.id,
      name: title,
      title,
      ...(description ? { description } : {}),
      mode,
      ...(plugin.manifest.od?.platform
        ? { platform: plugin.manifest.od.platform }
        : {}),
      tags,
      triggers: prompt ? [prompt] : [],
      category: scenario ?? mode,
      ...(scenario ? { scenario } : {}),
      ...(prompt ? { examplePrompt: prompt, prompt } : {}),
      source: 'community' as const,
      preview: pluginPreview(plugin),
    }];
  });
}

export function designTemplateInspireCandidates(
  templates: readonly SkillSummary[],
  locale?: string,
): InspireSearchCandidate[] {
  return templates.map((template) => {
    const title = template.displayName?.[locale ?? ''] ?? template.name;
    return {
      id: template.id,
      name: title,
      title,
      ...(template.description ? { description: template.description } : {}),
      mode: template.mode,
      ...(template.platform !== undefined ? { platform: template.platform } : {}),
      tags: [...(template.tags ?? [])],
      triggers: template.triggers.filter(
        (trigger): trigger is string => typeof trigger === 'string',
      ),
      ...(template.category !== undefined ? { category: template.category } : {}),
      ...(template.scenario !== undefined ? { scenario: template.scenario } : {}),
      ...(template.examplePrompt
        ? { examplePrompt: template.examplePrompt, prompt: template.examplePrompt }
        : {}),
      defaultFor: template.defaultFor,
      source: 'design-template',
      preview: {
        kind: 'html',
        url: `/api/skills/${encodeURIComponent(template.id)}/example`,
      },
    };
  });
}
