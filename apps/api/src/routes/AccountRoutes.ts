import { routeContext } from './context.js';
import { type FastifyInstance } from 'fastify';
import { loginInputSchema } from '@boardgame/protocol';
import { type Database } from '../db/index.js';
import { AuthService } from '../auth.js';
import { registerRegistrationRoutes } from '../registration-routes.js';
import { ProfileService } from '../profiles.js';
import { profileInputSchema, matchHistoryQuerySchema } from '@boardgame/protocol';
import { ModelProfileService } from '../model-profiles.js';
export function registerAccountRoutes(
  app: FastifyInstance,
  {
    auth,
    models,
    db,
  }: {
    auth: AuthService;
    models: ModelProfileService;
    db: Database;
  },
) {
  const { ok, requireAuth, protectedWrite } = routeContext(auth);
  const loginSchema = loginInputSchema;
  registerRegistrationRoutes(app, auth);
  app.post('/api/v1/auth/login', async (request, reply) => {
    auth.assertOrigin(request);
    const body = loginSchema.parse(request.body);
    const previous = await auth.authenticate(request, true);
    const result = await auth.login(body.username, body.password, request.ip);
    await auth.logout(previous);
    auth.setCookie(reply, result.token, result.csrfToken);
    return ok(request, {
      account: result.account,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });
  app.get('/api/v1/auth/me', async (request) => {
    const current = await requireAuth(request);
    return ok(request, {
      account: current!.account,
      csrfToken: auth.csrfFor(request, current!),
      expiresAt: current!.expiresAt.toISOString(),
    });
  });
  const profiles = new ProfileService(db);
  app.get('/api/v1/profile', async (request) => {
    const current = await requireAuth(request);
    return ok(request, await profiles.get(current!.account.id));
  });
  app.put('/api/v1/profile', async (request) => {
    const current = await protectedWrite(request);
    return ok(
      request,
      await profiles.save(current.account.id, profileInputSchema.parse(request.body)),
    );
  });
  app.get('/api/v1/profile/matches', async (request) => {
    const current = await requireAuth(request);
    const query = matchHistoryQuerySchema.parse(request.query);
    return ok(request, await profiles.history(current!.account.id, query.before));
  });
  app.get('/api/v1/me/model-settings', async (request) => {
    await requireAuth(request);
    return ok(request, models.settingsStatus());
  });
  app.patch('/api/v1/me/model-profiles/:id', async (request) => {
    const current = await protectedWrite(request);
    const { id } = request.params as {
      id: string;
    };
    return ok(request, await models.save(current.account.id, request.body, id));
  });
  app.delete('/api/v1/me/model-profiles/:id', async (request) => {
    const current = await protectedWrite(request);
    const { id } = request.params as {
      id: string;
    };
    return ok(request, await models.remove(current.account.id, id));
  });
  app.get('/api/v1/model-endpoints', async (request) => {
    await requireAuth(request);
    return ok(request, await models.endpoints());
  });
  app.get('/api/v1/me/model-profiles', async (request) => {
    const current = await requireAuth(request);
    return ok(request, await models.list(current!.account.id));
  });
  app.post('/api/v1/me/model-profiles', async (request) => {
    const current = await protectedWrite(request);
    return ok(request, await models.save(current.account.id, request.body));
  });
  app.post('/api/v1/me/model-profiles/:id/test', async (request) => {
    const current = await protectedWrite(request);
    return ok(
      request,
      await models.test(
        current.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
      ),
    );
  });
  app.put('/api/v1/me/model-profiles/:id/credential', async (request) => {
    const current = await protectedWrite(request);
    return ok(
      request,
      await models.replaceCredential(
        current.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
        request.body,
      ),
    );
  });
  app.delete('/api/v1/me/model-profiles/:id/credential', async (request) => {
    const current = await protectedWrite(request);
    return ok(
      request,
      await models.revokeCredential(
        current.account.id,
        (
          request.params as {
            id: string;
          }
        ).id,
      ),
    );
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    auth.assertOrigin(request);
    const current = await auth.authenticate(request, true);
    if (current) auth.assertCsrf(request, current);
    await auth.logout(current);
    auth.clearCookie(reply);
    return ok(request, { loggedOut: true });
  });
}
