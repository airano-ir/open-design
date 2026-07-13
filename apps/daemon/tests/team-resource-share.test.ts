import { describe, expect, it } from 'vitest';
import {
  TeamResourceShareForbiddenError,
  createTeamResourceShareService,
  parseSharedResourceIds,
} from '../src/collab/team-resource-share.js';
import type { ResourceHubPrincipal } from '../src/collab/resource-principal.js';

const unreachableRun = async (): Promise<string> => {
  throw new Error('Vela should not run when the permission gate stops sharing');
};
const principal: ResourceHubPrincipal = {
  memberId: 'wm-1',
  teamId: 't-1',
  role: 'member',
  lifecycleState: 'active',
};

describe('team resource share permission gate', () => {
  it('refuses a team member who cannot manage shared resources (403 marker)', async () => {
    const service = createTeamResourceShareService({
      kind: 'design_system',
      idPrefix: 'ds',
      resolveDir: () => '/tmp/ds',
      getPrincipal: () => principal,
      getCanShare: () => false,
      run: unreachableRun,
      env: { OD_WORKSPACE_CONTEXT_SOURCE: 'vela' },
    });
    await expect(service.share('ds-1')).rejects.toBeInstanceOf(TeamResourceShareForbiddenError);
    expect(service.isShared('ds-1')).toBe(false);
  });

  it('stays a silent no-op when there is no team identity, without a permission error', async () => {
    const service = createTeamResourceShareService({
      kind: 'design_system',
      idPrefix: 'ds',
      resolveDir: () => '/tmp/ds',
      getPrincipal: () => null,
      getCanShare: () => false,
      run: unreachableRun,
      env: { OD_WORKSPACE_CONTEXT_SOURCE: 'vela' },
    });
    expect(await service.share('ds-1')).toBeNull();
  });

  it('keeps a non-Vela dev workspace on the unconfigured no-op path', async () => {
    const service = createTeamResourceShareService({
      kind: 'design_system',
      idPrefix: 'ds',
      resolveDir: () => '/tmp/ds',
      getPrincipal: () => principal,
      getCanShare: () => true,
      run: unreachableRun,
      env: {},
    });

    expect(service.configured).toBe(false);
    expect(await service.share('ds-1')).toBeNull();
    expect(await service.sharedIds()).toEqual([]);
  });

  it('lists resources already shared through another daemon via Vela CLI', async () => {
    const run = async (args: string[]): Promise<string> => {
      expect(args).toEqual(['shared', '--json']);
      return JSON.stringify({
        resources: [
          { id: 'skill-mock-team-expert-kit', kind: 'skill', deletedAt: null },
          { id: 'skill-deleted-kit', kind: 'skill', deletedAt: '2026-07-13T00:00:00Z' },
          { id: 'project-p1', kind: 'project', deletedAt: null },
        ],
      });
    };
    const service = createTeamResourceShareService({
      kind: 'skill',
      idPrefix: 'skill',
      resolveDir: () => '/tmp/skill',
      getPrincipal: () => principal,
      getCanShare: () => false,
      run,
      env: { OD_WORKSPACE_CONTEXT_SOURCE: 'vela' },
    });

    expect(await service.sharedIds()).toEqual(['mock-team-expert-kit']);
    expect(service.isShared('mock-team-expert-kit')).toBe(true);
  });

  it('parses shared resource ids by kind and prefix', () => {
    expect(
      parseSharedResourceIds(
        JSON.stringify({
          resources: [
            { id: 'plugin-alpha', kind: 'plugin' },
            { id: 'skill-alpha', kind: 'skill' },
            { id: 'skill-beta', kind: 'skill', deletedAt: null },
            { id: 'skill-gamma', kind: 'skill', deletedAt: '2026-07-13T00:00:00Z' },
          ],
        }),
        'skill',
        'skill',
      ),
    ).toEqual(['alpha', 'beta']);
  });
});
