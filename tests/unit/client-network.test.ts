import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../../packages/client-sdk/src/index.js';
import { sessionFixture } from '../fixtures/session.js';
import { matchViewSchema } from '../../packages/protocol/src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stalledFetch(body = false) {
  return vi.fn((_url: string, init: RequestInit) => {
    const wait = () =>
      new Promise<never>((_resolve, reject) => {
        if (init.signal?.aborted) reject(init.signal.reason);
        else
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    return body ? Promise.resolve({ status: 200, json: wait }) : wait();
  });
}

it.each([false, true])(
  'bounds session requests including a stalled response body (%s)',
  async (body) => {
    vi.useFakeTimers();
    const fetch = stalledFetch(body);
    vi.stubGlobal('fetch', fetch);
    const result = new ApiClient().me();
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('honors caller cancellation and removes its deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', stalledFetch());
  const controller = new AbortController();
  const result = new ApiClient().me(controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up cancellation listeners and timers after a successful request', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ ok: true, data: sessionFixture(), traceId: 'test' })),
  );
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await expect(new ApiClient().me(controller.signal)).resolves.toEqual(sessionFixture());
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('allows bounded binary upload validation beyond the ordinary request deadline', async () => {
  vi.useFakeTimers();
  const fetch = stalledFetch();
  vi.stubGlobal('fetch', fetch);
  const result = new ApiClient().reviewGamePackage(new Blob(['fixture']));
  const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(90000);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a signal already cancelled before reading a room', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', stalledFetch());
  const controller = new AbortController();
  controller.abort();
  await expect(new ApiClient().room('test-room', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('validates compact social updates and passes the validator on the next poll', async () => {
  const version = 'a'.repeat(64);
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ ok: true, data: { changed: false, version }, traceId: 'test' }),
    );
  vi.stubGlobal('fetch', fetch);
  const client = new ApiClient();
  await expect(client.socialUpdates(version)).resolves.toEqual({ changed: false, version });
  expect(fetch.mock.calls[0]![0]).toBe(`/api/v1/social/updates?version=${version}`);
  fetch.mockResolvedValueOnce(
    Response.json({ ok: true, data: { changed: true, version }, traceId: 'test' }),
  );
  await expect(client.socialUpdates(version)).rejects.toThrow();
});

it('conditionally validates a match without parsing a bodyless 304 or caching across reads', async () => {
  const snapshot = matchViewSchema.parse({
    matchId: '00000000-0000-4000-8000-000000000001',
    roomId: '00000000-0000-4000-8000-000000000002',
    gameId: 'demo.counter-room',
    gameVersion: '1.0.0',
    revision: 0,
    status: 'active',
    seatIndex: 0,
    delivery: 'snapshot',
    controller: { type: 'human', controllerEpoch: 0, controllerVersion: 0, policyId: null },
    aiStatus: { status: 'idle', version: 0, safeErrorCode: null },
    view: {},
  });
  const validator = `W/"${'a'.repeat(64)}"`;
  const full = () =>
    Response.json({ ok: true, data: snapshot, traceId: 'test' }, { headers: { etag: validator } });
  const unchanged = new Response(null, { status: 304, headers: { etag: validator } });
  const parse = vi.spyOn(unchanged, 'json');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(full())
    .mockResolvedValueOnce(unchanged)
    .mockResolvedValueOnce(full())
    .mockResolvedValueOnce(
      Response.json(
        {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'revoked', retryable: false },
          traceId: 'test',
        },
        { status: 401 },
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const client = new ApiClient();
  await expect(client.matchSnapshotIfChanged(snapshot.matchId)).resolves.toEqual({
    changed: true,
    snapshot,
    validator,
  });
  await expect(client.matchSnapshotIfChanged(snapshot.matchId, validator)).resolves.toEqual({
    changed: false,
    validator,
  });
  expect(new Headers(fetch.mock.calls[1]![1].headers).get('if-none-match')).toBe(validator);
  expect(parse).not.toHaveBeenCalled();
  await expect(client.matchSnapshot(snapshot.matchId)).resolves.toEqual(snapshot);
  expect(new Headers(fetch.mock.calls[2]![1].headers).has('if-none-match')).toBe(false);
  await expect(client.matchSnapshotIfChanged(snapshot.matchId, validator)).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
  });
});

it('cancels conditional match reads and rejects 304 without a prior validator', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', stalledFetch());
  const controller = new AbortController();
  const read = new ApiClient().matchSnapshotIfChanged('match', '"tag"', controller.signal);
  const assertion = expect(read).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
  await expect(new ApiClient().matchSnapshotIfChanged('match')).rejects.toThrow();
});
