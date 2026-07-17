# Local test build

This is the local validation path for the same V1 workflow used by the hosted ChatGPT app. The package includes a self-contained stdio MCP for Codex so `collect_brief` and its Custom UI do not disappear when a manually started HTTP dev server stops.

## 1. Validate the package

From the repository root:

```bash
pnpm exec tsx plugins/open-design/scripts/verify-local.ts --package-only
```

This checks the repo marketplace entry, plugin and app manifests, skill path, Cloud sign-in policy, and bundled Codex MCP entry.

## 2. Start the local gateway

Use the repository lifecycle entry point:

```bash
pnpm tools-dev run web --daemon-port 17456 --web-port 17574
```

The daemon accepts MCP inspection from a direct loopback client without disabling the production authentication boundary. Sign in to Open Design Cloud in the local Open Design UI when you want to exercise account balance and a real generation run.

## 3. Verify the MCP Apps contract

In another terminal:

```bash
pnpm exec tsx plugins/open-design/scripts/verify-local.ts
```

The verifier connects to `http://127.0.0.1:17456/mcp` and proves that:

- the server identifies as Open Design;
- only the nine Cloud V1 tools are published;
- `start_run` accepts website, product prototype, presentation, and Design System;
- the MCP Apps Artifact card resource is registered.

You can also connect MCP Inspector to `http://127.0.0.1:17456/mcp` to call tools and render the card interactively.

To inspect the real MCP Apps card without a ChatGPT host, start the local Card Gallery:

```bash
pnpm exec tsx plugins/open-design/scripts/preview-local-card.ts
```

Open `http://127.0.0.1:17640/` and switch between `running`, `complete`, and
`recharge`. In the `brief` state, confirm that goal, audience, content, and
visual style render as preselected choices with no free-text fields. The gallery loads the card HTML from the live MCP resource and
provides a small host simulator for refresh, versions, restore, export, and
external-link actions; it does not maintain a separate copy of the card.

## 4. Install the repository plugin in Codex

Open the repository marketplace from the Codex deep link in the project handoff and install **Open Design**. After every install or update—including a manifest, skill, bundle, or cachebuster change—fully quit and relaunch Codex, then create a fresh task and select Open Design again. The plugin-page Refresh control and a fresh task by themselves do not reload an already-running MCP process.

The installed plugin must contribute both the workflow skill and an `open-design` stdio MCP. The acceptance signal is a real `collect_brief` tool call whose Custom UI card appears in the fresh task; prose questions or literal `<question-form>` markup mean the tool snapshot is still stale. `collect_brief` works while the Open Design daemon is offline; account and generation calls additionally require Open Design to be running.

The checked-in `.app.json` remains empty until ChatGPT Developer Mode assigns the real `asdk_app_...` identifier. That identifier belongs to the hosted app registration and must not be replaced with a fake local id.

## 5. Optional ChatGPT Developer Mode test

ChatGPT cannot connect directly to a loopback URL. To test inside ChatGPT before production deployment, expose the local daemon through an access-controlled HTTPS tunnel and set the public MCP resource URL to the tunnel's exact `/mcp` URL. For that short-lived test only, set `OD_CHATGPT_MCP_ALLOW_UNAUTHENTICATED=1`, then remove it immediately after the session.

Do not use this tunnel mode for a shared or production deployment. The release build must use Open Design OAuth and managed tenant routing described in [PRODUCTION.md](./PRODUCTION.md).

The hosted deployment has a separate read-only verifier at
`scripts/verify-production.ts`; it intentionally requires HTTPS and therefore
does not replace this loopback test path.
