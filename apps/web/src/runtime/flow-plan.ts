import { FLOW_SHAPES, type FlowShapeId } from '@open-design/contracts';

export interface FlowPlanItem {
  id: string;
  title: string;
  points: string[];
}

const ITEM_HEADING_RE = /^#{2,3}\s+(?:(\d+)[\s.、:：-]*)?(.*)$/u;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)、])\s+(.+)$/u;

export function primaryFlowPlanArtifact(shape: FlowShapeId): string {
  const artifact = FLOW_SHAPES[shape].planArtifacts.find(
    (path) => path !== 'generated/brief.md',
  );
  return artifact ?? FLOW_SHAPES[shape].planArtifacts[0] ?? 'generated/plan.md';
}

export function defaultFlowPlan(shape: FlowShapeId): FlowPlanItem[] {
  return FLOW_SHAPES[shape].plan.defaultItems.map((item, index) => ({
    id: `plan-item-${index + 1}`,
    title: item.title,
    points: [...item.points],
  }));
}

export function parseFlowPlanMarkdown(
  markdown: string,
  shape: FlowShapeId,
): FlowPlanItem[] {
  const items: FlowPlanItem[] = [];
  let current: FlowPlanItem | null = null;

  for (const line of markdown.split(/\r?\n/u)) {
    const heading = ITEM_HEADING_RE.exec(line.trim());
    if (heading) {
      const itemNumber = heading[1] ?? String(items.length + 1);
      const title =
        heading[2]?.trim() ||
        `${FLOW_SHAPES[shape].plan.itemLabel} ${itemNumber}`;
      current = {
        id: `plan-item-${itemNumber}`,
        title,
        points: [],
      };
      items.push(current);
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet?.[1] && current) current.points.push(bullet[1].trim());
  }

  return items.length > 0 ? items : defaultFlowPlan(shape);
}

export function serializeFlowPlanMarkdown(
  items: readonly FlowPlanItem[],
  shape: FlowShapeId,
): string {
  const spec = FLOW_SHAPES[shape].plan;
  const normalized = items.length > 0 ? items : defaultFlowPlan(shape);
  const sections = normalized.map((item, index) => {
    const title = item.title.trim() || `${spec.itemLabel} ${index + 1}`;
    const points = item.points
      .map((point) => point.trim())
      .filter(Boolean)
      .map((point) => `- ${point}`)
      .join('\n');
    return `## ${index + 1}. ${title}${points ? `\n${points}` : ''}`;
  });
  return `# ${spec.title}\n\n${sections.join('\n\n')}\n`;
}
