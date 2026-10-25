import { registerMatchRoutes } from './routes/MatchRoutes.js';
import { registerRoomRoutes } from './routes/RoomRoutes.js';
import { registerAccountRoutes } from './routes/AccountRoutes.js';
import { registerRealtime } from './realtime/index.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { createLabMatchSchema, labActionSchema, type ErrorCode } from '@boardgame/protocol';
import { normalizeConfig, type ApiConfigInput } from './config.js';
import { databaseStatus, listInstalledGames, type Database } from './db/index.js';
import { type GameRegistry } from './registry/index.js';
import { LabRunner, RunnerError } from './runtime/runner.js';
import { AppError } from './errors.js';
import { AuthService } from './auth.js';
import type { RegistrationMailer } from './registration-email.js';
import { RoomService } from './rooms.js';
import { MatchService } from './matches.js';
import { AiScheduler } from './ai-scheduler.js';
import { ModelProfileService } from './model-profiles.js';
import { OfficialAiService } from './official-ai/service.js';
import { registerOfficialAiRoutes } from './official-ai/routes.js';
import { AssetService } from './assets/service.js';
import { LocalAssetStorage } from './assets/storage.js';
import { registerAssetRoutes } from './assets/routes.js';
import { GamePresentationService } from './catalog/presentations.js';
import { registerGamePresentationRoutes } from './catalog/routes.js';
import { GameSubmissionService } from './catalog/submissions.js';
import { registerGameSubmissionRoutes } from './catalog/submission-routes.js';
import { fileURLToPath } from 'node:url';
import { AdminService } from './admin/service.js';
import { registerAdminRoutes } from './admin/routes.js';
import { SocialService } from './social/service.js';
import { registerSocialRoutes } from './social/routes.js';
import { GamePackageService } from './catalog/package-service.js';
import { registerGamePackageRoutes } from './catalog/package-routes.js';
export type AppDeps = {
  config: ApiConfigInput;
  db: Database;
  registry: GameRegistry;
  runner?: LabRunner;
  registrationMailer?: RegistrationMailer;
  testMatchFaults?: {
    beforeCommit?: () => void;
    afterCommit?: () => void;
  };
};
const statusFor: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  GAME_NOT_FOUND: 404,
  MATCH_NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  INVITE_UNAVAILABLE: 404,
  AUTH_INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  STATE_CONFLICT: 409,
  CONTROLLER_CONFLICT: 409,
  CONTROLLER_NOT_HUMAN: 409,
  AI_TASK_STALE: 409,
  AI_BLOCKED: 409,
  ROOM_CONFIG_CHANGED: 409,
  REQUEST_ID_CONFLICT: 409,
  ROOM_FULL: 409,
  ROOM_NOT_WAITING: 409,
  SEAT_OCCUPIED: 409,
  NOT_SEATED: 409,
  NOT_ALL_READY: 409,
  ROOM_ALREADY_STARTED: 409,
  ACTION_NOT_ALLOWED: 422,
  AI_POLICY_UNAVAILABLE: 422,
  AI_NOT_SUPPORTED: 422,
  AI_INVALID_OUTPUT: 422,
  AI_PROVIDER_FAILED: 503,
  AI_TIMEOUT: 503,
  GAME_SETUP_FAILED: 422,
  GAME_VERSION_UNAVAILABLE: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};
function databaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? error.code : undefined;
  if (
    typeof code === 'string' &&
    (code.startsWith('08') ||
      ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03'].includes(code))
  )
    return true;
  const message = error instanceof Error ? error.message : '';
  return /timeout exceeded when trying to connect|connection terminated unexpectedly|connection terminated due to connection timeout/i.test(
    message,
  );
}
export async function createApp(deps: AppDeps): Promise<FastifyInstance> {
  const config = normalizeConfig(deps.config);
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
    bodyLimit: 16 * 1024,
    genReqId: () => randomUUID(),
  });
  const runner = deps.runner ?? new LabRunner(deps.registry);
  const auth = new AuthService(
    deps.db,
    config,
    config.NODE_ENV !== 'production' ? deps.registrationMailer : undefined,
  );
  const models = new ModelProfileService(deps.db, config.MODEL_CREDENTIALS_KEY);
  registerOfficialAiRoutes(app, auth, new OfficialAiService(deps.db, config.NODE_ENV === 'test'));
  const rooms = new RoomService(deps.db, deps.registry, config);
  const matches = new MatchService(
    deps.db,
    deps.registry,
    config.NODE_ENV === 'test' ? deps.testMatchFaults : undefined,
  );
  const scheduler = new AiScheduler(deps.db, deps.registry, matches, config);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(websocket, { options: { maxPayload: 8 * 1024 } });
  const assetRoot =
    process.env[config.NODE_ENV === 'test' ? 'TEST_ASSET_STORAGE_DIR' : 'ASSET_STORAGE_DIR'] ??
    fileURLToPath(
      new URL(
        config.NODE_ENV === 'test' ? '../../../.data/test-assets/' : '../../../.data/assets/',
        import.meta.url,
      ),
    );
  const assets = new AssetService(deps.db, deps.registry, new LocalAssetStorage(assetRoot));
  await registerAssetRoutes(app, auth, assets);
  registerGamePresentationRoutes(
    app,
    auth,
    new GamePresentationService(deps.db),
    config.NODE_ENV === 'production',
  );
  registerGameSubmissionRoutes(app, auth, new GameSubmissionService(deps.db));
  registerAdminRoutes(
    app,
    auth,
    new AdminService(deps.db, deps.registry, config.NODE_ENV === 'production'),
  );
  registerSocialRoutes(app, auth, new SocialService(deps.db, rooms));
  const packages = await GamePackageService.create(deps.db, deps.registry);
  registerGamePackageRoutes(app, auth, packages);
  app.addHook('onRequest', async (request) => {
    if (/^\/api\/v1\/(?:games|rooms|matches|admin|ws\/session)(?:\/|\?|$)/.test(request.url))
      await packages.refresh();
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      request.url.startsWith('/api/v1/game-submissions') ||
      request.url.startsWith('/api/v1/admin/') ||
      request.url.startsWith('/api/v1/social') ||
      request.url.startsWith('/api/v1/profile') ||
      request.url.startsWith('/api/v1/me/ai-points') ||
      request.url.startsWith('/api/v1/me/official-ai') ||
      request.url.startsWith('/api/v1/official-ai')
    ) {
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
    }
    return payload;
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      request.url.startsWith('/api/v1/me/model-') ||
      request.url.startsWith('/api/v1/model-endpoints') ||
      request.url.startsWith('/api/v1/auth') ||
      request.url.startsWith('/api/v1/rooms') ||
      request.url.startsWith('/api/v1/matches')
    )
      reply.header('cache-control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Unexpected server error';
    let status = 500;
    let retryable = false;
    const transportCode =
      error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (error instanceof ZodError) {
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      status = 400;
    } else if (transportCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      code = 'VALIDATION_ERROR';
      message = 'Request body is too large';
      status = 413;
    } else if (transportCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      code = 'VALIDATION_ERROR';
      message = 'Unsupported content type';
      status = 415;
    } else if (
      transportCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      transportCode === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      code = 'VALIDATION_ERROR';
      message = 'Invalid JSON body';
      status = 400;
    } else if (error instanceof AppError) {
      code = error.code;
      message = error.message;
      status = error.status;
      retryable = error.retryable;
    } else if (error instanceof RunnerError) {
      code = error.code;
      message = error.message;
      status = statusFor[code] ?? 500;
    } else if (databaseUnavailable(error)) {
      code = 'SERVICE_UNAVAILABLE';
      message = 'Database is temporarily unavailable';
      status = 503;
      retryable = true;
    } else
      request.log.error(
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'request failed',
      );
    if (code === 'RATE_LIMITED') reply.header('retry-after', '60');
    reply
      .status(status)
      .send({ ok: false, error: { code, message, retryable }, traceId: request.id });
  });
  const ok = <T>(request: FastifyRequest, data: T) => ({ ok: true, data, traceId: request.id });
  app.get('/health/live', async (request) => ok(request, { status: 'live' }));
  app.get('/health/ready', async (request, reply) => {
    const status = await databaseStatus(deps.db, deps.registry.manifests());
    if (!status.ready) reply.status(503);
    return ok(request, { status: status.ready ? 'ready' : 'not-ready', database: status });
  });
  app.get('/api/v1/games', async (request) => {
    const ready = await databaseStatus(deps.db, deps.registry.manifests());
    if (!ready.ready)
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Game catalog is unavailable until the database is ready',
        503,
        true,
      );
    const games = await listInstalledGames(deps.db, config.NODE_ENV === 'production');
    return ok(
      request,
      games.map((game) => ({
        ...game,
        supportsScriptAi: !!deps.registry.get(game.id, game.version)?.getDecisionContext,
      })),
    );
  });
  app.get('/api/v1/games/:id/versions/:version', async (request) => {
    const p = request.params as {
      id: string;
      version: string;
    };
    const all = await listInstalledGames(deps.db, config.NODE_ENV === 'production');
    const found = all.find((g) => g.id === p.id && g.version === p.version);
    if (!found) throw new AppError('GAME_NOT_FOUND', 'Game extension not found', 404);
    return ok(request, found);
  });
  app.get('/api/v1/games/:id/versions/:version/rules', async (request) => {
    const p = request.params as {
      id: string;
      version: string;
    };
    const rules = deps.registry.rules.get(`${p.id}@${p.version}`);
    if (!rules) throw new AppError('GAME_NOT_FOUND', '此版本规则不可用', 404);
    return ok(request, { gameId: p.id, version: p.version, rules });
  });
  app.get('/api/v1/games/:id/ai-policies', async (request) => {
    const id = (
      request.params as {
        id: string;
      }
    ).id;
    const supported = deps.registry
      .manifests()
      .some(
        (item) => item.id === id && !!deps.registry.get(item.id, item.version)?.getDecisionContext,
      );
    return ok(
      request,
      supported ? [{ id: 'basic-v1', version: '1.0.0', name: '基础脚本 AI' }] : [],
    );
  });
  registerAccountRoutes(app, { auth, models, db: deps.db });
  registerRoomRoutes(app, { auth, rooms, scheduler });
  registerMatchRoutes(app, { auth, rooms, matches, scheduler });
  const closeRealtime = registerRealtime(app, auth, rooms, matches, scheduler, config);
  if (config.NODE_ENV === 'development' && config.ENABLE_DEV_LAB) {
    app.post('/api/v1/dev/lab/matches', async (request) => {
      const body = createLabMatchSchema.parse(request.body);
      return ok(request, runner.create(body.gameId, body.version, body.options));
    });
    app.get('/api/v1/dev/lab/matches/:id/view', async (request) => {
      const p = request.params as {
        id: string;
      };
      const q = request.query as {
        seat?: string;
      };
      if (!q.seat) throw new ZodError([]);
      return ok(request, runner.view(p.id, q.seat));
    });
    app.post('/api/v1/dev/lab/matches/:id/actions', async (request) => {
      const p = request.params as {
        id: string;
      };
      const body = labActionSchema.parse(request.body);
      return ok(request, runner.act(p.id, body.testSeatId, body.expectedRevision, body.action));
    });
    app.delete('/api/v1/dev/lab/matches/:id', async (request, reply) => {
      runner.delete(
        (
          request.params as {
            id: string;
          }
        ).id,
      );
      return reply.status(204).send();
    });
  }
  await auth
    .listenForRevocations()
    .catch((error) =>
      app.log.warn(
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'revocation notifications unavailable; session polling remains active',
      ),
    );
  scheduler.start();
  let idleSweep: Promise<unknown> | undefined;
  const idleTimer = setInterval(() => {
    if (idleSweep) return;
    idleSweep = rooms
      .closeIdleRooms()
      .catch(() => app.log.error('idle room cleanup failed'))
      .finally(() => {
        idleSweep = undefined;
      });
  }, 60000);
  idleTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(idleTimer);
    await idleSweep;
    await scheduler.close();
    await closeRealtime();
    auth.close();
    runner.close();
    await deps.db.end();
  });
  return app;
}
