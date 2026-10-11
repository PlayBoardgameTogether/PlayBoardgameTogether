import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  friendIdInputValueSchema, friendIdInputSchema, friendRequestInputSchema, friendshipCommandSchema,
  messageInputSchema, socialPageQuerySchema, readMessagesInputSchema,
  friendInviteInputSchema, friendInviteCommandSchema, socialSettingsInputSchema, socialUpdatesQuerySchema,
} from '@boardgame/protocol';
import type { AuthService } from '../auth.js';
import { AppError } from '../errors.js';
import type { SocialService } from './service.js';

export function registerSocialRoutes(app: FastifyInstance, auth: AuthService, service: SocialService) {
  const current = async (request: FastifyRequest, write = false) => {
    if (write) auth.assertOrigin(request);
    const context = await auth.authenticate(request);
    if (!context) throw new AppError('UNAUTHENTICATED', '请先登录', 401);
    if (write) auth.assertCsrf(request, context);
    return context;
  };
  const peer = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).strict().parse(request.params).id;
  const ok = (request: FastifyRequest, data: unknown) => ({ ok: true, data, traceId: request.id });
  const searches = new Map<string, { since: number; count: number }>();
  const administrator = async (request: FastifyRequest, write = false) => {
    const context = await current(request, write);
    if (context.account.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    return context;
  };
  app.get('/api/v1/admin/social-settings', async request => ok(request, await service.settings(await administrator(request))));
  app.put('/api/v1/admin/social-settings', async request => ok(request, await service.setSettings(await administrator(request, true), socialSettingsInputSchema.parse(request.body))));
  app.get('/api/v1/social', async request => ok(request, await service.overview(await current(request))));
  app.get('/api/v1/social/updates', async request => {
    const context = await current(request);
    const { version } = socialUpdatesQuerySchema.parse(request.query);
    return ok(request, await service.updates(context, version));
  });
  app.get('/api/v1/social/public/messages', async request => {
    const context = await current(request);
    const query = socialPageQuerySchema.parse(request.query);
    return ok(request, await service.publicMessages(context, query.before, query.after));
  });
  app.post('/api/v1/social/public/messages', async request =>
    ok(request, await service.sendPublicMessage(await current(request, true), messageInputSchema.parse(request.body))));
  app.get('/api/v1/social/search', async request => {
    const context = await current(request);
    const now = Date.now();
    const previous = searches.get(context.account.id);
    const window = previous && now - previous.since < 60_000 ? previous : { since: now, count: 0 };
    if (window.count >= 60) throw new AppError('RATE_LIMITED', '搜索过于频繁，请稍后重试', 429);
    window.count++;
    if (searches.size >= 10000) searches.delete(searches.keys().next().value!);
    searches.set(context.account.id, window);
    const query = z.object({ friendId: friendIdInputValueSchema }).strict().parse(request.query);
    return ok(request, await service.lookup(context, query.friendId));
  });
  app.put('/api/v1/social/id', async request => ok(request, await service.changeId(await current(request, true), friendIdInputSchema.parse(request.body))));
  app.post('/api/v1/social/requests', async request => ok(request, await service.requestFriend(await current(request, true), friendRequestInputSchema.parse(request.body))));
  app.post('/api/v1/social/friends/:id', async request => ok(request, await service.updateFriend(await current(request, true), peer(request), friendshipCommandSchema.parse(request.body))));
  app.get('/api/v1/social/friends/:id/messages', async request => {
    const context = await current(request);
    const query = socialPageQuerySchema.parse(request.query);
    return ok(request, await service.messages(context, peer(request), query.before, query.after));
  });
  app.post('/api/v1/social/friends/:id/messages', async request => ok(request, await service.sendMessage(await current(request, true), peer(request), messageInputSchema.parse(request.body))));
  app.post('/api/v1/social/friends/:id/read', async request => ok(request, await service.markRead(await current(request, true), peer(request), readMessagesInputSchema.parse(request.body))));
  app.post('/api/v1/rooms/:id/friend-invitations', async request => ok(request, await service.invite(await current(request, true), peer(request), friendInviteInputSchema.parse(request.body))));
  app.post('/api/v1/social/invitations/:id', async request => ok(request, await service.respondInvite(await current(request, true), peer(request), friendInviteCommandSchema.parse(request.body))));
}
