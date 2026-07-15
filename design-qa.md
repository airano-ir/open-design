# Design QA — Community template search cards

## Evidence

- Source visual truth:
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-uNJLat.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-T2iJu2.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-6K3Jcj.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-aaqbsT.png`
- Implementation URL: `http://127.0.0.1:4367`
- Implementation screenshot: unavailable — the in-app Browser runtime reported no available browser instances.
- Intended viewport/state: desktop; compact chat result strip and expanded Questions-tab single-selection grid.
- Primary interactions covered by automated tests: default selection, alternate card selection, answer serialization, compact banner opening, safe preview URL handling, and selected Community plugin id extraction.
- Console errors checked: blocked because no browser instance was available.

## Full-view comparison evidence

Blocked. The four source images were opened at original resolution, but a browser-rendered implementation capture could not be produced, so a valid combined source/implementation comparison was not possible.

## Focused region comparison evidence

Blocked for the same reason. The intended focused regions are the compact preview strip, the selected-card border/check state, and the expanded two-column card grid.

## Findings

- [P1] Browser-rendered visual evidence is missing.
  - Location: compact Community result banner and Questions-tab template picker.
  - Evidence: source screenshots are available, but the Browser runtime returned an empty browser list.
  - Impact: typography, live iframe crops, spacing, overflow, and dark-theme behavior cannot be accepted from code/tests alone.
  - Fix: rerun the local URL in an available in-app browser, capture the compact and expanded states at matching viewports, compare them together with the source images, and fix any P0/P1/P2 drift.

## Required fidelity surfaces

- Fonts and typography: implemented with existing Open Design tokens and component typography; browser comparison blocked.
- Spacing and layout rhythm: compact five-slot strip and responsive two-column expanded grid implemented; browser comparison blocked.
- Colors and visual tokens: uses existing background, border, text, selected, radius, and shadow tokens; browser comparison blocked.
- Image quality and asset fidelity: renders real same-origin Community HTML/image/video previews; external preview URLs are rejected; live crop/sharpness comparison blocked.
- Copy and content: titles, descriptions, reasons, category, and mode come from semantic search results; browser truncation comparison blocked.

## Comparison history

- Initial pass: blocked before visual comparison because no browser instance was available. No source-to-implementation visual fixes were made.

## Implementation checklist

- Capture the compact chat banner.
- Open the Questions tab and capture the expanded card grid.
- Select a second result and verify the selected state and submit action.
- Check console and framework overlays.
- Compare source and implementation at the same viewport, then update this report.

final result: blocked

---

# Design QA · Final value-only Computer and project workspace

- Date: 2026-07-15
- Runtime: `task-computer-e2e`, production Web build in the real Electron desktop shell
- Reference progress / replay: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-174108a1-90fe-4f90-8e85-4ba3721a3530.png`
- Reference outer Computer: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-6c0457b2-fa7e-433e-b874-44d5179d0523.png`
- Implementation history lock: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/computer-history-locked.png`
- Implementation final modal: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/final-focus-bidirectional.png`
- Implementation restored side view: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/final-side-bidirectional.png`
- Implementation close/full conversation: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/computer-closed-chat-full.png`
- Viewport: 1280×900 CSS pixels in the desktop runtime; screenshots were captured at the device pixel ratio.

## Source-to-implementation comparison

- The reference and implementation were opened together in the same comparison input for both the replay/progress state and the outer Computer state.
- The final hierarchy matches the requested model: persistent project navigation, conversation-first center, one outer Computer shell, then Pages / previews / browser / replay nested inside it.
- The implementation keeps Open Design's own typography, neutral surfaces, orange accent, radii, controls, and icon library instead of copying the reference brand.
- Task progress metadata, step count, disclosure control, timeline thumb, and Jump to live remain aligned and legible at the narrower right-column width.

## Core interaction evidence

- History lock held at `value=4 / max=18` (Step 5 of 19) after the live run continued; Jump to live alone changed it to `18 / 18` and removed the button.
- Right Task progress changed from a 229px expanded region to a 45px collapsed row and restored independently of the composer-side progress card.
- Modal close hid Computer, removed the separator, and expanded chat to the full 1024px content width; reopening restored the previous split and mounted workspace state.
- Project navigation collapsed from 256px to 72px, expanded without losing state, and a real `Matrix` search returned the seven matching project rows.
- Scoped Computer text contained only generated artifact frames in the recorded run; TodoWrite, update_plan, Preparing, Loading, Bash, Grep, Glob, and spinner text were absent.

## Visual defects found and fixed

- [P1] A focused Computer containing a mounted iframe could leave black Chromium/Electron compositor tiles after the FLIP scale animation.
  - Fix: detect mounted iframe/video/canvas/webview previews and preserve them without a parent scale transform; the backdrop still fades naturally, while non-composited content retains the FLIP transition. A synchronous pre-paint reflow invalidates Electron's tiles when the same preview returns from fixed modal layout to the split grid.
  - Regression: component test proves preview layers are not transformed and the paint refresh restores body state; rebuilt production screenshots confirm both side → modal and modal → side remain clean with no black tiles.
