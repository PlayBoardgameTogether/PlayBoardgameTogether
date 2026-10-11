import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../packages/client-sdk/src/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const room = {
  id,
  assetVersionId: null,
  name: '朋友的桌',
  status: 'waiting',
  hostAccountId: id,
  gameId: 'color-match',
  gameVersion: '1.0.0',
  options: {},
  seatCount: 2,
  roomRevision: 1,
  activeMatchId: null,
  visibility: 'private',
  hasPassword: false,
  matchStatus: null,
  members: [],
  seats: [],
  permissions: { isHost: true, canConfigure: true, canStart: false },
  startBlockers: [],
};
const session = {
  account: { id, username: 'alice', displayName: 'Alice', role: 'user', status: 'active' },
  csrfToken: 'validated-csrf',
  expiresAt: '2026-10-06T00:00:00.000Z',
};
const response = (data: unknown) => Response.json({ ok: true, data, traceId: 'contract-test' });

afterEach(() => vi.unstubAllGlobals());

describe('client room and account contracts', () => {
  it('rejects malformed room data and session metadata at the transport boundary', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ...room, roomRevision: '1' }))
      .mockResolvedValueOnce(
        response({ ...session, account: { ...session.account, role: 'superuser' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    await expect(client.room(id)).rejects.toThrow();
    await expect(client.me()).rejects.toThrow();
  });

  it('uses the validated session CSRF token and strips the command discriminator from HTTP input', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(room));
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    await client.me();
    await client.roomCommand(id, {
      type: 'ready',
      requestId: 'ready-once',
      expectedRoomRevision: 0,
      ready: true,
    });
    const [path, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(path).toBe(`/api/v1/rooms/${id}/my-ready`);
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('validated-csrf');
    expect(JSON.parse(String(init.body))).toEqual({
      requestId: 'ready-once',
      expectedRoomRevision: 0,
      ready: true,
    });
  });

  it('routes a bot command to its seat and validates start results independently of snapshots', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(room))
      .mockResolvedValueOnce(response({ matchId: id }));
    vi.stubGlobal('fetch', fetch);
    const client = new ApiClient();
    await client.roomCommand(id, {
      type: 'add-bot',
      seatId: id,
      settings: { policyId: 'basic-v1' },
      requestId: 'bot-once',
      expectedRoomRevision: 0,
    });
    const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/rooms/${id}/seats/${id}/bot`);
    expect(JSON.parse(String(init.body))).toEqual({
      requestId: 'bot-once',
      expectedRoomRevision: 0,
      policyId: 'basic-v1',
    });
    await expect(
      client.roomCommand(id, { type: 'start', requestId: 'start-once', expectedRoomRevision: 1 }),
    ).resolves.toEqual({ matchId: id });
  });
});
