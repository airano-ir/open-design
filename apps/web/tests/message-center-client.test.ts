import { beforeEach, describe, expect, it, vi } from 'vitest';

import { anonymousStartedAt, pullMessageCenter } from '../src/message-center-client';

describe('message center client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps the first anonymous window after later launches', () => {
    const storage = new Map<string, string>();
    const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) } as Storage;
    const first = anonymousStartedAt(adapter, new Date('2026-07-16T00:00:00Z'));
    const second = anonymousStartedAt(adapter, new Date('2026-07-17T00:00:00Z'));
    expect(second).toBe(first);
  });

  it('follows pagination until the server cursor is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'new' }], nextCursor: 'next', unreadCount: 1 }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'old' }], nextCursor: null, unreadCount: 1 })));
    const result = await pullMessageCenter({ locale: 'en', loggedIn: false, startedAt: '2026-07-16T00:00:00.000Z' });
    expect(result.map((message) => message.id)).toEqual(['new', 'old']);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      '/api/integrations/vela/api-proxy/api/v1/message-center/messages?',
    );
  });

  it('fails fast when pagination cursors stop advancing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'new' }], nextCursor: 'stuck', unreadCount: 1 }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'old' }], nextCursor: 'stuck', unreadCount: 1 })));
    await expect(
      pullMessageCenter({ locale: 'en', loggedIn: false, startedAt: '2026-07-16T00:00:00.000Z' }),
    ).rejects.toThrow('Message Center pagination cursor did not advance');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('uses the credential-scoped daemon route for logged-in pulls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ messages: [], nextCursor: null, unreadCount: 0 }),
    ));
    await pullMessageCenter({ locale: 'en', loggedIn: true });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      '/api/integrations/vela/message-center/messages?',
    );
  });
});
