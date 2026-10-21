import { randomUUID } from 'node:crypto';
import { adminUpdateStatusSchema, type AdminUpdateStatus } from '@boardgame/protocol';
import { AppError } from '../errors.js';

type UpdateIpc = {
  connected?: boolean;
  send?: (message: unknown, callback: (error: Error | null) => void) => unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
};
export class UpdateControl {
  constructor(
    private readonly ipc: UpdateIpc = process,
    private readonly supervised = process.env.BOARDGAME_UPDATE_SUPERVISED === 'true',
  ) {}

  async request(action: 'status' | 'check', requestId?: string): Promise<AdminUpdateStatus> {
    if (!this.supervised || !this.ipc.connected || !this.ipc.send) return {
      enabled: false, branch: null, currentSha: null, candidateSha: null,
      lastCheckedAt: null, phase: 'unavailable',
    };
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: AdminUpdateStatus) => {
        clearTimeout(timer);
        this.ipc.off('message', listener);
        if (error) reject(error);
        else resolve(value!);
      };
      const unavailable = () => new AppError('SERVICE_UNAVAILABLE', '更新服务暂时无法连接，请稍后重试', 503, true);
      const listener = (message: unknown) => {
        if (!message || typeof message !== 'object' || !('type' in message) ||
            message.type !== 'update.control.result' || !('id' in message) || message.id !== id) return;
        const parsed = adminUpdateStatusSchema.safeParse('status' in message ? message.status : undefined);
        if (parsed.success) finish(undefined, parsed.data);
        else finish(unavailable());
      };
      const timer = setTimeout(() => finish(unavailable()), 3000);
      this.ipc.on('message', listener);
      try {
        this.ipc.send!({ type: 'update.control', id, action, requestId, statusVersion: 2 }, error => {
          if (error) finish(unavailable());
        });
      } catch { finish(unavailable()); }
    });
  }
}
