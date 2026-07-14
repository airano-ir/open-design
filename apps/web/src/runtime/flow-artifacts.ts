import { FLOW_SHAPES, type FlowSnapshot, type FlowStageId } from '@open-design/contracts';

import type { ProjectFile } from '../types';

export type FlowStageArtifactPaths = Partial<Record<FlowStageId, string[]>>;

const FLOW_MARKDOWN_ARTIFACT_PATHS = new Set<string>(
  Object.values(FLOW_SHAPES).flatMap((shape) => shape.planArtifacts),
);

export function isFlowStageArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/^[/\\]+/u, '');
  return (
    FLOW_MARKDOWN_ARTIFACT_PATHS.has(normalized) ||
    normalized === 'generated/research.md' ||
    normalized === 'generated/research-report.md' ||
    (normalized.startsWith('research/') && normalized.endsWith('.md'))
  );
}

/**
 * Keep the materialized template shell visible until a streamed deck has a
 * real body to replace it. Early deltas such as `<html><head>…` otherwise
 * navigate the preview iframe to an effectively blank document.
 */
export function renderableStreamingDeckHtml(
  html: string | null | undefined,
): string | undefined {
  if (!html) return undefined;
  const bodyStart = html.search(/<body\b[^>]*>/iu);
  if (bodyStart < 0) return undefined;
  const body = html.slice(bodyStart).replace(/^<body\b[^>]*>/iu, '');
  const hasVisibleElement =
    /<(?!script\b|style\b|link\b|meta\b|title\b)[a-z][^>]*>/iu.test(body);
  const text = body
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?(?:<\/(?:script|style)>|$)/giu, '')
    .replace(/<[^>]*>/gu, '')
    .trim();
  return hasVisibleElement || text ? html : undefined;
}

/**
 * Projects durable flow files back onto progress-card stages. The files remain
 * ordinary Design Files; this mapping only provides a stable chat-side entry.
 */
export function flowStageArtifactPaths(
  flow: FlowSnapshot,
  files: ProjectFile[],
): FlowStageArtifactPaths {
  const fileByName = new Map(files.map((file) => [file.name, file]));
  const result: FlowStageArtifactPaths = {};

  addExisting(result, 'clarify', ['generated/brief.md'], fileByName);

  const research = files
    .filter(
      (file) =>
        file.name === 'generated/research.md' ||
        file.name === 'generated/research-report.md' ||
        (file.name.startsWith('research/') && file.name.endsWith('.md')),
    )
    .sort((left, right) => right.mtime - left.mtime)
    .map((file) => file.name);
  if (research.length > 0) result.research = research;

  addExisting(
    result,
    'plan',
    FLOW_SHAPES[flow.shape].planArtifacts.filter(
      (artifact) => artifact !== 'generated/brief.md',
    ),
    fileByName,
  );
  addExisting(result, 'inspire', ['generated/inspiration.json'], fileByName);

  const generated = generationCandidates(flow, files);
  if (generated.length > 0) result.generate = generated;

  const delivered = files
    .filter((file) => /\.(?:pptx|pdf|zip)$/iu.test(file.name))
    .sort((left, right) => right.mtime - left.mtime)
    .map((file) => file.name);
  if (delivered.length > 0) result.deliver = delivered;

  return result;
}

function addExisting(
  result: FlowStageArtifactPaths,
  stage: FlowStageId,
  candidates: readonly string[],
  fileByName: ReadonlyMap<string, ProjectFile>,
): void {
  const existing = candidates.filter((candidate) => fileByName.has(candidate));
  if (existing.length > 0) result[stage] = existing;
}

function generationCandidates(flow: FlowSnapshot, files: ProjectFile[]): string[] {
  const spec = FLOW_SHAPES[flow.shape];
  const extensions = spec.generateExtensions;
  const supportingArtifacts = new Set([
    'generated/brief.md',
    'generated/research.md',
    'generated/research-report.md',
    'generated/inspiration.json',
    ...spec.planArtifacts,
  ]);
  const matching = files.filter((file) => {
    if (
      file.name.startsWith('research/') ||
      supportingArtifacts.has(file.name)
    ) {
      return false;
    }
    const lower = file.name.toLowerCase();
    return extensions.some((extension) => lower.endsWith(extension));
  });
  return matching
    .sort((left, right) => {
      if (left.name === 'index.html') return -1;
      if (right.name === 'index.html') return 1;
      return right.mtime - left.mtime;
    })
    .map((file) => file.name);
}
