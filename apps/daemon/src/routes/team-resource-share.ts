import type { Express } from 'express';
import {
  TeamResourceShareForbiddenError,
  type TeamResourceShareService,
} from '../collab/team-resource-share.js';

export interface RegisterTeamResourceShareRoutesDeps {
  /** URL segment for this resource kind: `design-systems` | `plugins` | `skills`. */
  basePath: string;
  share: TeamResourceShareService;
}

/**
 * Team resource sharing routes for one resource kind. A member promotes a
 * personal resource into the team scope; the share service packs its directory
 * and pushes it to the resource hub so teammates can pull it. When there is no
 * team identity (or the hub is not configured), share returns `shared: false`
 * so the client keeps a local-only view instead of erroring. Mounted once per
 * kind (design systems, plugins, skills).
 */
export function registerTeamResourceShareRoutes(
  app: Express,
  deps: RegisterTeamResourceShareRoutesDeps,
): void {
  const { basePath, share } = deps;
  const root = `/api/workspace/${basePath}`;

  // Ids shared to the team — drives the "team" collection for this kind.
  app.get(`${root}/team`, async (_req, res) => {
    res.json({ ids: await share.sharedIds() });
  });

  // Share a personal resource to the team.
  app.post(`${root}/:id/share`, async (req, res) => {
    const id = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id) : '';
    if (!id) return res.status(400).json({ error: 'invalid resource id' });
    try {
      const result = await share.share(id);
      if (!result) return res.json({ shared: false });
      res.json({ shared: true, version: result.version });
    } catch (error) {
      if (error instanceof TeamResourceShareForbiddenError) {
        return res.status(403).json({ error: 'WORKSPACE_RESOURCE_SHARE_DENIED' });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'share failed' });
    }
  });
}