- [P2] Empty replay content could expose a stale GPU layer from the previous preview.
  - Fix: give the replay root an isolated paint layer, explicit surface background, and paint containment.

## Required fidelity surfaces

- Typography: existing product font stack and weights retained; primary/secondary hierarchy is consistent across sidebar, conversation, Computer, timeline, and progress.
- Spacing: outer shell, 52px Computer header, workspace tabs, 28–30px icon controls, timeline, and 45px collapsed progress row share a coherent rhythm.
- Color and borders: existing semantic tokens only; backdrop, panel surfaces, success status, accent thumb, borders, and focus treatments remain accessible.
- Assets: existing Open Design icon primitives and real artifact/file previews are used; no emoji, handcrafted SVG, CSS art, or fake screenshot preview was introduced.
- Copy: Computer is value-only; Todo and operational loading copy remain on the conversation/progress side or in raw diagnostics.

## Automated and runtime evidence

- Contracts flow + Computer projection: 2 files / 36 tests passed.
- Daemon flow/task route, CLI, and mock replay: 4 files / 37 tests passed.
- Focused Web creation/replay/sidebar/shell suites: 8 files / 92 tests passed.
- Web typecheck and production build: passed.
- Desktop runtime status: running and visible; console contains only the expected unpackaged Electron CSP warning.
- The in-app Browser blocked direct navigation to the local URL under its URL-security policy, so it was not bypassed; equivalent visible validation was completed through the repository-supported desktop Computer Use inspector and screenshots.

## Comparison history

- Initial comparison: hierarchy and controls matched, but the focused preview exposed black compositor tiles.
- Correction: skipped unsafe scaling for mounted preview layers and added a regression test.
- Final comparison: modal background, canvas, header, nested workspace, timeline, progress, and surrounding backdrop all render cleanly; no remaining P0/P1/P2 visual defect was found in the requested path.

final result: passed

---

# Design QA · Aggregated conversation Usage and completion actions

- Date: 2026-07-15
- Source visual truth:
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-73247ba9-f1cc-4a4f-a74c-12e6fe15f2f3.png`
  - `/Users/pftom/Library/Application Support/LarkShell/OptimizeImage/60e1334c-77d5-4012-a629-30f293ba4993.jpeg`
- Implementation URL: `http://127.0.0.1:4367/projects/5b53861d-fc5b-4f9a-afef-1c4e8bf75cc8/conversations/48bc1820-d07a-450d-abe6-06724117a09a`
- Implementation screenshot: `.tmp/design-qa/conversation-usage.png`
- Full comparison: `.tmp/design-qa/conversation-usage-comparison-full.png`
- Focused comparison: `.tmp/design-qa/conversation-usage-comparison-focus.png`
- Viewport: 1280×720 implementation; supplied references were normalized in the combined comparison.

## Full-view comparison evidence

The two supplied references and the implementation were assembled into one comparison image. The implementation follows the requested information hierarchy while retaining Open Design's product shell and visual tokens: conversation usage lives in the header, turn bodies stay focused on results, and the terminal row is a single compact action line.

## Focused region comparison evidence

The focused comparison places the original per-turn statistics, the Manus header-usage pattern, and the final Open Design state in one image. The final state removes per-turn token, cost, and time copy; exposes aggregate token and elapsed totals in the header panel; and keeps the green Task completed label plus copy, fork, helpful, and not-helpful controls on one 30px-high flex row.

## Findings and fixes

- [P1] Token, cost, and elapsed statistics were repeated after each assistant round.
  - Fix: remove the per-turn statistics block and aggregate each assistant round's latest usage event into the conversation-level header panel.
- [P2] Terminal status and feedback actions were visually fragmented across separate groups.
  - Fix: move the terminal badge into the assistant footer, keep copy and fork adjacent on the left, and push helpful/not-helpful to the far right with flex layout.
- [P2] Task completed read as a detached outlined badge rather than a lightweight terminal state.
  - Fix: use the existing success icon and semantic success color without a pill background or border.

## Runtime and regression evidence

- Header Usage panel rendered one aggregated total across two assistant rounds: 1,300,641 tokens and 3m 14s.
- DOM inspection found zero `.assistant-stats` per-turn blocks.
- Both rendered completion rows used flex layout at 30px height and exposed four action buttons in left/right pairs.
- Browser console error log: empty.
- New usage aggregation/component tests: 3 passed.
- Focused completion-row and header-action tests: passed.
- Locale dictionary alignment: passed across all locale files.
- Full Web typecheck is currently blocked by two pre-existing errors in the dirty `PinnedTaskProgress.tsx`; the new usage and completion files produced no type errors.

