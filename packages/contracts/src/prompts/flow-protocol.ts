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
    'This protocol overrides active skill, plugin, pipeline, Todo, and verification instructions whenever they would continue past the current user-visible checkpoint. Completing the whole artifact in one turn is a correctness failure, not helpful autonomy.',
    'Narrate every stage transition by emitting ONE self-closing marker on its own line, exactly:',
    '<od-flow stage="plan" state="active" detail="one short line in the user\'s language"/>',
    '- stage ∈ clarify | research | plan | inspire | generate | deliver; state ∈ active | complete | skipped | error.',
    '- Emit state="active" when you begin a stage, state="complete" when it ends, and state="skipped" with a one-line reason in detail when you intentionally skip one.',
    '- While generating, refresh progress with done/total counts: <od-flow stage="generate" state="active" done="3" total="12"/>.',
    '- Markers are machine protocol, not prose: never mention them to the user, never wrap them in code fences, and never leave a started stage without a terminal marker.',
    `- Task shape: ${shape}. In the plan stage, write ${artifacts} before any renderable artifact. Run the research stage only when the task needs external facts (or the user enabled deep research); otherwise emit state="skipped" for it.`,
    `- Clarify only missing essentials for this shape: ${spec.clarifyDefaults.join(', ')}. Pre-fill safe defaults so the user can continue without typing.`,
    `- Plan grammar: start with \`# ${plan.title}\`, then one \`## N. ${plan.itemLabel} title\` heading per item with ${plan.pointsLabel.toLowerCase()} as \`-\` bullets. ${plan.instructions} Keep this structure stable so the user can edit, add, remove, and reorder items in the plan panel.`,
    '- HARD TURN BOUNDARY: after writing the plan artifacts, emit a <question-form id="plan-confirm"> with exactly one required radio question. Its defaultValue must be "confirm"; options must be "confirm" (labelled with the exact unit count, such as "✓ Confirm, generate 12 slides") and "modify" ("I want to make changes"), with allowCustom enabled. Then END THE TURN IMMEDIATELY.',
    '- At that boundary, do not continue remaining Todos, copy a seed, run final-artifact checks, invoke generation tools, or write any renderable/final artifact. Reading framework references is allowed; applying them is not.',
    '- Never create or edit HTML, images, video, audio, or another final artifact before the user submits the plan-confirm form with the confirm option. If they request changes, update the plan artifact and ask for confirmation again.',
    '- In the inspire stage, wait for the explicit [inspiration — template-id] or skip message. Apply the selected design-template as the visual source of truth.',
    `- Generate a usable framework or document skeleton first, then fill it ${plan.itemLabel.toLowerCase()}-by-${plan.itemLabel.toLowerCase()} or in small batches. Persist each batch and emit generate progress after every batch so the preview remains continuously useful and does not flicker.`,
    `- Delivery actions for this shape are: ${spec.deliverActions.join(', ')}. End only after the primary artifact is usable and the deliver stage is active.`,
  ].join('\n');
}

export function renderPlanConfirmationForm(
  shape: FlowShapeId,
  locale?: string | null,
): string {
  const chinese = typeof locale === 'string' && locale.toLowerCase().startsWith('zh');
  const form = chinese
    ? {
        title: '确认方案',
        description: `请先检查并按需编辑${FLOW_SHAPES[shape].plan.title}，确认后再进入灵感选择与生成。`,
        questions: [
          {
            id: 'decision',
            label: '这个方案可以继续吗？',
            type: 'radio',
            required: true,
            defaultValue: 'confirm',
            allowCustom: true,
            customLabel: '补充修改要求',
            customPlaceholder: '描述需要调整的内容',
            options: [
              { value: 'confirm', label: '✓ 确认并继续' },
              { value: 'modify', label: '我要修改' },
            ],
          },
        ],
        submitLabel: '继续',
      }
    : {
        title: 'Confirm the plan',
        description: `Review or edit the ${FLOW_SHAPES[shape].plan.title.toLowerCase()} before choosing inspiration and generating.`,
        questions: [
          {
            id: 'decision',
            label: 'Is this plan ready to continue?',
            type: 'radio',
            required: true,
            defaultValue: 'confirm',
            allowCustom: true,
            customLabel: 'Describe a change',
            customPlaceholder: 'What should be adjusted?',
            options: [
              { value: 'confirm', label: '✓ Confirm and continue' },
              { value: 'modify', label: 'I want to make changes' },
            ],
          },
        ],
        submitLabel: 'Continue',
      };

  return [
    '<question-form id="plan-confirm">',
    JSON.stringify(form, null, 2),
    '</question-form>',
  ].join('\n');
}
