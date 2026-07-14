---
name: open-design-preview-verify
description: "Use after any Open Design generation run, and whenever the user asks to see, check, or approve a design result. Covers building the live preview URL, inspecting it in your browser tool (Codex browser, Cursor browser, Claude browser), the two-signal verification discipline, and what to do when no browser surface is available."
---

# Preview & Visual Verification

Prerequisite context: `open-design-basics`.

## The two-signal rule

A design result is verified only when you have BOTH:

1. **Structural signal** — the run reached a terminal success state and the expected
   artifacts exist: `od run result-package <runId> --json`, `od files list
   <projectId> --json`.
2. **Visual signal** — you actually looked at the rendered artifact in a browser and
   checked it against the brief.

Never present a command's JSON response as visual QA. "The run finished and wrote
`index.html`" is a structural claim; "the hero headline is legible on the dark
background" is a visual one. Users care about the second.

## Building the preview URL

Every project file is served live by the daemon:

```text
<daemonUrl>/api/projects/<projectId>/raw/<relpath>
e.g. http://127.0.0.1:7456/api/projects/8f2c…/raw/index.html
```

The URL renders the current bytes on disk — after an iteration run rewrites the
file, reloading the same URL shows the new version.

## Inspecting with your browser tool

Open the preview URL in the browser surface your host provides and keep it visible
to the user while you work — the live preview is part of the experience, not just
your proof surface:

- **Codex**: open the URL in the Codex browser.
- **Cursor**: open the URL in the Cursor browser.
- **Claude Code**: open the URL in the Claude browser.

What to check, in order:

1. **Brief compliance** — deliverable type, section/slide count, required content
   present, right language.
2. **Visual integrity** — no unstyled HTML, no broken images, no overflowing or
   overlapping text, readable contrast.
3. **Interaction** (prototypes/decks) — navigate between slides/pages; click primary
   controls; confirm nothing dead-ends.
4. **Multi-page artifacts** — check every page/slide, not just the first viewport.
   Scroll the full document.

Record concrete findings ("slide 4 chart overflows its card") — they become the next
iteration message in `open-design-create` §6.

## When no browser surface is available

Do not pretend. Fall back in this order and say which fallback you used:

1. Tell the user the exact preview URL to open themselves, and ask for their read
   on the specific checks above.
2. If a Open Design desktop runtime is available, `od export <file> --project <id>
   --format image --json` renders a raster you can inspect as an image file.
3. If neither works, state plainly that the result is structurally complete but
   visually unverified.

## Reporting

When you report a result to the user, always include:

- the preview URL (clickable),
- what you verified visually (or which fallback you used),
- any known imperfections you chose not to fix, so the user decides.