## Comparison history

- Initial state: terminal statistics were repeated per round, the completion label was pill-like, and action alignment was fragmented.
- Implementation pass: usage aggregation, header popover, single-row terminal layout, and all locale copy were added.
- Final comparison: header totals, per-turn removal, one-row action geometry, interaction state, and console logs all passed with no remaining P0/P1/P2 mismatch in this scope.

final result: passed

---

# Design QA · Single-source floating Task progress

- Date: 2026-07-15
- Source visual truth: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-df2b5558-60fb-4db8-8e7b-ca4fa6040e54.png`
- Computer-open implementation: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/progress-single-source-open.png`
- Computer-closed implementation: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/progress-floating-closed.png`
- Expanded implementation: `/Users/pftom/.codex/visualizations/2026/07/15/019f63ca-00a9-71e2-a094-05905737dd75/progress-floating-expanded-clean.png`
- Viewport: desktop, 1866×1307 implementation; source component normalized by content width.
- State: completed five-stage design flow, compared with Computer open, Computer closed, collapsed, and expanded.

## Full-view comparison evidence

The source and final collapsed implementation were opened together in one comparison input. The final implementation keeps the same hierarchy as the source: miniature Computer preview, semantic status icon, current/final step label, tabular progress count, and one disclosure control, directly attached to the top edge of the composer. The earlier full-height card is gone.

## Focused region comparison evidence

- Computer open: the left composer has no pinned Task progress; only the right Computer progress source remains.
- Computer closed: one 48px compact row floats above and slightly overlaps the composer, with a 52×32 preview and restrained 13px step label.
- Expanded: details open upward over the transcript, so the composer position and typing area do not jump.
- Terminal state: the collapsed summary keeps the useful final stage label rather than repeating a generic completion badge.

## Findings and fixes

- [P1] The same progress was visible on both left and right when Computer was open.
  - Fix: `ProjectView` now suppresses the composer copy whenever the outer Computer workspace is visible.
- [P2] The left progress occupied a large block and pushed the composer downward.
  - Fix: default to a one-row summary and position the expanded detail surface above the row.
- [P2] Status copy, step count, and thumbnail were crowded and visually heavy.
  - Fix: reduced the preview to 52×32, tightened type and spacing, removed duplicate terminal copy while collapsed, and aligned the count with the disclosure control.
- [P2] Translucent blur on the expanded surface produced Electron compositor artifacts.
  - Fix: replaced backdrop filtering with the existing solid panel token; the post-fix expanded capture is clean.

## Required fidelity surfaces

- Fonts and typography: inherited product font, 13px/620 summary title, 11.5px tabular progress count, tighter negative letter spacing only on the primary label.
- Spacing and layout rhythm: 48px summary row, 17px radius, 20px composer-side inset, and a 12px intentional overlap with the composer stack.
- Colors and visual tokens: existing panel, border, text, muted, success, accent, and danger tokens only.
- Image quality and asset fidelity: the existing memoized Computer preview and product icon library remain; no emoji, hand-authored SVG, placeholder art, or newly generated assets were introduced.
- Copy and content: collapsed state shows the useful active/final stage label and `Step N of M`; detailed status copy appears only after expansion.

## Interaction and regression verification

- Computer-open duplicate suppression: passed.
- Computer-close compact summary restoration: passed.
- Compact expand/collapse and upward reveal: passed.
- New round resets to compact state: passed.
- Focused component regression: 31 tests passed.
- Web typecheck: passed.

## Comparison history

- Initial state: the left card duplicated the right Computer progress and occupied a large vertical block.
- First implementation: compact floating summary and single-source ownership were added.
- Visual correction: removed expanded-surface backdrop filtering after it exposed Electron compositor blocks.
- Final comparison: collapsed, expanded, and Computer-open states have no remaining P0/P1/P2 mismatch.

final result: passed

---

# Design QA · Task Progress and Computer motion transitions

- Date: 2026-07-15
- Source visual truth: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-bcc4bc8b-c3d4-4bf9-9ada-3614d5108127.png`
- Implementation screenshot: `.tmp/design-qa/task-computer-motion/task-progress-expanded.png`
- Combined comparison: `.tmp/design-qa/task-computer-motion/reference-vs-task-progress.png`
- Viewport: 1280×720 implementation capture; source normalized to the same width in the combined comparison.
- States covered: Task Progress expanded/collapsed, Computer hidden/docked/focused modal, replay previous/next, replay progress expanded/collapsed.

## Full-view comparison evidence

The supplied screenshot establishes the requested task-to-Computer journey rather than a pixel-identical Open Design screen. The combined comparison confirms that the implemented Task Progress remains attached to the conversation/composer and Computer remains the dedicated right-hand surface. The change intentionally preserves the current product typography, shell, colors, spacing, and iconography; only movement and transient presence behavior change.

