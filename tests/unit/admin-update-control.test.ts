import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateControl } from '../../apps/api/src/admin/update-control.js';
import { createUpdateControl } from '../../scripts/update-control.mjs';
import { adminUpdateCommandSchema, adminUpdateStatusSchema } from '../../packages/protocol/src/admin.js';

afterEach(() => vi.useRealTimers());
describe('administrator update controls', () => {
  const initial = { enabled: true, branch: 'main', currentSha: 'a'.repeat(40),
    candidateSha: null, lastCheckedAt: null, phase: 'idle' };
  it('reports unavailable without a parent and rejects configurable execution fields', async () => {
    expect((await new UpdateControl(new EventEmitter()).request('status')).phase).toBe('unavailable');
    expect(adminUpdateCommandSchema.safeParse({ requestId: crypto.randomUUID(), branch: 'evil', force: true }).success).toBe(false);
  });
  it('accepts only correlated, validated parent replies and removes listeners', async () => {
    const ipc = Object.assign(new EventEmitter(), { connected: true,
      send: vi.fn((message: unknown, callback: (error: Error | null) => void) => {
        callback(null);
        const id = (message as { id: string }).id;
        ipc.emit('message', { type: 'update.control.result', id: 'wrong', status: initial });
        ipc.emit('message', { type: 'update.control.result', id, status: initial });
      }),
    });
    const control = new UpdateControl(ipc, true);
    expect(await control.request('status')).toEqual(initial);
    expect(ipc.listenerCount('message')).toBe(0);
  });
  it('times out old supervisors without keeping message listeners', async () => {
    vi.useFakeTimers();
    const ipc = Object.assign(new EventEmitter(), { connected: true, send: vi.fn() });
    const result = new UpdateControl(ipc, true).request('check', 'request');
    const assertion = expect(result).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(ipc.listenerCount('message')).toBe(0);
  });
  it('acknowledges immediately, coalesces concurrent requests and deduplicates retries after completion', async () => {
    let release!: () => void;
    const hold = new Promise<void>(done => { release = done; });
    const run = vi.fn(() => hold);
    const control = createUpdateControl({ enabled: true, branch: 'main', currentSha: initial.currentSha, run });
    expect(control.check('first').phase).toBe('checking');
    control.check('second');
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    release();
    await new Promise(done => setImmediate(done));
    control.check('first');
    control.check('second');
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    control.check('third');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not send commands to an unrelated IPC parent', async () => {
    const ipc = Object.assign(new EventEmitter(), { connected: true, send: vi.fn() });
    expect((await new UpdateControl(ipc, false).request('check', 'id')).phase).toBe('unavailable');
    expect(ipc.send).not.toHaveBeenCalled();
  });
  it('respects disabled detection and exposes sanitized failure state', async () => {
    const run = vi.fn(async () => { throw new Error('secret build output'); });
    const disabled = createUpdateControl({ enabled: false, branch: 'main', currentSha: initial.currentSha, run });
    expect(disabled.check('id').phase).toBe('disabled');
    expect(run).not.toHaveBeenCalled();
    const enabled = createUpdateControl({ enabled: true, branch: 'main', currentSha: initial.currentSha, run });
    enabled.check('id');
    await new Promise(done => setImmediate(done));
    expect(enabled.snapshot().phase).toBe('failed');
    expect(JSON.stringify(enabled.snapshot())).not.toContain('secret');
  });
  it('passes validated failure details over IPC and clears stale failure on retry', async () => {
    const failure = { stage: 'install', reason: 'network', exitCode: 1, occurredAt: new Date().toISOString() };
    const failed = { ...initial, phase: 'failed', failure };
    const ipc = Object.assign(new EventEmitter(), { connected: true,
      send: vi.fn((message: { id: string }) => {
        ipc.emit('message', { type: 'update.control.result', id: message.id, status: failed });
      }),
    });
    expect(await new UpdateControl(ipc, true).request('status')).toEqual(failed);
    expect(adminUpdateStatusSchema.safeParse({ ...failed, failure: { ...failure, output: 'secret' } }).success).toBe(false);
    const control = createUpdateControl({ enabled: true, branch: 'main', currentSha: initial.currentSha, run: async () => {} });
    control.patch(failed);
    expect(control.check('retry')).toMatchObject({ phase: 'checking', failure: null });
  });
});
