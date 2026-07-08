import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createCollabRuntime } from '../src/collab/runtime.js';
import { registerCollabPresenceRoutes } from '../src/routes/collab-presence.js';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    const toClose = server;
    server = null;
    await new Promise<void>((resolve) => toClose.close(() => resolve()));
  }
});

async function startPresenceServer() {
  const app = express();
  app.use(express.json());
  registerCollabPresenceRoutes(app, { collab: createCollabRuntime() });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    async json(route: string, options: { method?: string; body?: unknown } = {}) {
      const init: RequestInit = { method: options.method ?? 'GET' };
      if (options.body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(options.body);
      }
      const response = await fetch(`${base}${route}`, init);
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
  };
}

function presentIds(body: Record<string, any>): string[] {
  return (body.present as { memberId: string }[]).map((member) => member.memberId).sort();
}

describe('collab presence routes', () => {
  it('heartbeats a member and lists the present set', async () => {
    const api = await startPresenceServer();
    const hb = await api.json('/api/projects/p1/presence/heartbeat', {
      method: 'POST',
      body: { memberId: 'm1', name: 'Ada', role: 'owner' },
    });
    expect(hb.status).toBe(200);
    expect(hb.body.present).toEqual([{ memberId: 'm1', name: 'Ada', role: 'owner' }]);

    const list = await api.json('/api/projects/p1/presence');
    expect(list.status).toBe(200);
    expect(presentIds(list.body)).toEqual(['m1']);
  });

  it('removes a member on leave', async () => {
    const api = await startPresenceServer();
    await api.json('/api/projects/p1/presence/heartbeat', { method: 'POST', body: { memberId: 'm1' } });
    await api.json('/api/projects/p1/presence/heartbeat', { method: 'POST', body: { memberId: 'm2' } });
    const left = await api.json('/api/projects/p1/presence/leave', { method: 'POST', body: { memberId: 'm1' } });
    expect(left.status).toBe(200);
    expect(presentIds(left.body)).toEqual(['m2']);
  });

  it('rejects a heartbeat without a memberId', async () => {
    const api = await startPresenceServer();
    const res = await api.json('/api/projects/p1/presence/heartbeat', { method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });

  it('scopes presence per project', async () => {
    const api = await startPresenceServer();
    await api.json('/api/projects/p1/presence/heartbeat', { method: 'POST', body: { memberId: 'm1' } });
    const other = await api.json('/api/projects/p2/presence');
    expect(other.body.present).toEqual([]);
  });
});
