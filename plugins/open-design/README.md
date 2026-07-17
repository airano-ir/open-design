# Open Design for ChatGPT

This is the first-party ChatGPT plugin package for Open Design. The hosted ChatGPT product connection stays in `.app.json`; Codex installs the same Cloud V1 workflow through the self-contained stdio MCP declared in `.mcp.json`. The Codex entry can register `collect_brief` and render its Custom UI even before a local Open Design daemon is running.

## First version

- Create websites, product prototypes, and presentations.
- Extract or apply a reusable design system.
- Confirm audience, outcome, content/flows, visual direction, and output format in chat; `start_run` requires that structured brief with `confirmed: true`.
- Show generation progress and render the result card through the MCP Apps UI resource; the card polls in place through the standard MCP Apps bridge instead of remounting on every status check.
- Treat websites, prototypes, and presentations as delivered only when they have real project files and an Artifact preview, then open the exact Studio project and rendered Artifact in two host in-app-browser tabs when that capability is available. A Design System delivery requires a real generated file and opens in Studio.
- Continue complex editing, version review, and advanced export in Open Design studio.
- Use the signed-in Open Design Cloud balance by default, with recharge and local Code Agent/BYOK fallback guidance.

## Developer validation

1. Start a single-tenant Open Design test deployment and sign in to Open Design Cloud.
2. Point MCP Inspector or ChatGPT Developer Mode directly at that deployment's `POST /mcp` endpoint.
3. Validate the hosted V1 tools and Artifact card through Streamable HTTP.
4. Add this repository marketplace in Codex developer settings to validate the skill and bundled Custom UI MCP together.
5. Restart the desktop app after changing plugin manifests.

For the one-command package and MCP contract verifier, Codex install path, and
optional ChatGPT HTTPS-tunnel flow, see [LOCAL_TEST.md](./LOCAL_TEST.md).

The ChatGPT Apps path uses Streamable HTTP at `POST /mcp`; remote access is denied by default unless a trusted deployment configures its OAuth boundary. The bundled stdio entry is only the Codex/local-test transport for the same narrow V1 contract. It does not replace the hosted HTTPS/OAuth boundary used by ChatGPT.

The hosted `POST /mcp` surface is intentionally narrower than the engineering MCP surface: it exposes only the Cloud V1 website/prototype/presentation/Design System workflow plus account status, progress, versions, and export. It does not expose arbitrary file writes, project deletion, local active context, local-agent execution, or generic plugin execution.

## Hosted app handoff

The checked-in `.app.json` intentionally has an empty `apps` object. ChatGPT assigns the real `asdk_app_...` id only after the HTTPS MCP endpoint is registered in developer mode; add that assigned id before publishing the marketplace release.

Production user linking uses the OAuth 2.1 provider implemented in Vela: discovery, dynamic public-client registration, authorization code + PKCE, consent, refresh tokens, and audience-bound JWT access tokens. The public MCP gateway includes managed tenant mode, which maps the verified subject to isolated Open Design execution storage and short-lived personal Vela credentials. A real release still requires deploying that gateway behind public HTTPS and registering the assigned ChatGPT App ID.

See [PRODUCTION.md](./PRODUCTION.md) for the exact OAuth, tenant-isolation, App ID, and release acceptance handoff.