## Focused motion evidence

- Task Progress disclosure uses the existing grid-row accordion and asymmetric `200ms` expand / `140ms` collapse timings.
- Computer hidden ↔ right-hand workspace uses a compatible three-track grid transition; the live panel remains mounted for the exit interval so content does not blink away.
- Right-hand workspace ↔ focused modal uses one mounted frame and a FLIP bounds animation (`240ms` into focus, `200ms` back) with the product ease-out curve.
- Modal/backdrop exits remain present for `140ms` before dock/close callbacks complete.
- Replay steps key their content by run + step and animate forward/backward from opposite horizontal directions over `200ms`.
- All added motion is disabled under `prefers-reduced-motion: reduce`.

## Findings and fixes

- [P1] The first split-track implementation snapped because an imperative inline grid declaration overrode the state class and mixed non-compatible track shapes.
  - Fix: keep `grid-template-columns` ownership in CSS and update only the chat-width custom property during resize. Open and closed states now use compatible three-track lists.
- [P2] Close and dock callbacks previously removed the surface before an exit animation could render.
  - Fix: add a `140ms` presence state with timer cleanup and an immediate reduced-motion path.
- [P2] Replay content changed without spatial continuity.
  - Fix: infer forward/backward direction from the durable run/step selection and animate status plus body in the matching direction.

## Required fidelity surfaces

- Typography and layout: unchanged; the motion patch reuses existing tokens, primitives, panel geometry, and responsive modal bounds.
- Colors and shadows: existing background, border, text, and modal backdrop tokens retained; no new palette introduced.
- Iconography: existing `Icon` and shared `Button` primitives retained at the established Computer header size.
- Accessibility: semantic buttons, Escape-to-restore, modal labeling, focus transfer, and reduced-motion behavior covered.
- State preservation: Computer children stay mounted across side/modal movement and through the short close transition.

## Automated and runtime evidence

- Focused motion suite: 28 passed; 76 unrelated tests skipped by the focused filter.
- `@open-design/web` typecheck: passed.
- Repository `pnpm guard`: passed, including style policy and cross-app boundaries.
- Runtime disclosure check: expand reported `0.2s`; collapse reported `0.14s`; intermediate height/opacity values confirmed a real transition rather than a delayed snap.
- Runtime modal check: the mounted Computer frame moved from the right workspace into a centered dialog without remounting its content.
- Final console-log recheck could not be repeated after another local workflow stopped the shared default service; the interactive session completed without a visible runtime exception, and component/type/guard validation remained green.

## Comparison history

- Initial implementation: Task Progress transitioned correctly, but the Computer split grid snapped during close/open.
- First correction: converted the open/closed track lists to simple lengths; DOM style parsing exposed continued imperative ownership.
- Final correction: removed imperative grid ownership entirely, leaving resize to a custom property and state to CSS classes; focused regression tests then passed.

final result: passed

---

# Design QA · Task Progress + Replayable Computer

- Date: 2026-07-15
- Result: Passed
- Runtime: `task-computer-e2e`, production Web build at `http://127.0.0.1:53914`
- Reference: supplied Open Design screenshots plus the supplied Manus Computer / Task progress reference

## Verified

- The assistant paints an explicit `Preparing...` status before the first content event; visible within 416 ms in the recorded-browser run.
- The composer Task progress card expands and collapses, resets open for a new live round, and exposes a live structured Computer preview without mounting an iframe or bitmap capture.
- The Computer timeline supports previous/next, manual history lock, and Jump to live.
- During live replay, history stayed on the selected Grep step while the slider maximum advanced from 1 to 2; Jump to live then selected the newest Edit step.
- The Computer Task progress section expands and collapses independently and renders only projected replay steps; TodoWrite stays in the composer-side progress card.
- Production visual review covered header hierarchy, compact controls, card radii, borders, focusable semantic buttons, reduced-motion handling, and narrow panel truncation.

## Fixes found during visual QA

- Fixed task-step labels being constrained into the marker column by the parent grid. Final DOM and screenshot show all labels at full available width.

## Automated evidence

- Focused Web tests: 39 passed.
- Full Web suite: 426 files passed, 4,392 tests passed, 7 skipped.
- Web production build: passed.
- Repository guard: passed (78 policy tests).
- Repository typecheck: passed; the landing-page package emitted pre-existing Astro hints only.

final result: passed

---

# Design QA · Large primary deliverable preview card

