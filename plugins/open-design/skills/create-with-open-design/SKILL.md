---
name: create-with-open-design
description: Create or refine a website, product prototype, presentation, or design system with Open Design. Use whenever the user asks Open Design to make, redesign, or visually systematize an artifact.
---

# Create with Open Design

Use the Open Design MCP tools as the execution surface. Do not generate substitute HTML, slides, or mockups yourself when the user asked Open Design to create the result.

## V1 scope

Handle four jobs:

- Website: use the `frontend-design` skill.
- Product prototype: use the `frontend-design` skill and state the product flows and interactions explicitly in the prompt.
- Presentation: use the `slides` skill. If the user needs a real `.pptx` rather than a browser-rendered deck, confirm that before starting.
- Design system: use `design-md` to extract a reusable system. Apply an existing system by passing its id as `designSystem` when creating the project.

For other artifact types, explain that the first plugin version focuses on these four jobs and offer the nearest supported option.

## Workflow

### Tool availability gate

If the Open Design MCP tools are unavailable in the current task, stop and tell the user to fully quit and relaunch Codex, create a fresh task, and select Open Design again. Do not synthesize a substitute form, ask for the brief as prose, or emit `<question-form>`, `<ask-question>`, JSON, or Markdown form markup. Do not search for or reuse this repository's internal question-form protocol as a fallback.

After installing or updating the plugin, merely refreshing the plugin page or opening a fresh task does not prove that the desktop process reloaded its MCP tool snapshot. The acceptance signal is a real `collect_brief` tool call and Custom UI card after the full relaunch.

1. Confirm the deliverable, audience, goal, required content, visual references, and must-have constraints.
   - Call `collect_brief` whenever any of the five required brief fields is missing. Pass the known values so the OpenDesign Custom UI preserves them as preselected choices, then offers simple goal, audience, content, and visual-style options for anything missing. Do not ask those questions as prose. Do not emit `<question-form>` or JSON form markup; ChatGPT/Codex displays that markup as plain text.
   - The form submits a user message beginning `[OpenDesign brief confirmed]`. Treat its values as the approved brief and continue without asking for the same information again.
   - If the user already supplied all five fields, skip `collect_brief` and continue directly.
2. Call `get_cloud_account` before a generation run.
   - If `canUseCloud` is true, continue; `start_run` always uses Open Design Cloud in V1.
   - If signed out, tell the user to sign in to Open Design and show the returned account link or guidance.
   - If `nextAction` is `recharge`, offer the recharge URL first. Then explain that local Code Agent and BYOK fallbacks are available by opening the project in Open Design; the ChatGPT V1 plugin does not connect to local agents itself.
   - If the wallet status is unavailable, retry it. Never claim the balance is zero when the account request failed.
3. Call `create_project` with a clear human-readable name. Pass `designSystem` when applying a known system.
4. Call `start_run` with the supported `artifactType`, the five-field structured `brief`, and `confirmed: true`. The server maps the artifact type to the approved skill and pins the run to Cloud. Return the progress card; do not wait silently.
5. Poll `get_run` every 30–60 seconds until the run is terminal. Long periods with no file changes are normal agent thinking time; do not cancel unless the user asks.
6. For a website, product prototype, or presentation, treat the run as delivered only when `get_run` returns `status: succeeded`, `artifactCount` greater than zero, and a real `previewUrl`. A Design System delivery instead requires `status: succeeded` and `artifactCount` greater than zero. A process-level success without the required output is incomplete; report the returned error and do not claim the Artifact exists.
7. For a delivered website, prototype, or presentation, use the host's **in-app browser** capability to open two separate tabs before replying: one for `studioUrl` (the exact Open Design project/conversation) and one for `previewUrl` (the rendered Artifact). Do not substitute the system/external browser. If the host has no in-app browser capability, fall back to two clickable links and say that the tabs could not be opened automatically. For a Design System, open the exact `studioUrl`.
8. Keep complex editing, version management, and advanced export in Open Design.
9. For a refinement, reuse the same project and call `start_run` with the requested delta. Do not create a duplicate project unless the user asks.

## Requirement confirmation

Before the first run, summarize the working brief in a compact confirmation:

- Artifact type
- Audience and outcome
- Content/flows
- Visual direction or design-system source
- Output format

If the user already supplied all five, proceed without an extra confirmation turn. Otherwise the confirmation must happen through the `collect_brief` Custom UI, never through a literal text form.

## Safety and quality

- Never expose Open Design access tokens, Cloud control keys, runtime keys, or raw credentials in chat or Artifact output.
- Treat `get_cloud_account` failures as unavailable, not as a numeric balance.
- Do not pass an agent id to `start_run`; the V1 server pins generation to Open Design Cloud after checking the signed-in account and wallet.
- Use explicit project ids after project creation so active-context drift cannot target the wrong project.
- Never delete a project or file as part of cleanup unless the user explicitly requests it.
- Surface the real Open Design result and URLs. Do not imply a design exists until `get_run` reports success.
- Never open the Open Design origin, `/`, or `/onboarding` as a substitute for a returned URL. For browser artifacts, open the exact `studioUrl` and `previewUrl`; for Design Systems, open the exact `studioUrl`.
