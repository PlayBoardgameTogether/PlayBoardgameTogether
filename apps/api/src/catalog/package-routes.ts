import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { gamePackageRequestSchema } from '@boardgame/protocol';
import type { AuthService } from '../auth.js';
import { AppError } from '../errors.js';
import { GamePackageService, packageVersionParams } from './package-service.js';
import { replayDesktop } from './replay-desktop.js';

export function registerGamePackageRoutes(app: FastifyInstance, auth: AuthService, packages: GamePackageService) {
  const path = '/api/v1/admin/game-packages';
  const attempts = new Map<string, { count: number; expires: number }>();
  app.addHook('onRequest', async request => {
    if (![path, `${path}/review`].includes(request.url.split('?')[0]!) || request.method !== 'POST') return;
    auth.assertOrigin(request);
    const current = await auth.authenticate(request);
    if (!current || current.account.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    auth.assertCsrf(request, current);
    const now = Date.now();
    for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
    const entry = attempts.get(current.account.id);
    if ((!entry && attempts.size >= 1024) || (entry && entry.count >= 20)) throw new AppError('RATE_LIMITED', '游戏上传过于频繁，请一分钟后重试', 429, true);
    attempts.set(current.account.id, entry ? { ...entry, count: entry.count + 1 } : { count: 1, expires: now + 60000 });
  });
  app.addContentTypeParser('application/zip', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  app.post(path, { bodyLimit: 5 * 1024 * 1024 }, async request => {
    const current = await auth.authenticate(request);
    if (!current || current.account.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    auth.assertCsrf(request, current);
    const { requestId, expectedCatalogHash } = gamePackageRequestSchema.parse(request.query);
    if (!Buffer.isBuffer(request.body) || request.headers['content-type']?.split(';')[0] !== 'application/zip') throw new AppError('VALIDATION_ERROR', '请选择 ZIP 游戏包', 415);
    return { ok: true, data: await packages.install(current, requestId, request.body, expectedCatalogHash), traceId: request.id };
  });
  app.post(`${path}/review`, { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const current = await auth.authenticate(request);
    if (!current || current.account.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
    auth.assertCsrf(request, current);
    if (!Buffer.isBuffer(request.body) || request.headers['content-type']?.split(';')[0] !== 'application/zip') {
      throw new AppError('VALIDATION_ERROR', '请选择 ZIP 游戏包', 415);
    }
    reply.header('cache-control', 'no-store');
    return { ok: true, data: await packages.review(request.body), traceId: request.id };
  });
  app.get('/api/v1/game-packages/example.zip', async (_request, reply) => {
    const base = new URL('../../game-package-example/', import.meta.url);
    const [descriptor, server, client] = await Promise.all([
      readFile(new URL('game.json', base)), readFile(new URL('server.txt', base)), readFile(new URL('client.html', base)),
    ]);
    return reply.type('application/zip').header('content-disposition', 'attachment; filename="score-race.zip"')
      .header('x-content-type-options', 'nosniff').send(Buffer.from(zipSync({ 'game.json': descriptor, 'server.js': server, 'client.html': client }, { mtime: new Date(2026, 0, 1) })));
  });
  app.get('/api/v1/game-packages/:id/versions/:version/art/:kind', async (request, reply) => {
    const params = packageVersionParams.extend({
      kind: z.enum(['icon.png', 'cover.png', 'background.png']),
    }).parse(request.params);
    const { id, version } = params;
    const kind = params.kind.slice(0, -4);
    const bytes = await packages.artwork(id, version, kind);
    return reply.type('image/png').header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "sandbox; default-src 'none'").send(bytes);
  });
  app.get('/api/v1/game-packages/:id/versions/:version/desktop', async (request, reply) => {
    const { id, version } = packageVersionParams.parse(request.params);
    const query = z.object({ replay: z.literal('1').optional() }).parse(request.query);
    // Safe even outside the platform iframe: response CSP also forces an opaque sandbox origin.
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'");
    const html = await packages.desktop(id, version);
    return reply.send(query.replay ? replayDesktop(html) : html);
  });
}
