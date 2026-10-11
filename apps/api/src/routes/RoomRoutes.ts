import { routeContext } from './context.js';
import { type FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { AuthService } from '../auth.js';
import { RoomService } from '../rooms.js';
import { AiScheduler } from '../ai-scheduler.js';
export function registerRoomRoutes(
  app: FastifyInstance,
  {
    auth,
    rooms,
    scheduler,
  }: {
    auth: AuthService;
    rooms: RoomService;
    scheduler: AiScheduler;
  },
) {
  const joinAttempts = new Map<string, number[]>();
  const { ok, requireAuth, protectedWrite } = routeContext(auth);
  app.get('/api/v1/rooms', async (request) => {
    const a = await requireAuth(request);
    return ok(request, await rooms.list(a!.account.id, request.query));
  });
  app.post('/api/v1/rooms', async (request) => {
    const a = await protectedWrite(request);
    return ok(request, await rooms.create(a.account.id, request.body));
  });
  const joinRoom = async (request: Parameters<typeof protectedWrite>[0], publicRoomId?: string) => {
    const a = await protectedWrite(request),
      now = Date.now();
    for (const [key, max] of [
      [`account:${a.account.id}`, 10],
      [`ip:${request.ip}`, 30],
    ] as const) {
      const recent = (joinAttempts.get(key) ?? []).filter((at) => now - at < 60000);
      if (recent.length >= max)
        throw new AppError('RATE_LIMITED', 'Too many join attempts; retry later', 429, true);
      recent.push(now);
      joinAttempts.set(key, recent);
    }
    return ok(request, await rooms.join(a.account.id, request.body, publicRoomId));
  };
  app.get('/api/v1/rooms/lobby', async (request) => {
    const a = await requireAuth(request);
    return ok(request, await rooms.lobby(a!.account.id, request.query));
  });
  app.post('/api/v1/rooms/join', async (request) => joinRoom(request));
  app.post('/api/v1/rooms/:id/join', async (request) =>
    joinRoom(
      request,
      (
        request.params as {
          id: string;
        }
      ).id,
    ),
  );
  app.get('/api/v1/rooms/:id', async (request) => {
    const a = await requireAuth(request);
    const roomId = (
      request.params as {
        id: string;
      }
    ).id;
    const snapshot = await rooms.snapshot(roomId, a!.account.id);
    await rooms.recordActivity(roomId, a!.account.id);
    return ok(request, snapshot);
  });
  app.patch('/api/v1/rooms/:id/config', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.configRoom(
        a.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
        request.body,
      ),
    );
  });
  app.put('/api/v1/rooms/:id/assets', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.selectAssets(
        a.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
        request.body,
      ),
    );
  });
  app.post('/api/v1/rooms/:id/invite', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.rotateInvite(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.put('/api/v1/rooms/:id/my-seat', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.seat(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.delete('/api/v1/rooms/:id/my-seat', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.unseat(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.put('/api/v1/rooms/:id/my-ready', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.ready(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.post('/api/v1/rooms/:id/leave', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.leave(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.post('/api/v1/rooms/:id/host', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.transfer(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
  app.post('/api/v1/rooms/:id/start', async (request) => {
    const a = await protectedWrite(request);
    const result = await rooms.start(
      a.account.id,
      (request.params as { id: string }).id,
      request.body,
    );
    scheduler.wake(result.matchId);
    return ok(request, result);
  });
  app.put('/api/v1/rooms/:id/seats/:seatId/bot', async (request) => {
    const a = await protectedWrite(request);
    const p = request.params as {
      id: string;
      seatId: string;
    };
    return ok(request, await rooms.addBot(a.account.id, p.id, p.seatId, request.body));
  });
  app.patch('/api/v1/rooms/:id/seats/:seatId/bot', async (request) => {
    const current = await protectedWrite(request);
    const params = request.params as {
      id: string;
      seatId: string;
    };
    return ok(
      request,
      await rooms.configureBot(current.account.id, params.id, params.seatId, request.body),
    );
  });
  app.delete('/api/v1/rooms/:id/seats/:seatId/bot', async (request) => {
    const a = await protectedWrite(request);
    const p = request.params as {
      id: string;
      seatId: string;
    };
    return ok(request, await rooms.removeBot(a.account.id, p.id, p.seatId, request.body));
  });
  app.post('/api/v1/rooms/:id/close', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await rooms.closeRoom(a.account.id, (request.params as { id: string }).id, request.body),
    );
  });
}
