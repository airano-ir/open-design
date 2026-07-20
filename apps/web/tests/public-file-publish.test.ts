import { describe, expect, it } from 'vitest';
import {
  buildWorkspacePermissions,
  buildWorkspaceSeatSummary,
  type WorkspaceCollabContext,
} from '@open-design/contracts';
import {
  canPublishPublicFile,
  publicFilePublishFailureKey,
} from '../src/collab/public-file-publish';

function context(overrides: Partial<WorkspaceCollabContext> = {}): WorkspaceCollabContext {
  return {
    workspaceId: 'ws-1',
    workspaceType: 'team',
    teamId: 'team-1',
    workspaceMemberId: 'wm-1',
    role: 'member',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: buildWorkspaceSeatSummary({ seatLimit: 5, usedSeats: 1 }),
    permissions: buildWorkspacePermissions({ role: 'member', lifecycleState: 'active' }),
    ...overrides,
  };
}

describe('canPublishPublicFile', () => {
  it('allows a team workspace with a resolved member', () => {
    expect(canPublishPublicFile(context())).toBe(true);
  });

  // The dogfood bug: these three states all render the Publish button today and
  // every one of them can only ever come back 409 WORKSPACE_IDENTITY_REQUIRED.
  it('refuses a personal workspace', () => {
    expect(canPublishPublicFile(context({ workspaceType: 'personal' }))).toBe(false);
  });

  it('refuses a signed-out / unresolved context', () => {
    expect(canPublishPublicFile(null)).toBe(false);
    expect(canPublishPublicFile(undefined)).toBe(false);
  });

  it('refuses a team context whose member id has not resolved yet', () => {
    expect(canPublishPublicFile(context({ workspaceMemberId: '' }))).toBe(false);
  });
});

describe('publicFilePublishFailureKey', () => {
  it('maps the workspace-identity refusal to its own explanation', () => {
    expect(publicFilePublishFailureKey(new Error('WORKSPACE_IDENTITY_REQUIRED'))).toBe(
      'fileViewer.publishFileRequiresTeam',
    );
  });

  it('falls back to a generic failure for anything else', () => {
    expect(publicFilePublishFailureKey(new Error('PUBLIC_FILE_URL_UNAVAILABLE'))).toBe(
      'fileViewer.publishFileFailed',
    );
    expect(publicFilePublishFailureKey(null)).toBe('fileViewer.publishFileFailed');
  });
});