- Date: 2026-07-15
- Result: Passed
- Reference screenshot: `/Users/pftom/Library/Application Support/LarkShell/sdk_storage/9f491e950d29cedbe5e09d1fb4868a2c/resources/images/img_v3_0213k_149ba12a-91c9-4c8b-9408-21c0979d6e0g.jpg`
- Previous compact-row screenshot: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-5091750a-4e17-4a3b-8d78-507826539c6a.png`
- Implementation screenshot: `.tmp/design-qa/primary-deliverable-card/implementation.png`
- Full comparison: `.tmp/design-qa/primary-deliverable-card/reference-vs-implementation.jpg`
- Focused comparison: `.tmp/design-qa/primary-deliverable-card/focused-reference-vs-implementation.jpg`

## Visual result

- The primary file now renders as one content-first card with a 62px identity/action header and a large 16:10 preview surface instead of a one-line attachment row.
- HTML uses the real rendered artifact in a sandboxed iframe. Images, video, Markdown/text/code, and structured document previews keep their native content character rather than substituting a fake thumbnail.
- Existing Open and Download affordances remain visible in the card header. The complete preview is also a keyboard-focusable Open target with a restrained hover hint.
- The implementation retains Open Design typography, color tokens, icon library, and panel chrome while matching the reference's hierarchy, scale, rounded container, whitespace, and content-forward presentation.

## Responsive and interaction checks

- Desktop preview: 16:10 aspect ratio with a 240px minimum height.
- Narrow preview: 4:3 aspect ratio with actions wrapping below the file identity.
- Reduced-motion mode removes card and hint transitions.
- Focused regression test verifies that the primary HTML deliverable renders inline and that activating the preview opens the existing Computer/file flow.
- Real-project runtime inspection confirmed large Markdown and HTML cards with working Open and Download controls.

## Findings

- [P1] The previous primary deliverable was visually indistinguishable from a small attachment row.
  - Fix: promote the primary file into a dedicated card and reserve the compact list for non-primary/multiple-file cases.
- [P2] The result's actual content was hidden behind an Open action.
  - Fix: render a safe, type-aware preview directly in the conversation while preserving the existing full-view path.
- No remaining P0/P1/P2 visual defects were found in the supplied reference comparison.

final result: passed

---

# Design QA · 8-query matrix + combined Inspiration

- Date: 2026-07-15
- Result: Passed
- Runtime: `task-computer-e2e` (`daemon 53913`, `web 53914`, real Electron shell)
- Template overview: `.tmp/design-qa/query-matrix/09-inspiration-final.png`
- Design-system selection: `.tmp/design-qa/query-matrix/10-inspiration-combined-selection.png`
- Replay / five-stage state: `.tmp/design-qa/query-matrix/11-replay-live-and-progress.png`
- Single Computer tab: `.tmp/design-qa/query-matrix/12-replay-single-computer-tab.png`

## Experience priority contract

- The design brief is now a hard quality gate rather than a prelude to tool activity. The composed
  prompt requires the outcome, audience, content/IA, scope, brand/reference, constraints, and
  acceptance bar before research or generation can advance.
- The first response remains immediate: one short acknowledgement plus one localized form with
  recommended defaults. The form now names success criteria directly instead of burying them in an
  “anything else” field.
- Progress is explicitly truthful and observable: slow work starts with a concrete active state,
  durable batches advance counts, the latest useful preview stays mounted, and the user can remain
  in history until choosing Jump to live.
- Visual ambition stays bounded by the brief: selected template and/or design system, anti-slop and
  brand checks, reduced-motion-safe transitions, and at most one justified flourish.

## Query matrix

| Query intent | Expected / actual shape | First visible stage |
| --- | --- | --- |
| 2026 humanoid robot investor deck | deck / deck | Brief & questions |
| interactive product prototype | prototype / prototype | Brief & questions |
| SaaS landing page | landing / landing | Brief & questions |
| four-screen iOS app | mobile / mobile | Brief & questions |
| analytics dashboard web app | webapp / webapp | Brief & questions |
| product decision RFC | document / document | Brief & questions |
| PDF-first market analysis | report / report | Brief & questions |
| music-festival launch poster | media / media | Brief & questions |

All eight runs persisted the same stable stage ladder. Research remained visible and optional; it did
not disappear just because the run was still awaiting brief answers.

## Combined Inspiration evidence

- Ranked report templates rendered real live previews, reasons, categories, and one selected state.
- Design systems rendered independently with real palettes, summaries, categories, and a separate
  selected state. The panel remained a two-column grid at the 1:1 split width and collapsed cleanly
  to one column at its existing responsive breakpoint.
- The production click path selected `market-diligence-report` and `agentic` together. The API then
  returned matching project metadata, flow choice, and `generated/inspiration.json`; this is not a
  visual-only selection.
- The default system-prompt pipeline was exercised by tests in all modes and includes intentional
  design taste, anti-slop polish, CSS-first motion, GSAP specialization only when justified, lifecycle
  cleanup, and `prefers-reduced-motion` support.

## Replay and shell findings

- Previous step changed `Step 3 of 3 / Using Edit` to `Step 2 of 3 / Using Read`; Jump to live restored
  the newest Edit step. The slider and status copy remained aligned.
- The Computer-side Task progress and the composer-side five-stage card disclosed independently.
- Historical runs had left several valid `computer:<runId>` tabs with the same visible name. The final
  shell now keeps one Computer replay tab and replaces its round on demand; the original conversation
  immediately reconciled to one visible tab without losing the selected replay.
- An optional desktop-pet redirect loop could strand the Electron splash screen. Pet loading is now
  failure-isolated, so the main Open Design window reveals even when that optional surface fails.

## Automated evidence

- Contracts: 38 files / 279 tests passed.
- Focused Web Computer, Inspiration, staged-flow, and projection suites: passed.
- Focused daemon flow/inspire/CLI/system-prompt suites: passed.
- Desktop pet failure-isolation: 2 tests passed.
- Repository guard, workspace typecheck, and production Web build: passed in the final closeout run.

final result: passed

---

# Design QA · Stable five-stage creation journey

- Date: 2026-07-15
- Result: Passed
- Runtime: `task-computer-e2e`, production Web build at `http://127.0.0.1:53914`
- Reference screenshot: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-8cb60f34-0e64-4aa0-a7b1-51d074f32655.png`
- Implementation screenshot: `.tmp/design-qa/staged-progress/implementation-five-stage-final-2026-07-15.png`
- Focused implementation crop: `.tmp/design-qa/staged-progress/implementation-five-stage-card-final-2026-07-15.png`
- Combined comparison: `.tmp/design-qa/staged-progress/reference-vs-five-stage-final-2026-07-15.png`

## Acceptance criteria

- Current staged creation shows exactly five macro phases: Brief/questions, optional research, outline, inspiration, and implementation.
- Optional research remains visible before it runs; delivery is a completion outcome rather than a sixth progress row.
- A current staged flow wins over TodoWrite details; a later lightweight edit round still renders its TodoWrite list.
- Header, live state, step count, labels, icons, and disclosure control stay aligned without concatenated copy.

## Visual comparison findings

- The raw six-item TodoWrite list in the reference is replaced by one stable five-stage journey; all labels and the `Step 1 of 5` count remain legible on one aligned header.
- `Brief & questions` is the first active checkpoint, `Research (optional)` remains visible before execution, and delivery is absent from the creative-stage ladder.
- A completed run waiting on the brief now says `Needs input` instead of contradicting the active stage with `Task completed`.
- Pending stages do not show artifacts recovered from an older round; the stale `task-progress-replay.html` link found in the first comparison was removed.
- Existing product tokens, typography, iconography, 13px radius, disclosure animation, and structured Computer thumbnail were preserved.

## Runtime and automated evidence

- Production desktop runtime: five labels, `Step 1 of 5`, `Needs input`, and no stale pending-stage artifact confirmed through DOM inspection.
- Collapse → collapsed state → expand interaction: passed on the production build.
- Focused Web tests: 16 passed; contracts flow tests: 29 passed.
- CLI parity: fixed the `od flow` module-initialization TDZ; JSON and human-readable `flow status` both passed against the same live conversation (2 CLI specs plus the existing 2 task CLI specs passed).
- Web typecheck, full workspace typecheck, guard, and production build: passed.

final result: passed

# Design QA · Unified Computer workspace shell

Date: 2026-07-15

- Production runtime: `task-computer-e2e` (`daemon 53913`, `web 53914`)
- Reference split view: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-6c0457b2-fa7e-433e-b874-44d5179d0523.png`
- Reference Computer modal: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-dd4dfb05-335c-45c0-9877-c51a0ed95039.png`
- Reference full conversation: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-01c3ef67-0297-45e1-b150-8b8c0adb88dc.png`
- Implementation captures: `.tmp/design-qa/computer-workspace-shell/final-open.png`,
  `.tmp/design-qa/computer-workspace-shell/final-computer-full.png`,
  `.tmp/design-qa/computer-workspace-shell/final-replay-modal.png`, and
  `.tmp/design-qa/computer-workspace-shell/final-modal-close-chat-full.png`
