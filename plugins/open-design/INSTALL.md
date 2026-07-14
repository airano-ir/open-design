# Install the Open Design plugin (agent runbook)

You are most likely a coding agent (Codex / ChatGPT, Claude Code, or Cursor)
reading this because your user pasted a one-line install prompt. This page is
the complete, self-contained runbook: execute it top to bottom yourself. The
user should not have to configure anything by hand — only ask them where a
step is explicitly marked **ASK**. Every command below is real and idempotent;
re-running a step is safe.

Open Design is a local-first design app. After this install, you can generate
decks, landing pages, posters, and brand artifacts through the local `od`
daemon, preview every result at a live URL, and visually verify it in your own
browser surface.

## Step 1 — Identify your host

Decide which of these you are running inside; it selects the install path in
Step 4:

- **codex** — Codex CLI, or the Codex tab in the ChatGPT desktop app
- **claude** — Claude Code
- **cursor** — Cursor / cursor-agent

## Step 2 — Locate the Open Design CLI

```bash
od mcp install --open-design-cli-probe
```

- Prints `open-design-cli:mcp-install:v1` → the real Open Design CLI is on
  PATH. Continue to Step 3.
- Prints anything else or dumps binary garbage → your shell resolved
  `/usr/bin/od`, the Unix octal-dump tool, not Open Design. The desktop app
  does not add a shell shim on macOS. Check whether the app is installed
  (`ls /Applications/ | grep -i "open design"`); if it is, **ASK** the user to
  open **Settings → MCP server** in the app once — that panel exposes the
  absolute CLI path — or have them tell you the path to use instead of `od`.
- `command not found` and no desktop app → **ASK** the user to install Open
  Design first: download the desktop app from https://open-design.ai/ (macOS /
  Windows, zero config), or clone and run from source per
  https://github.com/nexu-io/open-design#quick-start. Do not install software
  without their confirmation. Resume here afterwards.

## Step 3 — Make sure the daemon is running

```bash
od daemon status --json
```

- Healthy JSON → continue.
- Exit code 64 (`daemon-not-running`) → start it yourself in a background
  shell, then poll status until healthy (a few seconds):

```bash
od daemon start --headless &
```

If the user runs the desktop app, launching the app also starts the daemon.

## Step 4 — Install the plugin for your host

**codex:**

```bash
codex plugin marketplace add nexu-io/open-design
codex plugin add open-design@open-design
```

**claude:**

```bash
claude plugin marketplace add nexu-io/open-design
claude plugin install open-design@open-design
```

**cursor:**

```bash
od agent-plugin install cursor
```

(cursor gets the six SKILL.md workflows copied into `~/.cursor/skills` and an
MCP entry merged into `~/.cursor/mcp.json`; codex/claude get skills + MCP in
one step through their own plugin systems.)

To uninstall later: `codex plugin remove open-design@open-design` ·
`claude plugin uninstall open-design` · `od agent-plugin uninstall cursor`.

## Step 5 — Verify the install

- codex: `codex plugin list` shows `open-design@open-design … installed, enabled`
- claude: `claude plugin list` shows `open-design@open-design … enabled`
- cursor: `ls ~/.cursor/skills` shows six `open-design-*` folders

The six workflow skills are: `open-design-basics`, `open-design-create`,
`open-design-preview-verify`, `open-design-systems-brands`,
`open-design-export-deliver`, `open-design-known-errors`. If your current
session does not see them yet, they load in the next session — tell the user
that one restart of the agent session may be needed, then continue; the
`od` commands below work either way.

## Step 6 — First render (no model keys needed)

Prove the full loop end to end and give the user something to look at:

```bash
od project create --name "Open Design first render" --json
# read project.id from the JSON, then:
printf '<!doctype html><html><body style="font:16px system-ui;display:grid;place-items:center;height:100vh"><h1>Open Design ✕ your agent — installed</h1></body></html>' \
  | od files write <project.id> index.html
```

Now open the live preview **in your own browser surface** (Codex browser /
Claude browser / Cursor browser) and keep it visible to the user:

```text
http://127.0.0.1:7456/api/projects/<project.id>/raw/index.html
```

If that page renders, the whole chain works: CLI → daemon → project files →
live preview → your browser. This URL pattern is how you will visually verify
every real artifact from now on (see the `open-design-preview-verify` skill).

## Step 7 — Set up the first task

Tell the user the install succeeded and ask what to make first — for example
a launch deck from a README, a landing page from a brief, or a brand
extraction from their website URL. Then follow the `open-design-create`
skill: `od skills list` / `od design-systems list` → `od run start --project
<id> --conversation <cid> --message "<brief>" --follow --json` → preview →
verify in your browser → iterate → `od export`.

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| exit 64, `daemon-not-running` | daemon down | Step 3 |
| binary garbage from `od` | octal-dump shadow | Step 2 |
| exit 68 / 69 | stale project/run id | `od project list --json` / `od run list --json` |
| exit 70, `provider-not-configured` | generation needs a model provider | **ASK** the user to connect a provider in Open Design settings (first-render Step 6 works without one) |
| preview URL 404 | wrong relpath | `od files list <project.id> --json` |

More detail lives in the installed `open-design-known-errors` skill.
