import {
  workspaceContextHasTeamIdentity,
  type WorkspaceCollabContext,
} from '@open-design/contracts';

/**
 * Whether the public single-file "Publish" entry point may be rendered.
 *
 * A public link is a snapshot in the workspace resource hub, and the hub can
 * only be addressed by a team workspace — the daemon's three
 * `/files/:name/publish-public` handlers all reject a non-team caller with 409
 * `WORKSPACE_IDENTITY_REQUIRED` before they touch anything. Rendering the button
 * for a personal or signed-out session therefore offers an action that cannot
 * succeed, so the entry point must be gated on the SAME predicate the daemon
 * gates on (`workspaceContextHasTeamIdentity`, shared via @open-design/contracts)
 * rather than a second, drift-prone copy of the rule.
 *
 * Personal workspaces are not left without a way to publish: the deploy
 * providers in the same share menu (`/api/projects/:id/deploy`) carry no
 * workspace gate.
 */
export function canPublishPublicFile(
  context: WorkspaceCollabContext | null | undefined,
): boolean {
  return workspaceContextHasTeamIdentity(context);
}

/** Dict keys this module may return; keeps the i18n contract explicit. */
export type PublicFilePublishFailureKey =
  | 'fileViewer.publishFileRequiresTeam'
  | 'fileViewer.publishFileFailed';

/**
 * Map a publish/unpublish failure to the message key the user should read.
 *
 * The daemon answers with an error CODE, which must never reach the screen. The
 * one code worth its own sentence is `WORKSPACE_IDENTITY_REQUIRED`: it is
 * reachable even with the entry point gated, because a team member's workspace
 * context read can fail transiently (offline, hub hiccup, billing/seat state in
 * flux) and the UI then falls back to the last-known context. Telling that user
 * "your workspace identity could not be confirmed" is actionable; "Publish
 * failed" is not.
 */
export function publicFilePublishFailureKey(error: unknown): PublicFilePublishFailureKey {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('WORKSPACE_IDENTITY_REQUIRED')
    ? 'fileViewer.publishFileRequiresTeam'
    : 'fileViewer.publishFileFailed';
}