- Required combined comparison inputs: `.tmp/design-qa/computer-workspace-shell/compare-split.png`,
  `.tmp/design-qa/computer-workspace-shell/compare-modal.png`, and
  `.tmp/design-qa/computer-workspace-shell/compare-chat-full.png`

## Visual comparison findings

- The reference and implementation now share the same primary hierarchy: conversation first on the left,
  one Computer surface on the right, then replay / files / browser content nested inside that surface.
- The Computer header stays one compact row with a real product icon, context line, full-screen control,
  and close control. Internal Pages, Design Files, Browser, file previews, terminal, Questions, and replay
  tabs remain available directly below it.
- The full-conversation state preserves the existing Open Design content and typography rather than copying
  Manus styling. Header actions align on one baseline and remain discoverable without competing with the
  conversation title.
- The modal comparison preserves the same centered, dimmed, dismissible Computer treatment. Open Design's
  replay canvas is intentionally sparser than the search-heavy Manus reference because it renders the
  selected real execution step.

## Runtime measurements and interactions

- Default split: `636px chat / 8px handle / 636px Computer` — exact 1:1.
- Manual drag: `756px chat / 8px handle / 516px Computer`; the selection remains stable after release.
- Computer full screen: `1280px`; chat hidden; Side view restores `636 / 8 / 636px`.
- Computer close: `1280px` chat; Computer hidden; drag handle removed; one-column grid confirmed.
- Design Files action: reopens Computer and activates the existing `All project files` entry.
- More menu: Rename and Delete are visible; Rename opens the current title in the existing rename flow.
- Open Design Cloud action: opens the existing Cloud settings/subscription entry point.
- Replay modal close: modal removed, Computer hidden, conversation restored to the full `1280px` width.

