---
name: open-design-basics
description: "Use as the base operating context whenever design work should run through Open Design — decks/slides, landing pages, prototypes, posters, brand pages, or redesigns — even when the user does not explicitly mention Open Design. Covers the local daemon model, the od CLI contract, the project/run/files data model, preview URLs, and routing to the focused Open Design skills."
---

# Open Design Plugin Basics

## Purpose

Load this as the shared operating context whenever you drive Open Design. It defines
the runtime model, the `od` CLI contract, and how the focused skills hand off to each
other. It does not contain full task playbooks — route to the matching skill:

- Generate something new (deck, page, poster, prototype) → `open-design-create`
- Look at or validate a result → `open-design-preview-verify`
- Pick a visual style or extract a brand → `open-design-systems-brands`
- Produce a deliverable file (PDF / PPTX / image) → `open-design-export-deliver`
- Anything failed or looks stuck → `open-design-known-errors`

## Your environment

Open Design is a **local-first** design app. A privileged daemon runs on the user's
machine (default `http://127.0.0.1:7456`) and owns projects, files, generation runs,
skills, design systems, and static preview serving. Nothing round-trips a cloud
service; generated files live on disk in daemon-managed projects.

You drive it through the `od` CLI. Every capability is also a `/api/*` HTTP endpoint
and (optionally) an MCP tool — all three surfaces hit the same daemon, so pick
whichever your session has, but prefer the CLI: it is the stable embeddability
contract.

Check the daemon before nontrivial work:

```bash
od daemon status --json
```

If the daemon is not running, `od` commands exit with code `64` and a structured
JSON error envelope on stderr. Recover with `od daemon start --headless`, then retry
(see `open-design-known-errors`).

## CLI contract

- Add `--json` to any command for machine-readable output. Parse that instead of the
  human text.
- Long prompts go through `--prompt-file <path|->` (`-` = stdin) instead of giant
  quoted `--message` strings.
- Failures use stable exit codes with a JSON envelope on stderr:
  `64` daemon-not-running · `66` capabilities-required · `67` missing-input ·
  `68` project-not-found · `69` run-not-found · `70` provider-not-configured.
  Read the envelope's `error.code` before improvising.
- `--daemon-url <url>` overrides the daemon base URL when the user runs a
  non-default port. Otherwise resolution is automatic.

## Data model

- **Project** — top-level container for one design effort. Owns files and
  conversations. Create: `od project create --name "…" --json` →
  `{ project: { id }, conversationId }`.
- **Conversation** — the dialogue thread inside a project. Keep reusing the same
  `conversationId` for follow-up iterations so the design agent retains context.
- **Run** — one generation turn executed by Open Design's own design agent.
  Start: `od run start --project <id> --conversation <cid> --message "…" --follow --json`.
  A run streams events and finishes with files written into the project.
- **Files** — project artifacts on disk. `od files list <projectId> --json`,
  `od files read <projectId> <relpath>`.
- **Preview URL** — every project file is served at
  `<daemonUrl>/api/projects/<projectId>/raw/<relpath>`
  (e.g. `http://127.0.0.1:7456/api/projects/abc123/raw/index.html`).
  This URL is the live preview surface for your browser tool.

## Division of labor

You are the orchestrator, not the renderer. Open Design's internal design agent does
the actual visual design work during a run — applying its 139 design skills, 150
DESIGN.md design systems, and craft rules. Do not hand-write HTML/CSS artifacts into
the project to "help"; state intent in the run message and let the run produce the
artifact. Your jobs are: clarify intent, pick skill/design-system, start runs, verify
results visually, iterate with feedback, and deliver exports.

## Discovering capabilities

```bash
od skills list --json           # generation workflows (deck, landing page, poster…)
od design-systems list --json   # visual styles (DESIGN.md systems)
od skills show <id>             # what a specific skill does and its inputs
```

## MCP surface (optional)

When the plugin's MCP server is connected, the same daemon is reachable through
`open-design` MCP tools (`create_project`, `start_run`, `get_run`, `list_files`,
`get_file`, `list_skills`, …). They are equivalent to the CLI verbs; do not mix a
guessed HTTP shape with the documented ones. If neither CLI nor MCP responds, the
daemon is down — recover first.
