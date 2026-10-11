import type { FastifyInstance, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { z } from 'zod';
import { PROTOCOL_VERSION, pingMessageSchema } from '@boardgame/protocol';
import { AppError } from '../errors.js';
import type { AuthService, AuthContext } from '../auth.js';
import type { RoomService } from '../rooms.js';
import type { MatchService } from '../matches.js';
import type { AiScheduler } from '../ai-scheduler.js';
import type { ApiConfig } from '../config.js';
export function registerRealtime(
  app: FastifyInstance,
  auth: AuthService,
  rooms: RoomService,
  matches: MatchService,
  scheduler: AiScheduler,
  config: ApiConfig,
) {
  app.get(
    '/api/v1/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (request.headers.origin !== config.WEB_ORIGIN)
          return reply.status(403).send({
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'WebSocket origin is not allowed',
              retryable: false,
            },
            traceId: request.id,
          });
      },
    },
    (socket) => {
      let windowStarted = Date.now(),
        count = 0;
      let idle = setTimeout(() => socket.close(1000, 'idle'), 60000);
      socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'hello' }));
      socket.on('message', (raw: Buffer) => {
        clearTimeout(idle);
        idle = setTimeout(() => socket.close(1000, 'idle'), 60000);
        if (Date.now() - windowStarted >= 1000) {
          windowStarted = Date.now();
          count = 0;
        }
        if (++count > 5) {
          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: 'error',
              code: 'RATE_LIMITED',
            }),
          );
          return;
        }
        try {
          const ping = pingMessageSchema.parse(JSON.parse(raw.toString()));
          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: 'pong',
              requestId: ping.requestId,
            }),
          );
        } catch {
          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: 'error',
              code: 'VALIDATION_ERROR',
            }),
          );
        }
      });
      socket.on('close', () => clearTimeout(idle));
    },
  );
  const authenticated = new WeakMap<FastifyRequest, AuthContext>();
  type SessionConnection = {
    socket: WebSocket;
    request: FastifyRequest;
    accountId: string;
    sessionId: string;
    rooms: Set<string>;
  };
  const connections = new Set<SessionConnection>();
  const closeForFailure = (socket: WebSocket, error: unknown) => {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
      socket.close(4001, 'session revoked');
    else socket.close(1013, 'service temporarily unavailable');
  };
  const revokeOrRecover = (c: SessionConnection, roomId: string, error: unknown) => {
    if (
      error instanceof AppError &&
      ['ROOM_NOT_FOUND', 'MATCH_NOT_FOUND', 'FORBIDDEN'].includes(error.code)
    ) {
      c.rooms.delete(roomId);
      c.socket.send(
        JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'subscription.revoked', roomId }),
      );
    } else closeForFailure(c.socket, error);
  };
  let presenceSeq = 0;
  const offlineTimers = new Map<string, NodeJS.Timeout>();
  const presence = async (roomId: string) => {
    const eligible: SessionConnection[] = [];
    for (const c of connections) {
      if (!c.rooms.has(roomId) || c.socket.readyState !== 1) continue;
      try {
        const current = await auth.authenticate(c.request);
        if (current?.sessionId === c.sessionId) eligible.push(c);
        else c.socket.close(4001, 'session revoked');
      } catch (error) {
        closeForFailure(c.socket, error);
      }
    }
    const onlineAccountIds = [...new Set(eligible.map((c) => c.accountId))];
    const seq = ++presenceSeq;
    for (const c of eligible)
      c.socket.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: 'room.presence',
          roomId,
          presenceSeq: seq,
          onlineAccountIds,
        }),
      );
  };
  const markOnline = (roomId: string, accountId: string) => {
    const key = `${roomId}:${accountId}`;
    const timer = offlineTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      offlineTimers.delete(key);
    }
    void presence(roomId);
  };
  const markOffline = (roomId: string, accountId: string) => {
    const key = `${roomId}:${accountId}`;
    const timer = setTimeout(() => {
      offlineTimers.delete(key);
      void presence(roomId);
    }, config.PRESENCE_GRACE_MS);
    timer.unref();
    offlineTimers.set(key, timer);
  };
  const broadcast = async (roomId: string) => {
    for (const c of connections) {
      if (!c.rooms.has(roomId) || c.socket.readyState !== 1) continue;
      try {
        const current = await auth.authenticate(c.request);
        if (!current || current.sessionId !== c.sessionId) {
          c.socket.close(4001, 'session revoked');
          continue;
        }
        const snapshot = await rooms.snapshot(roomId, c.accountId);
        c.socket.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: 'room.snapshot',
            roomId,
            roomRevision: snapshot.roomRevision,
            snapshot,
          }),
        );
        if (snapshot.status === 'closed') {
          c.socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: 'room.closed',
              roomId,
              roomRevision: snapshot.roomRevision,
            }),
          );
          c.rooms.delete(roomId);
        }
      } catch (error) {
        revokeOrRecover(c, roomId, error);
      }
    }
  };
  const broadcastMatch = async (
    roomId: string,
    matchId: string,
    revision: number,
    events: unknown[],
  ) => {
    for (const c of connections) {
      if (!c.rooms.has(roomId) || c.socket.readyState !== 1) continue;
      try {
        const current = await auth.authenticate(c.request);
        if (!current || current.sessionId !== c.sessionId) {
          c.socket.close(4001, 'session revoked');
          continue;
        }
        await rooms.snapshot(roomId, c.accountId);
        const snapshot = await matches.liveView(c.accountId, matchId, revision, events);
        c.socket.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: 'match.snapshot',
            matchId,
            revision: snapshot.revision,
            snapshot,
          }),
        );
      } catch (error) {
        revokeOrRecover(c, roomId, error);
      }
    }
  };
  const unsubscribeRoom = rooms.onChanged((roomId) => void broadcast(roomId));
  const unsubscribeMatch = matches.onChanged((roomId, matchId, revision, events, roomChanged) => {
    void broadcastMatch(roomId, matchId, revision, events);
    if (roomChanged) void broadcast(roomId);
    scheduler.wake(matchId);
  });
  const unsubscribeRevoked = auth.onRevoked((accountId, sessionId) => {
    for (const c of connections)
      if (c.accountId === accountId && (!sessionId || c.sessionId === sessionId))
        c.socket.close(4001, 'session revoked');
  });
  app.get(
    '/api/v1/ws/session',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (request.headers.origin !== config.WEB_ORIGIN) return reply.status(403).send();
        try {
          const current = await auth.authenticate(request);
          if (current) authenticated.set(request, current);
        } catch (error) {
          const expired = error instanceof AppError && error.code === 'UNAUTHENTICATED';
          return reply
            .header('cache-control', 'no-store')
            .status(expired ? 401 : 503)
            .send();
        }
      },
    },
    (socket, request) => {
      const current = authenticated.get(request);
      if (!current) {
        socket.close(4001, 'session expired');
        return;
      }
      const connection: SessionConnection = {
        socket,
        request,
        accountId: current.account.id,
        sessionId: current.sessionId,
        rooms: new Set(),
      };
      connections.add(connection);
      socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'session.ready' }));
      let windowStarted = Date.now(),
        messages = 0;
      const expiry = setTimeout(
        () => socket.close(4001, 'session expired'),
        Math.max(0, current.expiresAt.getTime() - Date.now()),
      );
      expiry.unref();
      let lastPong = Date.now();
      socket.on('pong', () => {
        lastPong = Date.now();
      });
      const recheck = setInterval(() => {
        if (Date.now() - lastPong > 45000) {
          socket.terminate();
          return;
        }
        if (socket.readyState !== 1) return;
        socket.ping();
        void auth
          .authenticate(request)
          .then(async (latest) => {
            if (latest?.sessionId !== connection.sessionId) {
              socket.close(4001, 'session revoked');
              return;
            }
            if (socket.readyState !== 1) return;
            for (const roomId of connection.rooms)
              await rooms.recordActivity(roomId, connection.accountId);
          })
          .catch((error: unknown) => closeForFailure(socket, error));
      }, 5000);
      recheck.unref();
      socket.on('message', async (raw: Buffer) => {
        try {
          if (Date.now() - windowStarted >= 1000) {
            windowStarted = Date.now();
            messages = 0;
          }
          if (++messages > 10) throw new AppError('RATE_LIMITED', 'Too many messages', 429);
          const latest = await auth.authenticate(request);
          if (!latest || latest.sessionId !== connection.sessionId)
            throw new AppError('UNAUTHENTICATED', 'Session expired', 401);
          const msg = JSON.parse(raw.toString());
          if (msg?.protocolVersion !== PROTOCOL_VERSION)
            throw new AppError('VALIDATION_ERROR', 'Invalid protocol version', 400);
          if (msg.type === 'ping') {
            socket.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: 'pong',
                requestId: String(msg.requestId ?? ''),
              }),
            );
            return;
          }
          if (msg.type === 'room.unsubscribe') {
            const roomId = z.string().uuid().parse(msg.roomId);
            connection.rooms.delete(roomId);
            markOffline(roomId, connection.accountId);
            return;
          }
          if (msg.type === 'room.subscribe') {
            const roomId = z.string().uuid().parse(msg.roomId);
            if (!connection.rooms.has(roomId) && connection.rooms.size >= 10)
              throw new AppError('RATE_LIMITED', 'Too many subscriptions', 429);
            connection.rooms.add(roomId);
            let snapshot;
            try {
              snapshot = await rooms.snapshot(roomId, connection.accountId);
              await rooms.recordActivity(roomId, connection.accountId);
            } catch (error) {
              connection.rooms.delete(roomId);
              throw error;
            }
            socket.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: 'room.snapshot',
                roomId,
                roomRevision: snapshot.roomRevision,
                snapshot,
              }),
            );
            if (snapshot.status === 'closed') {
              connection.rooms.delete(roomId);
              socket.send(
                JSON.stringify({
                  protocolVersion: PROTOCOL_VERSION,
                  type: 'room.closed',
                  roomId,
                  roomRevision: snapshot.roomRevision,
                }),
              );
            } else {
              markOnline(roomId, connection.accountId);
              if (snapshot.activeMatchId) {
                const match = await matches.view(connection.accountId, snapshot.activeMatchId);
                if (connection.rooms.has(roomId) && socket.readyState === 1)
                  socket.send(
                    JSON.stringify({
                      protocolVersion: PROTOCOL_VERSION,
                      type: 'match.snapshot',
                      matchId: match.matchId,
                      revision: match.revision,
                      snapshot: match,
                    }),
                  );
              }
            }
            return;
          }
          throw new AppError('VALIDATION_ERROR', 'Unknown message type', 400);
        } catch (error) {
          if (
            (error instanceof AppError && error.status >= 500) ||
            !(
              error instanceof AppError ||
              error instanceof SyntaxError ||
              error instanceof z.ZodError
            )
          ) {
            closeForFailure(socket, error);
            return;
          }
          const code = error instanceof AppError ? error.code : 'VALIDATION_ERROR';
          if (code === 'UNAUTHENTICATED') {
            socket.close(4001, 'session revoked');
            return;
          }
          socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'error', code }));
        }
      });
      socket.on('close', () => {
        clearTimeout(expiry);
        clearInterval(recheck);
        connections.delete(connection);
        for (const roomId of connection.rooms) markOffline(roomId, connection.accountId);
      });
    },
  );
  return () => {
    unsubscribeRoom();
    unsubscribeMatch();
    unsubscribeRevoked();
    for (const timer of offlineTimers.values()) clearTimeout(timer);
    for (const c of connections) c.socket.terminate();
  };
}
