---
name: open-design-known-errors
description: "Use when any od command fails, exits non-zero, hangs, or an Open Design run stalls or produces nothing. Covers the structured exit codes, daemon recovery, missing od binary, and when to stop retrying and report."
---

# Known Errors & Recovery

Prerequisite context: `open-design-basics`.

Classify first, then act. `od` failures put a JSON envelope on stderr:
`{ "error": { "code", "message", "data" } }` with a stable exit code. Read it
before improvising.

## Exit-code playbook

| Exit | code | Recovery |
|---|---|---|
| 64 | `daemon-not-running` | `od daemon start --headless`, wait for `od daemon status --json` to report healthy, retry the original command once. |
| 66 | `capabilities-required` | The run needs capabilities the project has not granted. Re-run with `--grant-caps <a,b>` using the capabilities named in `error.data`, and tell the user what got granted. |
| 67 | `missing-input` | A required flag/input was omitted — re-read the command's `--help`, do not guess values. |
| 68 | `project-not-found` | Stale project id. `od project list --json` and re-resolve; never invent ids. |
| 69 | `run-not-found` | Stale run id. `od run list --project <id> --json`. |
| 70 | `provider-not-configured` | The daemon has no model provider configured. This needs the user: ask them to open Open Design settings and connect a provider. Do not retry around it. |

## `od: command not found`

The CLI is not installed or not on PATH. Ask before installing anything, then point
the user at (in preference order): the Open Design desktop app (bundles the daemon),
`curl -fsSL https://open-design.ai/install.sh | sh`, or the repo README
(github.com/nexu-io/open-design). Note that `/usr/bin/od` is the Unix octal-dump
tool — a cryptic dump of binary gibberish means PATH resolved the wrong `od`; use
the absolute path to the Open Design CLI instead.

## Runs that stall or fail

- Quiet is normal: generation runs take minutes. Watch events with
  `od run watch <runId>` instead of assuming a hang.
- A run in a failed-but-resumable state: `od run continue <runId> --follow` starts a
  continuation run.
- Genuinely wedged (no events, no terminal state): `od run cancel <runId>`, then
  start a fresh run with the same conversation so context is retained.
- A finished run with unexpected/empty output is not an error state — treat it as a
  design iteration problem: inspect via `open-design-preview-verify`, then send
  specific feedback per `open-design-create` §6.

## Preview URL doesn't load

1. `od daemon status --json` — daemon down explains everything; recover per exit 64.
2. `od files list <projectId> --json` — confirm the relpath exists (case-sensitive).
3. Rebuild the URL from parts; do not hand-edit percent-encoding.

## When to stop

After two failed recovery attempts on the same error, stop and report: the exact
command, the error envelope, and what you tried. A precise failure report beats a
third blind retry.
