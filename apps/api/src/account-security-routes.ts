import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import type { AccountSecurityService } from './account-security.js';
import { routeContext } from './routes/context.js';
import { AppError } from './errors.js';

export function registerAccountSecurityRoutes(
  app: FastifyInstance,
  auth: AuthService,
  security: AccountSecurityService,
) {
  const { ok, requireAuth, protectedWrite } = routeContext(auth);
  const attempts = new Map<string, { count: number; expires: number }>();
  const options = {
    bodyLimit: 4096,
    onRequest: async (request: FastifyRequest) => {
      auth.assertOrigin(request);
      const current = request.routeOptions.url?.includes('/recovery')
        ? null
        : await protectedWrite(request);
      const now = Date.now();
      for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
      // One budget across sensitive endpoints; an authenticated account cannot evade it with new IPs.
      const key = current ? `account:${current.account.id}` : `ip:${request.ip}`;
      const bucket = attempts.get(key);
      if ((!bucket && attempts.size >= 2048) || (bucket && bucket.count >= 10))
        throw new AppError('RATE_LIMITED', '安全操作过于频繁，请一分钟后重试', 429, true);
      attempts.set(
        key,
        bucket ? { ...bucket, count: bucket.count + 1 } : { count: 1, expires: now + 60_000 },
      );
    },
  };
  app.get('/api/v1/account/security', async (request) =>
    ok(request, await security.status((await requireAuth(request))!)),
  );
  app.post('/api/v1/account/security/email-code', options, async (request) =>
    ok(request, await security.requestBinding(await protectedWrite(request), request.body)),
  );
  app.put('/api/v1/account/security/email', options, async (request, reply) => {
    const result = await security.bindEmail(await protectedWrite(request), request.body);
    auth.clearCookie(reply);
    return ok(request, result);
  });
  app.put('/api/v1/account/security/password', options, async (request, reply) => {
    const result = await security.changePassword(await protectedWrite(request), request.body);
    auth.clearCookie(reply);
    return ok(request, result);
  });
  app.post('/api/v1/account/security/revoke-others', options, async (request) =>
    ok(request, await security.revokeOthers(await protectedWrite(request), request.body)),
  );
  app.post('/api/v1/auth/recovery/email-code', options, async (request) =>
    ok(request, await security.requestRecovery(request.body)),
  );
  app.post('/api/v1/auth/recovery', options, async (request) =>
    ok(request, await security.recoverPassword(request.body)),
  );
}
