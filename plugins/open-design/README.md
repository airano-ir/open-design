# Open Design for ChatGPT and Codex

This is the first-party Open Design plugin package. The hosted ChatGPT product connection stays in `.app.json`; Codex installs the same Cloud V1 workflow through the self-contained stdio MCP declared in `.mcp.json`. The Codex entry can register `collect_brief` and render its Custom UI even before a local Open Design daemon is running.

## V1 capabilities

- Publish nine focused skills: shared `open-design-basics`, then one create skill for each artifact type—website, product prototype, presentation, design system, image, video, audio, and document. The retired catch-all `create-with-open-design` skill is not part of the package.
- Support exactly eight `artifactType` values: `website`, `product-prototype`, `presentation`, `design-system`, `image`, `video`, `audio`, and `document`. `collect_brief`, `create_project`, and `start_run` keep that type explicit through the whole run.
- Confirm audience, outcome, content/flows, creative direction, and output format through the choice-only Custom UI. Every visible field is a radio or checkbox choice; supplied wording becomes a preselected **From your brief** choice instead of an editable text field.
- Render output choices for every artifact type in Artifact Card v9. The card leaves the host to provide Open Design identity, so it does not repeat an internal OpenDesign header, logo, or subtitle.
- Generate real image, video, and audio files through the media workflow. A prompt, storyboard, or metadata-only result is not delivery.
- Generate Document V1 as editable Markdown plus a print-ready HTML preview suitable for later PDF export. This workflow does not claim native DOCX output.
- Show generation progress and render the result card through the MCP Apps UI resource; the card polls in place through the standard MCP Apps bridge instead of remounting on every status check.
- Treat websites, prototypes, presentations, images, video, audio, and documents as delivered only when they have real project files and an Artifact preview, then open the exact Studio project and rendered Artifact in two host in-app-browser tabs when that capability is available. A design-system delivery requires a real generated `DESIGN.md` and opens in Studio.
- Continue complex editing, version review, and advanced export in Open Design studio.
- Use the signed-in Open Design Cloud balance by default, with recharge and local Code Agent/BYOK fallback guidance.

The published skill ids are `open-design-basics`,
`create-website-with-open-design`, `create-prototype-with-open-design`,
`create-presentation-with-open-design`,
`create-design-system-with-open-design`, `create-image-with-open-design`,
`create-video-with-open-design`, `create-audio-with-open-design`, and
`create-document-with-open-design`.

## Developer validation

1. Start a single-tenant Open Design test deployment and sign in to Open Design Cloud.
2. Point MCP Inspector or ChatGPT Developer Mode directly at that deployment's `POST /mcp` endpoint.
3. Validate the nine hosted V1 tools, all eight artifact types, and Artifact Card v9 through Streamable HTTP.
4. Add this repository marketplace in Codex developer settings to validate Basics plus the eight artifact skills and bundled Custom UI MCP together.
5. After installing or updating the plugin, including a manifest, skill, bundle, or cachebuster change, fully quit and relaunch the desktop app. Merely pressing Refresh on the plugin page or opening a fresh task does not reload an already-running MCP process. Validate the relaunch in a new task by confirming that the first incomplete brief produces a real choice-only `collect_brief` Custom UI card rather than prose or literal form markup.

For the one-command package and MCP contract verifier, Codex install path, and
optional ChatGPT HTTPS-tunnel flow, see [LOCAL_TEST.md](./LOCAL_TEST.md).

The ChatGPT Apps path uses Streamable HTTP at `POST /mcp`; remote access is denied by default unless a trusted deployment configures its OAuth boundary. The bundled stdio entry is only the Codex/local-test transport for the same narrow V1 contract. It does not replace the hosted HTTPS/OAuth boundary used by ChatGPT.

The hosted `POST /mcp` surface is intentionally narrower than the engineering MCP surface: it exposes only the eight Cloud V1 artifact workflows plus account status, progress, versions, and export. It does not expose arbitrary file writes, project deletion, local active context, local-agent execution, or generic plugin execution.

## Hosted app handoff

The checked-in `.app.json` intentionally has an empty `apps` object. ChatGPT assigns the real `asdk_app_...` id only after the HTTPS MCP endpoint is registered in developer mode; add that assigned id before publishing the marketplace release.

Production user linking uses the OAuth 2.1 provider implemented in Vela: discovery, dynamic public-client registration, authorization code + PKCE, consent, refresh tokens, and audience-bound JWT access tokens. The public MCP gateway includes managed tenant mode, which maps the verified subject to isolated Open Design execution storage and short-lived personal Vela credentials. A real release still requires deploying that gateway behind public HTTPS and registering the assigned ChatGPT App ID.

See [PRODUCTION.md](./PRODUCTION.md) for the exact OAuth, tenant-isolation, App ID, and release acceptance handoff.