## Defects found and fixed

- [P1] A legacy high-specificity grid rule kept a three-column layout after Computer closed.
  - Fix: exclude `.split-chat-only` from the legacy split selector and clear the imperative grid template
    whenever split mode is inactive.
- [P1] Closing the replay modal returned to the docked Computer instead of the requested full conversation.
  - Fix: centralize close semantics so the modal close exits modal focus and closes Computer; Dock remains
    the explicit return-to-side-view action.
- [P2] Files and replay appeared as peers of Computer, weakening the requested hierarchy.
  - Fix: add one stable outer Computer shell and keep the existing `FileWorkspace` mounted inside it.
- [P2] Conversation-level actions were split between several locations.
  - Fix: group Cloud, Design Files, New, History, Rename, and Delete in the conversation header using existing
    primitives, icons, tokens, and conversation handlers.

## Automated evidence

- `ComputerWorkspaceShell.test.tsx`: close, focus, and child-state preservation covered.
- `ChatPane.conversation-title.test.tsx`: header callbacks plus Rename / Delete covered.
- `ProjectView.run-isolation.test.tsx`: unified focus and modal-close-to-full-chat regression covered.
- `FileWorkspace.test.tsx`: 1:1 helper, chat-only mode, and imperative grid cleanup covered.
- Web typecheck and production build: passed.

final result: passed

---

# Design QA · Todo placement, iconography, and alignment polish

