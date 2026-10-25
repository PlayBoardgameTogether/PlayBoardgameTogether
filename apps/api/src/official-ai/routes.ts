import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { aiPointLedgerQuerySchema } from '@boardgame/protocol';
import type { AuthService } from '../auth.js';
import { routeContext } from '../routes/context.js';
import { AppError } from '../errors.js';
import type { OfficialAiService } from './service.js';

export function registerOfficialAiRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: OfficialAiService,
) {
  const { ok, requireAuth, protectedWrite } = routeContext(auth);
  const administrator = async (request: FastifyRequest, write = false) => {
    const current = write ? await protectedWrite(request) : await requireAuth(request);
    if (current!.account.role !== 'administrator')
      throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    return current!;
  };
  app.get('/api/v1/official-ai/offers', async (request) => {
    await requireAuth(request);
    return ok(request, await service.offers());
  });
  app.get('/api/v1/me/official-ai/profiles', async (request) => {
    const current = await requireAuth(request);
    return ok(request, await service.profiles(current!.account.id));
  });
  app.post('/api/v1/me/official-ai/enroll', async (request) =>
    ok(request, await service.enroll(await protectedWrite(request), request.body)),
  );
  app.get('/api/v1/me/ai-points', async (request) => {
    const current = await requireAuth(request);
    return ok(request, await service.wallet(current!.account.id));
  });
  app.get('/api/v1/me/ai-points/ledger', async (request) => {
    const current = await requireAuth(request);
    const query = aiPointLedgerQuerySchema.parse(request.query);
    return ok(request, await service.ledger(current!.account.id, query.before));
  });
  app.get('/api/v1/admin/official-ai/offers', async (request) => {
    await administrator(request);
    return ok(request, await service.offers(true));
  });
  app.post('/api/v1/admin/official-ai/offers', async (request) =>
    ok(request, await service.publish(await administrator(request, true), request.body)),
  );
  app.put('/api/v1/admin/official-ai/offers/:id', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(request, await service.setStatus(current, id, request.body));
  });
  app.post('/api/v1/admin/ai-points/grant', async (request) =>
    ok(request, await service.grant(await administrator(request, true), request.body)),
  );
  app.patch('/api/v1/admin/official-ai/offers/:id', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(request, await service.edit(current, id, request.body));
  });
  app.delete('/api/v1/admin/official-ai/offers/:id', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(request, await service.delete(current, id, request.body));
  });
  app.get('/api/v1/admin/official-ai/stats', async (request) => {
    await administrator(request);
    return ok(request, await service.stats());
  });
}
