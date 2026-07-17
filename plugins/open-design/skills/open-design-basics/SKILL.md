---
name: open-design-basics
description: Shared execution contract for the Open Design artifact skills. Use together with a specific create-*-with-open-design skill after the user explicitly selects or names Open Design; do not use as a generic design-artifact router.
---

# Open Design Basics

Apply this contract before executing any Open Design artifact skill. Let the artifact-specific skill choose the `artifactType`, brief presets, internal workflow, and delivery checks.

## Fail closed when tools are unavailable

- Use the Open Design MCP tools as the only execution surface. Do not create substitute HTML, slides, images, media, documents, or mockups yourself.
- If the tools are missing, stop. Tell the user to fully quit and relaunch Codex, create a fresh task, and select Open Design again.
- Treat a real `collect_brief` tool call with a rendered Custom UI card as the reload signal. Refreshing the plugin page or merely opening another task is not proof.
- Never fall back to prose questions, `<question-form>`, `<ask-question>`, JSON, Markdown form markup, or a hand-written pseudo-form. Those surfaces render as text instead of the Open Design Custom UI.

## Confirm the brief through choice-only UI

1. Establish the audience, outcome, content or flows, creative direction, output format, and must-have constraints.
2. If any required value is missing, call `collect_brief` with the artifact-specific `artifactType` and every known value.
3. Keep every user-facing field choice-only: radio buttons for one choice and checkboxes for multiple choices. Never request typed project names, audience, outcome, content, visual or sonic direction, format, duration, aspect, or constraints.
4. Infer the project name and fixed output contract. Preserve user-supplied wording as a preselected **From your brief** choice instead of placing it in an editable field.
5. Treat a submitted message beginning `[OpenDesign brief confirmed]` as the approved brief. Do not ask for those values again.
6. If all required values were already supplied, skip `collect_brief` and continue directly.

## Check Cloud access

1. Call `get_cloud_account` before generation.
2. Continue only when `canUseCloud` is `true`; `start_run` is Cloud-pinned.
3. When signed out, show the returned sign-in action. Do not speculate whether the account is registered.
4. When `nextAction` is `recharge`, offer the returned recharge URL before generation. Explain that local Code Agent and BYOK remain available inside Open Design, not through this plugin flow.
5. Retry an unavailable wallet result. Never convert an account error into a zero balance.

## Create and run

1. Call `create_project` with a concise human-readable name and the selected `artifactType`. Pass a known `designSystem` when appropriate.
2. Keep the returned project id and use it explicitly for every later call.
3. Call `start_run` with that project id, the exact artifact-specific `artifactType`, the complete structured brief, and `confirmed: true`.
4. Do not pass an agent id. The server owns the Cloud runtime and internal workflow mapping.
5. Return the progress card immediately. Poll `get_run` every 30–60 seconds until the run is terminal; unchanged file timestamps during a running state are normal thinking time.
6. Cancel only when the user explicitly asks.

## Verify delivery

- Require `status: succeeded`, `artifactCount > 0`, and every output named by the artifact-specific skill. A process-level success with zero files is a failed delivery.
- Require a real `previewUrl` for websites, prototypes, presentations, images, videos, audio, and documents. Design systems instead require a real generated design-system file.
- Never claim completion after a write, read, archive, preview, or registration error. Report the returned failure exactly and leave the project available for diagnosis.
- For a delivered browser or media artifact, use the host in-app browser to open two separate tabs before replying: the exact `studioUrl` and exact `previewUrl`. For a design system, open the exact `studioUrl`.
- If in-app browser control is unavailable, return both exact links and say they could not be opened automatically.
- Never replace a returned URL with the Open Design origin, `/`, or `/onboarding`.

## Refine safely

- Reuse the same project for refinements and call `start_run` with the requested delta. Create another project only when the user asks.
- Keep advanced editing, versions, and export in Open Design.
- Never expose access tokens, Cloud control keys, runtime keys, API keys, cookies, or raw credentials.
- Never delete projects or files as cleanup without explicit user authorization.