- Date: 2026-07-15
- Result: Passed
- Runtime: `task-computer-e2e`, production Web build at `http://127.0.0.1:53914`
- Reference screenshot: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-2da2a6fa-5c56-46b7-9486-90856cce4f4a.png`
- Implementation screenshot: `.tmp/design-qa/task-progress-computer/implementation-2026-07-15.png`
- Combined comparison: `.tmp/design-qa/task-progress-computer/reference-vs-implementation-2026-07-15.png`
- Final build screenshot: `.tmp/design-qa/task-progress-computer/implementation-final-2026-07-15.png`
- Final combined comparison: `.tmp/design-qa/task-progress-computer/reference-vs-implementation-final-2026-07-15.png`

## Full-view comparison evidence

The supplied 3840×2098 reference and the 1280×720 production capture were normalized to a common 1280×720 frame and vertically stacked. The final comparison confirms that the right Computer no longer contains the large Todo block from the reference, the replay canvas regains visual priority, and the left composer-side Task progress remains the canonical planning surface.

## Focused region comparison evidence

- Right Computer header: monitor icon, title, status line, expand action, and baselines align as one 58px header row.
- Replay controls: previous/next buttons are equal 28px controls; the heavy full-width blue progress fill is replaced by a neutral 4px track with a compact accent thumb.
- Right Task progress: title, terminal/live state, `Step N of M`, and chevron have consistent spacing; the row expands and collapses independently.
- Left Task progress: the Computer entry is a 72×42 structured current-step preview; Todo status icons, current label, terminal/live state, step count, and chevron share a single baseline.
- Todo ownership: a current-round TodoWrite snapshot wins over an older conversation-level staged flow on the left; TodoWrite/update_plan is excluded from the Computer title, canvas, timeline, and step summary.

## Findings and fixes

- [P1] TodoWrite appeared as Computer content and as the right-side progress source.
  - Fix: filter TodoWrite/update_plan in the shared Computer projection and render only replayable actions on the right.
- [P1] An older staged flow could cover the current round's Todo changes on the left.
  - Fix: current-round Todo snapshots now take precedence in the pinned progress card.
- [P2] Hand-authored SVGs and character glyphs produced mixed stroke weights and baselines.
  - Fix: use the existing `Icon` component for Computer, maximize/dock/close, chevrons, terminal states, and progress states.
- [P2] Header, status, step count, timeline, and disclosure controls were cramped or visually detached.
  - Fix: recalibrated row heights, spacing, type sizes, marker columns, scrollbar footprint, and disclosure alignment with existing tokens.

## Required fidelity surfaces

- Fonts and typography: existing product font stack retained; Computer title is 13.5px/650 and status metadata is 11–11.5px with tabular step counts.
- Spacing and layout rhythm: 58px primary headers, 44px disclosure row, 28px replay controls, 20px marker columns, and consistent 6–11px gaps verified at desktop width.
- Colors and visual tokens: existing panel, subtle, border, text, accent, success, and danger tokens only; no new color system introduced.
- Image quality and asset fidelity: no fake bitmap preview or iframe is mounted in the composer; the structured Computer preview uses the product icon library and primitive text/status data.
- Copy and content: Todo copy is present only in the left progress card; Computer status and lists contain actual replay step labels only.

## Interaction and runtime verification

- Right progress collapse/expand: passed.
- Left progress collapse/expand: passed.
- Previous/next replay: status changed to the prior Bash step and returned to the latest Bash step.
- Todo leak check: no `TODOS`, `TodoWrite`, or known Todo item text in the scoped Computer panel.
- Browser runtime logs: empty.
- Focused regression tests: 19 passed.
- Web typecheck: passed.
- Web production build: passed.

## Comparison history

- Initial reference: Todo occupied the Computer canvas; header copy ran together; the timeline was a dominant blue bar; right progress text was ungrouped.
- First implementation comparison: Todo was removed from Computer and icon/spacing/timeline hierarchy was corrected.
- Final audit: added current-round Todo precedence over stale flow, re-ran focused tests, rebuilt production, and repeated the browser interaction checks.

final result: passed

---

# Design QA · Conversation header action icon sizing

- Date: 2026-07-15
- Source visual truth: `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-db451250-e59c-4a35-aa70-4b8cc023fbee.png`
- Implementation screenshot: unavailable — the in-app Browser blocked capture of the local development URL under its URL policy.
- Viewport: source screenshot 2048×1118; intended implementation state is the same desktop split view.
- State: active project conversation with Design Files, New conversation, Conversation history, and Current conversation actions visible.
- Primary interactions tested: the existing callbacks for Design Files, Cloud, and New conversation; history, rename, and delete menus; icon geometry for all four compact header actions.
- Console errors checked: blocked with the browser-rendered implementation capture.

## Full-view comparison evidence

Blocked. The supplied source was opened at original resolution, but the browser-rendered local implementation could not be captured, so a valid combined source/implementation comparison was not possible.

## Focused region comparison evidence

Blocked for the same reason. The intended focused comparison is the four-button cluster highlighted in red in the source screenshot. Code and component-test evidence confirms a uniform 18×18px SVG box inside the existing 28×28px controls, but that is not a substitute for visual comparison.

## Findings

- [P1] Post-change browser evidence is unavailable.
  - Location: conversation header action cluster.
  - Evidence: source screenshot is available; the in-app Browser rejected local-page capture under its URL policy.
  - Impact: optical balance between the folder, plus, comment, and filled ellipsis glyphs cannot be accepted from dimensions alone.
  - Fix: capture the active project page in an allowed local browser surface at the matching desktop viewport, combine its focused crop with the source crop, and adjust any remaining optical-size drift.

## Required fidelity surfaces

- Fonts and typography: unchanged by this icon-only patch; browser comparison blocked.
- Spacing and layout rhythm: existing 28px button boxes and 2px action gap retained; all four SVG boxes normalized to 18px; browser comparison blocked.
- Colors and visual tokens: existing muted, hover, background, and border tokens retained; browser comparison blocked.
- Image quality and asset fidelity: existing product `Icon` primitives retained; no replacement assets, glyph characters, or new SVG artwork introduced; browser comparison blocked.
- Copy and content: labels, tooltips, and accessible names unchanged.

## Comparison history

- Initial source review: the four action glyphs read undersized and inconsistent inside equal button containers.
- Implementation change: normalized all four to 18px and increased the three stroke icons to a 1.75 stroke while preserving the filled ellipsis treatment.
- Post-fix visual comparison: blocked because the permitted browser could not capture the local implementation.

## Implementation checklist

- Capture the active project header at the matching viewport.
- Compare a focused crop of the four-button cluster against the source crop.
- Verify normal, hover, open-menu, and disabled states remain optically balanced.

final result: blocked

---

# Design QA · Task Progress and Computer replay overall closeout

The requested Task Progress / Computer / Project workspace path is accepted by the final value-only
Computer comparison above. The blocked header-icon note immediately above is an older, separately
scoped local-URL capture limitation and does not block this completed flow. Final runtime evidence is
`final-focus-bidirectional.png`, `final-side-bidirectional.png`,
`computer-history-locked.png`, and `computer-closed-chat-full.png`; no P0/P1/P2 issue remains in the requested path.

final result: passed
