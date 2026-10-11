import type { FastifyRequest } from 'fastify';
import type { AuthService } from '../auth.js';

export function routeContext(auth: AuthService) {
  return {
    ok: <T>(request: FastifyRequest, data: T) => ({ ok: true as const, data, traceId: request.id }),
    requireAuth: (request: FastifyRequest) => auth.authenticate(request),
    protectedWrite: async (request: FastifyRequest) => {
      auth.assertOrigin(request);
      const current = await auth.authenticate(request);
      auth.assertCsrf(request, current!);
      return current!;
    },
  };
}
