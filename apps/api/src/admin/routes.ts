import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  adminAccountQuerySchema,
  adminAccountCommandSchema,
  adminGameCommandSchema,
  adminUpdateCommandSchema,
  badgeGrantInputSchema,
  coinAdjustmentSchema,
  coinHistoryQuerySchema,
  badgeDefinitionInputSchema,
} from '@boardgame/protocol';
import type { AuthService } from '../auth.js';
import { AppError } from '../errors.js';
import type { AdminService } from './service.js';
import { UpdateControl } from './update-control.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: AdminService,
  updates: UpdateControl = new UpdateControl(),
) {
  const administrator = async (request: FastifyRequest, write = false) => {
    if (write) auth.assertOrigin(request);
    const current = await auth.authenticate(request);
    if (!current) throw new AppError('UNAUTHENTICATED', '请先登录', 401);
    if (write) auth.assertCsrf(request, current);
    if (current.account.role !== 'administrator')
      throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    return current;
  };
  const ok = (request: FastifyRequest, data: unknown) => ({
    ok: true,
    data,
    traceId: request.id,
  });
  app.get('/api/v1/admin/accounts/:id/coins', async (request) => {
    await administrator(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = coinHistoryQuerySchema.parse(request.query);
    return ok(request, await service.coins(id, query.before));
  });
  app.post('/api/v1/admin/accounts/:id/coins', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(
      request,
      await service.adjustCoins(current, id, coinAdjustmentSchema.parse(request.body)),
    );
  });
  app.get('/api/v1/admin/updates', async (request) => {
    await administrator(request);
    return ok(request, await updates.request('status'));
  });
  app.post('/api/v1/admin/updates/check', async (request, reply) => {
    const current = await administrator(request, true);
    const input = adminUpdateCommandSchema.parse(request.body);
    const status = await updates.request('check', `${current.account.id}:${input.requestId}`);
    reply.code(202);
    return ok(request, status);
  });
  app.get('/api/v1/admin/overview', async (request) => {
    await administrator(request);
    return ok(request, await service.overview());
  });
  app.get('/api/v1/admin/badges', async (request) => {
    await administrator(request);
    return ok(request, await service.badgeDefinitions());
  });
  app.put('/api/v1/admin/badges', async (request) => {
    const current = await administrator(request, true);
    return ok(
      request,
      await service.saveBadgeDefinition(current, badgeDefinitionInputSchema.parse(request.body)),
    );
  });
  app.get('/api/v1/admin/accounts/:id/badges', async (request) => {
    await administrator(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(request, await service.badges(id));
  });
  app.put('/api/v1/admin/accounts/:id/badges', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(
      request,
      await service.setBadge(current, id, badgeGrantInputSchema.parse(request.body)),
    );
  });
  app.get('/api/v1/admin/accounts', async (request) => {
    await administrator(request);
    const query = adminAccountQuerySchema.parse(request.query);
    return ok(request, await service.accounts(query.search, query.before));
  });
  app.put('/api/v1/admin/accounts/:id/status', async (request) => {
    const current = await administrator(request, true);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return ok(
      request,
      await service.setAccount(current, id, adminAccountCommandSchema.parse(request.body)),
    );
  });
  app.get('/api/v1/admin/games', async (request) => {
    await administrator(request);
    return ok(request, await service.games());
  });
  app.put('/api/v1/admin/games/:id/versions/:version/status', async (request) => {
    const current = await administrator(request, true);
    const params = z
      .object({
        id: z.string().min(1).max(128),
        version: z.string().min(1).max(32),
      })
      .parse(request.params);
    return ok(
      request,
      await service.setGame(
        current,
        params.id,
        params.version,
        adminGameCommandSchema.parse(request.body),
      ),
    );
  });
}
