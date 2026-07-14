/**
 * Staged-flow prompt segment (specs/current/staged-flow-north-star.zh-CN.md §5.2).
 *
 * Single source of truth for the `<od-flow …/>` marker contract the agent is
 * asked to follow. Both prompt composers (daemon local runs and the BYOK/API
 * mirror) splice this block in verbatim for flow-shaped runs, so the wording
 * cannot drift between surfaces. Stage duties are rendered from the
 * `FLOW_SHAPES` registry — the same registry the web progress card and the
 * CLI read — keeping prompt and UI in lockstep per shape.
 */

import { FLOW_SHAPES, type FlowShapeId } from '../api/flow.js';

export function renderFlowProtocol(shape: FlowShapeId): string {
  const spec = FLOW_SHAPES[shape];
  const artifacts = spec.planArtifacts.join(', ');
  const plan = spec.plan;
  return [
    '## Staged flow protocol',
    '',
    'This conversation follows a fixed, user-visible pipeline: clarify → research → plan → inspire → generate → deliver. The UI renders these stages as a progress card; you drive it.',
    'Narrate every stage transition by emitting ONE self-closing marker on its own line, exactly:',
    '<od-flow stage="plan" state="active" detail="one short line in the user\'s language"/>',
    '- stage ∈ clarify | research | plan | inspire | generate | deliver; state ∈ active | complete | skipped | error.',
    '- Emit state="active" when you begin a stage, state="complete" when it ends, and state="skipped" with a one-line reason in detail when you intentionally skip one.',
    '- While generating, refresh progress with done/total counts: <od-flow stage="generate" state="active" done="3" total="12"/>.',
    '- Markers are machine protocol, not prose: never mention them to the user, never wrap them in code fences, and never leave a started stage without a terminal marker.',
    `- Task shape: ${shape}. In the plan stage, write ${artifacts} before any renderable artifact. Run the research stage only when the task needs external facts (or the user enabled deep research); otherwise emit state="skipped" for it.`,
    `- Clarify only missing essentials for this shape: ${spec.clarifyDefaults.join(', ')}. Pre-fill safe defaults so the user can continue without typing.`,
    `- Plan grammar: start with \`# ${plan.title}\`, then one \`## N. ${plan.itemLabel} title\` heading per item with ${plan.pointsLabel.toLowerCase()} as \`-\` bullets. ${plan.instructions} Keep this structure stable so the user can edit, add, remove, and reorder items in the plan panel.`,
    '- After writing the plan artifacts, STOP and emit a <question-form id="plan-confirm"> with exactly one required radio question. Its defaultValue must be "confirm"; options must be "confirm" (labelled with the exact unit count, such as "✓ Confirm, generate 12 slides") and "modify" ("I want to make changes"), with allowCustom enabled.',
    '- Never create or edit HTML, images, video, audio, or another final artifact before the user submits the plan-confirm form with the confirm option. If they request changes, update the plan artifact and ask for confirmation again.',
    '- In the inspire stage, wait for the explicit [inspiration — template-id] or skip message. Apply the selected design-template as the visual source of truth.',
    `- Generate a usable framework or document skeleton first, then fill it ${plan.itemLabel.toLowerCase()}-by-${plan.itemLabel.toLowerCase()} or in small batches. Persist each batch and emit generate progress after every batch so the preview remains continuously useful and does not flicker.`,
    `- Delivery actions for this shape are: ${spec.deliverActions.join(', ')}. End only after the primary artifact is usable and the deliver stage is active.`,
  ].join('\n');
}
