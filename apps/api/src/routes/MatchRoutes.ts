import { routeContext } from './context.js';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { matchReplayQuerySchema, matchReplaySchema } from '@boardgame/protocol';
import { AppError } from '../errors.js';
import { AuthService } from '../auth.js';
import { RoomService } from '../rooms.js';
import { MatchService } from '../matches.js';
import { AiScheduler } from '../ai-scheduler.js';
export function registerMatchRoutes(
  app: FastifyInstance,
  {
    auth,
    rooms,
    matches,
    scheduler,
  }: {
    auth: AuthService;
    rooms: RoomService;
    matches: MatchService;
    scheduler: AiScheduler;
  },
) {
  const { ok, requireAuth, protectedWrite } = routeContext(auth);
  app.get('/api/v1/matches/:id/replay', async (request) => {
    const account = await requireAuth(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = matchReplayQuerySchema.parse(request.query);
    return ok(
      request,
      matchReplaySchema.parse(await matches.replay(account!.account.id, id, query.revision)),
    );
  });
  app.get('/api/v1/matches/:id/view', async (request) => {
    const a = await requireAuth(request);
    const snapshot = await matches.view(
      a!.account.id,
      (
        request.params as {
          id: string;
        }
      ).id,
    );
    if (snapshot.status === 'active') await rooms.recordActivity(snapshot.roomId, a!.account.id);
    return ok(request, snapshot);
  });
  app.get('/api/v1/matches/:id/commands/:requestId', async (request) => {
    const a = await requireAuth(request);
    const p = request.params as {
      id: string;
      requestId: string;
    };
    if (p.requestId.length < 1 || p.requestId.length > 128)
      throw new AppError('VALIDATION_ERROR', 'Invalid requestId', 400);
    return ok(request, await matches.commandReceipt(a!.account.id, p.id, p.requestId));
  });
  app.post('/api/v1/matches/:id/actions', async (request) => {
    const a = await protectedWrite(request);
    return ok(
      request,
      await matches.act(
        a.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
        request.body,
        a.sessionId,
      ),
    );
  });
  app.put('/api/v1/matches/:id/my-controller', async (request) => {
    const a = await protectedWrite(request);
    const id = (
      request.params as {
        id: string;
      }
    ).id;
    const result = await matches.setMyController(a.account.id, id, request.body);
    scheduler.wake(id);
    return ok(request, result);
  });
  app.post('/api/v1/matches/:id/seats/:seatId/ai-retry', async (request) => {
    const a = await protectedWrite(request);
    const p = request.params as {
      id: string;
      seatId: string;
    };
    const result = await matches.retryAi(a.account.id, p.id, p.seatId);
    scheduler.wake(p.id);
    return ok(request, result);
  });
}
