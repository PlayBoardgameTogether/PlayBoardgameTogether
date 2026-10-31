import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth.js';
import { AppError } from './errors.js';

export function registerRegistrationRoutes(app: FastifyInstance, auth: AuthService) {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  const options = {
    bodyLimit: 4 * 1024,
    onRequest: async (request: import('fastify').FastifyRequest) => {
      auth.assertOrigin(request);
      const now = Date.now();
      for (const [key, bucket] of attempts) if (bucket.expiresAt <= now) attempts.delete(key);
      const key = `${request.routeOptions.url}:${request.ip}`;
      const bucket = attempts.get(key);
      if ((!bucket && attempts.size >= 1024) || (bucket && bucket.count >= 5)) {
        throw new AppError('RATE_LIMITED', '注册尝试过于频繁，请一分钟后重试', 429, true);
      }
      attempts.set(
        key,
        bucket ? { ...bucket, count: bucket.count + 1 } : { count: 1, expiresAt: now + 60_000 },
      );
      if (
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
      ) {
        throw new AppError('VALIDATION_ERROR', '注册接口只接受 JSON', 415);
      }
    },
  };
  app.post('/api/v1/auth/register/email-code', options, async (request) => {
    const result = await auth.registrationEmail.request(request.body);
    return { ok: true, data: result, traceId: request.id };
  });
  app.post('/api/v1/auth/register', options, async (request, reply) => {
    const result = await auth.register(request.body);
    reply.status(201);
    return { ok: true, data: result, traceId: request.id };
  });
}
