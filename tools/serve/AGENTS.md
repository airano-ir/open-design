# tools/serve

Follow the root `AGENTS.md` and `tools/AGENTS.md` first. This tool owns small local-development service entrypoints.

## Owns

- `tools-serve` CLI.
- Local static updater fixtures for desktop update IPC and packaged-runtime debugging.
- `resource-hub` fixture — a self-contained, in-memory stand-in for the Spec E
  resource storage service (see below).
- `collab-cloud` fixture — a self-contained, in-memory stand-in for the C-lane
  cross-daemon collaboration hub (comment sync + member directory; see below).

## Rules

- Keep services self-contained and local-first.
- Do not put product update runtime logic here; this tool serves deterministic fixtures only.
- New services should use explicit subcommands under `tools-serve start <service>`.

## resource-hub fixture (TEMPORARY)

An infra-free, in-memory local backend for the daemon's Spec E resource
features. Lets you develop against the resource API without standing up the real
vela stack (services/api + postgres + MinIO). It faithfully implements the same
wire contract (endpoints, error codes, `x-internal-token` + `x-workspace-*`
auth, freeze, cross-team isolation, content-addressed dedup, presigned-style
blob transport served from the same process).

Run it, then point the daemon at it:

```
pnpm tools-serve start resource-hub --port 18090
# then, for the daemon / od CLI:
export OD_RESOURCE_HUB_URL=http://localhost:18090
export OD_RESOURCE_HUB_TOKEN=dev-internal-token
export OD_WORKSPACE_MEMBER_ID=you OD_WORKSPACE_TEAM_ID=your-team OD_WORKSPACE_ROLE=owner
od resource put ./some-dir --kind design_system --ref latest
od resource get <resource-id> ./dest
```

Or run against a **local vela stack** instead of the fixture, for real byte
transport (the vela stack's MinIO) — see the vela repo's
`docker/docker-compose.dev.yml` + `services/api/.env.example`. Start the vela api
(`pnpm dev:docker:up` + `pnpm --filter @vela/api dev`, api on `:18080`, which is
also the daemon's default hub URL), then set only:

```
export OD_RESOURCE_HUB_TOKEN=dev-internal-token   # matches vela CLOUD_INTERNAL_API_TOKEN
export OD_WORKSPACE_MEMBER_ID=you OD_WORKSPACE_TEAM_ID=your-team OD_WORKSPACE_ROLE=owner
# OD_RESOURCE_HUB_URL is optional here — it defaults to http://127.0.0.1:18080
```

- **The daemon makes no mock concessions** — it runs its real client/SDK against
  this exactly as it would against vela. The fixture is the only "fake" piece.
- **This is disposable.** Once the vela test environment is stood up, delete
  `src/resource-hub-fixture.ts` (and its wiring in `src/index.ts`) and repoint
  `OD_RESOURCE_HUB_URL` at the real test API. The daemon needs zero code changes.
- **Keep the contract in sync** with `services/api/src/resources/routes.ts` in
  the vela repo — change one, mirror the other. `tests/resource-hub-fixture.test.ts`
  locks the fixture's half of the contract.

## collab-cloud fixture (TEMPORARY)

An infra-free, in-memory local backend for the C-lane cross-daemon
collaboration hub (spec §D4). It carries two things the daemon needs to make a
shared project collaborative across members' machines: an APPEND-ONLY per-project
comment stream (with a monotonic `seq` cursor) and a light member directory
(`memberId → {displayName, role}`) so the client can render an author's name +
role. It is a relay, not a validator — comments are stored opaquely and only the
`seq` is hub-owned; there is no edit/delete propagation and no presence.

Run it, then point both daemons at it (the same URL + token):

```
pnpm tools-serve start collab-cloud            # defaults to :18096
# then, for each daemon:
export OD_COLLAB_CLOUD_URL=http://127.0.0.1:18096
export OD_COLLAB_CLOUD_TOKEN=dev-internal-token
```

- **Bearer auth**: every request must carry `Authorization: Bearer <token>`;
  missing/mismatched → 401. The token is a local stub principal; the real hub
  verifies B's signed token (§D4.4). Teams are isolated by the `:teamId` path.
- **Endpoints**: `PUT /teams/:teamId/members/:memberId` (upsert directory entry),
  `GET /teams/:teamId/members`, `POST /teams/:teamId/projects/:projectId/comments`
  (append, returns `{seq}`, idempotent by comment id),
  `GET /teams/:teamId/projects/:projectId/comments?sinceSeq=N` (incremental pull,
  ETag/`If-None-Match` → 304).
- **This is disposable.** Once vela `services/collab` is stood up, delete
  `src/collab-cloud-fixture.ts` (and its wiring in `src/index.ts`) and repoint
  `OD_COLLAB_CLOUD_URL` at the real service. The daemon needs zero code changes.
  `tests/collab-cloud-fixture.test.ts` locks the fixture's half of the contract.
