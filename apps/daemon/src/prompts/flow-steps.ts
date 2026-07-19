/**
 * Prompt flow steps — pluggable "one more step before building" stages.
 *
 * A flow step is pure data: a section the prompt composer may include for a
 * run (`heading` marks it), the `<question-form>` id that section tells the
 * model to emit (`id`), and the per-turn texts the chat route injects on the
 * brief-answered turn when the step is still pending. The route itself stays
 * generic: it asks `pendingPromptFlowStep` which registered step (if any) is
 * declared by the composed system prompt but not yet surfaced in the
 * conversation, and injects that step's texts instead of the build-now
 * override. Later stages of the staged flow (research, plan, …) — or steps a
 * skill contributes — register here without touching the route.
 *
 * The inspiration step is the first registrant: its section
 * (`INSPIRATION_STEP_GUIDANCE` in prompts/system.ts) is composed only for
 * ungrounded runs (no active design system, no picked template), so its
 * pending state doubles as "this run has no visual grounding yet".
 */

export interface PromptFlowStep {
  /** `<question-form>` id the step's section instructs the model to emit. */
  id: string;
  /**
   * Marker that proves the step's section was composed into this run's
   * system prompt. Keep the leading newline: a real section heading sits at
   * the start of a line, while other prompt sections may MENTION the
   * heading inline (e.g. discovery's Branch B exception quotes it in
   * backticks) without declaring the step for this run. Match on the stable
   * heading prefix, not the full title, so wording tweaks after the em-dash
   * don't silently unregister the step.
   */
  heading: string;
  /**
   * Replaces FORM_ANSWERED_SYSTEM_OVERRIDE in the `# Instructions` block on
   * the turn where the brief (discovery / task-type) answers land and this
   * step is still pending.
   */
  formAnsweredOverride: string;
  /**
   * Replaces the "Continue with RULE 2 / RULE 3 now" line in the form-answer
   * transition prepended to the user request on that same turn.
   */
  transitionLine: string;
}

export const INSPIRATION_FLOW_STEP: PromptFlowStep = {
  id: 'inspiration',
  heading: '\n## Inspiration step',
  formAnsweredOverride: `## OVERRIDE — brief answered; the inspiration step comes next (this is turn 2 or later)

The user already submitted their brief form answers (see # User request
below). Do not re-ask the brief: no \`<question-form>\` with id \`discovery\`
or \`task-type\`, no markdown \`\`\`json fenced block echoing a form schema, no
form-asking prose such as "Got it — tell me the following" or
"请告诉我以下信息", and no narrated fake system events such as
"subagents stopped" or "server restart".

This run has no active design system and no picked template, so the
"## Inspiration step" section of the system prompt applies NOW, before any
building:

Required output for this turn:
- One short prose line confirming the locked brief.
- Then the single \`<question-form id="inspiration">\` block (localized) as
  that section describes, and stop the turn.
- Do NOT plan, build, write files, or call tools this turn; the user's
  picks (or an explicit skip) arrive as the next message, and the host
  applies a picked template/design system to the run automatically.

Exception — skip the inspiration form and continue the normal
brief-to-build flow when the submitted answers already provide or promise
a brand/reference source (\`brand\` value \`brand_spec\` / \`reference_match\`,
attached reference files/screenshots, or a reference URL).

`,
  transitionLine:
    'This run is still ungrounded (no active design system, no picked template). Reply with a short confirmation of the locked brief plus the single `<question-form id="inspiration">` block from the Inspiration step section, then stop; build only after the picks (or an explicit skip) come back. If the answers already provide or promise a brand/reference source, skip the inspiration form and continue the brand-source flow now.',
};

/**
 * Registered steps, in precedence order: the first step whose section is
 * composed for the run and whose form has not yet appeared in the
 * conversation wins the brief-answered turn.
 */
export const PROMPT_FLOW_STEPS: readonly PromptFlowStep[] = [INSPIRATION_FLOW_STEP];

function stepAlreadySurfaced(step: PromptFlowStep, transcript: string): boolean {
  if (transcript.length === 0) return false;
  // Two independent signals, because history renderers differ: the literal
  // form markup from the assistant turn that offered the step, and the
  // `[form answers — <id>]` header from the user turn that answered (or
  // skipped) it — some clients trim assistant markup out of the transcript.
  if (transcript.includes(`<question-form id="${step.id}"`)) return true;
  const answersHeader = new RegExp(`\\[form answers\\s*[—\\-:]\\s*${step.id}\\]`, 'i');
  return answersHeader.test(transcript);
}

/**
 * Resolve which registered flow step (if any) is pending for this turn:
 * declared by the composed system prompt, not yet surfaced in the
 * conversation. Deterministic on purpose — the daemon knows the run's
 * grounding state, so the model must never be left to reconcile a
 * "build now" override against a prompt section telling it to ask first.
 */
export function pendingPromptFlowStep({
  composedSystemPrompt,
  transcript,
  steps = PROMPT_FLOW_STEPS,
}: {
  composedSystemPrompt: string | null | undefined;
  transcript: string | null | undefined;
  steps?: readonly PromptFlowStep[];
}): PromptFlowStep | null {
  const prompt = typeof composedSystemPrompt === 'string' ? composedSystemPrompt : '';
  if (prompt.length === 0) return null;
  const history = typeof transcript === 'string' ? transcript : '';
  for (const step of steps) {
    if (!prompt.includes(step.heading)) continue;
    if (stepAlreadySurfaced(step, history)) continue;
    return step;
  }
  return null;
}
