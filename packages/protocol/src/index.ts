import { z } from 'zod';
import { friendIdSchema } from './social.js';
export * from './auth.js';
export * from './admin.js';
export * from './game-submissions.js';
export * from './game-presentation.js';
export * from './profile.js';
export * from './social.js';
import { assetBindingSchema, presentationCueSchema } from './assets.js';

export const PROTOCOL_VERSION = 1 as const;
const botSeatRevision = {
  requestId: z.string().min(1).max(128),
  expectedRoomRevision: z.number().int().nonnegative(),
};
export const botSeatCommandSchema = z.union([
  z
    .object({
      ...botSeatRevision,
      controllerType: z.literal('script').optional(),
      policyId: z.literal('basic-v1'),
    })
    .strict(),
  z
    .object({
      ...botSeatRevision,
      controllerType: z.literal('model'),
      profileId: z.string().uuid(),
    })
    .strict(),
]);
export type BotSeatCommand = z.input<typeof botSeatCommandSchema>;
export const roomSnapshotSchema = z.object({
  assetVersionId: z.string().uuid().nullable(),
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['waiting', 'in_game', 'closed']),
  hostAccountId: z.string().uuid(),
  gameId: z.string(),
  gameVersion: z.string(),
  options: z.unknown(),
  seatCount: z.number().int(),
  roomRevision: z.number().int().nonnegative(),
  activeMatchId: z.string().uuid().nullable(),
  visibility: z.enum(['public', 'private']),
  hasPassword: z.boolean(),
  matchStatus: z.string().nullable(),
  members: z.array(
    z.object({ accountId: z.string().uuid(), displayName: z.string(), joinedAt: z.string() }),
  ),
  seats: z.array(
    z.object({
      seatId: z.string().uuid(),
      seatIndex: z.number().int(),
      ownerAccountId: z.string().uuid().nullable(),
      occupantKind: z.enum(['human', 'bot']),
      botName: z.string().nullable(),
      botPolicyId: z.string().nullable(),
      botModelProfileId: z.string().uuid().nullable().default(null),
      ready: z.boolean(),
    }),
  ),
  permissions: z.object({ isHost: z.boolean(), canConfigure: z.boolean(), canStart: z.boolean() }),
  startBlockers: z.array(z.string()),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export const modelParametersSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().min(16).max(512).optional(),
  })
  .strict();
export const modelProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    endpointId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    baseUrl: z.string().trim().max(500).optional(),
    modelId: z.string().trim().min(1).max(120),
    parameters: modelParametersSchema.default({}),
    enabled: z.boolean().default(true),
    apiKey: z.string().trim().min(8).max(4096).optional(),
  })
  .strict();
export const modelProfileUpdateSchema = modelProfileInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export const modelProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  endpoint_id: z.string(),
  base_url: z.string(),
  model_id: z.string(),
  parameters: modelParametersSchema,
  enabled: z.boolean(),
  has_credential: z.boolean(),
  profile_version: z.number().int(),
});
export const modelEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.enum(['mock', 'openai-chat-completions']),
});
export const modelProfileSavedSchema = z.object({
  id: z.string().uuid(),
  profileVersion: z.number().int(),
});
export const modelConnectionTestSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.literal('completed'),
  kind: z.enum(['real', 'mock']),
});
export const modelSettingsStatusSchema = z.object({ credentialsAvailable: z.boolean() });
export const modelDeletedSchema = z.object({ deleted: z.boolean() });
export const modelCredentialSavedSchema = z.object({ hasCredential: z.boolean() });
export const modelCredentialRevokedSchema = z.object({ revoked: z.boolean() });
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelEndpoint = z.infer<typeof modelEndpointSchema>;
export type ModelProfileInput = z.input<typeof modelProfileInputSchema>;
export type ModelProfileUpdate = z.input<typeof modelProfileUpdateSchema>;
export const errorCodes = [
  'VALIDATION_ERROR',
  'GAME_NOT_FOUND',
  'MATCH_NOT_FOUND',
  'STATE_CONFLICT',
  'ACTION_NOT_ALLOWED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVITE_UNAVAILABLE',
  'ROOM_FULL',
  'ROOM_NOT_FOUND',
  'ROOM_NOT_WAITING',
  'SEAT_OCCUPIED',
  'NOT_SEATED',
  'NOT_ALL_READY',
  'ROOM_CONFIG_CHANGED',
  'REQUEST_ID_CONFLICT',
  'GAME_SETUP_FAILED',
  'GAME_VERSION_UNAVAILABLE',
  'RECOVERY_BLOCKED',
  'ROOM_ALREADY_STARTED',
  'CONTROLLER_CONFLICT',
  'CONTROLLER_NOT_HUMAN',
  'AI_POLICY_UNAVAILABLE',
  'AI_NOT_SUPPORTED',
  'AI_TASK_STALE',
  'AI_BLOCKED',
  'AI_INVALID_OUTPUT',
  'AI_PROVIDER_FAILED',
  'AI_TIMEOUT',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export type SuccessEnvelope<T> = { ok: true; data: T; traceId: string };
export type ErrorEnvelope = {
  ok: false;
  error: { code: ErrorCode; message: string; retryable: boolean };
  traceId: string;
};
export const apiEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown(), traceId: z.string().min(1) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({ code: z.enum(errorCodes), message: z.string(), retryable: z.boolean() })
        .strict(),
      traceId: z.string().min(1),
    })
    .strict(),
]);

export const requestIdSchema = z.string().min(1).max(128);
export const roomPasswordSchema = z.string().min(1).max(128);
export const createRoomInputSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().trim().min(1).max(40),
    gameId: z.string().min(1).max(128),
    version: z.string().min(1).max(32),
    options: z.unknown(),
    seatCount: z.number().int().positive().max(20),
    visibility: z.enum(['public', 'private']).optional(),
    password: roomPasswordSchema.optional(),
  })
  .strict();
export const createRoomResultSchema = z.object({
  roomId: z.string().uuid(),
  inviteCode: z.string().nullable(),
});
export const createRoomResponseSchema = createRoomResultSchema.extend({
  inviteIssuedAt: z.string(),
  room: roomSnapshotSchema,
});
export const roomPageSchema = z.object({
  items: roomSnapshotSchema.array(),
  nextCursor: z.string().nullable(),
});
export const joinRoomInputSchema = z
  .object({
    requestId: requestIdSchema,
    inviteCode: z.string().min(1).max(32),
    password: roomPasswordSchema.optional(),
  })
  .strict();
export const roomRevisionInputSchema = z
  .object({
    requestId: requestIdSchema,
    expectedRoomRevision: z.number().int().nonnegative(),
  })
  .strict();
export const roomSeatInputSchema = roomRevisionInputSchema
  .extend({ seatIndex: z.number().int().nonnegative() })
  .strict();
export const roomReadyInputSchema = roomRevisionInputSchema.extend({ ready: z.boolean() }).strict();
export const roomHostInputSchema = roomRevisionInputSchema
  .extend({ targetAccountId: z.string().uuid() })
  .strict();
export const roomConfigInputSchema = roomRevisionInputSchema
  .extend({
    name: z.string().min(1).max(40),
    gameId: z.string(),
    version: z.string(),
    options: z.unknown(),
    seatCount: z.number().int().positive().max(20),
  })
  .strict();
export const roomAssetsInputSchema = roomRevisionInputSchema
  .extend({ versionId: z.string().uuid() })
  .strict();
export const roomCommandSchema = z.discriminatedUnion('type', [
  roomSeatInputSchema.extend({ type: z.literal('seat') }),
  roomReadyInputSchema.extend({ type: z.literal('ready') }),
  roomHostInputSchema.extend({ type: z.literal('host') }),
  roomConfigInputSchema.extend({ type: z.literal('config') }),
  roomAssetsInputSchema.extend({ type: z.literal('assets') }),
  ...(['unseat', 'invite', 'start', 'leave', 'close'] as const).map((type) =>
    roomRevisionInputSchema.extend({ type: z.literal(type) }),
  ),
  roomRevisionInputSchema.extend({ type: z.literal('remove-bot'), seatId: z.string().uuid() }),
  roomRevisionInputSchema.extend({
    type: z.enum(['add-bot', 'configure-bot']),
    seatId: z.string().uuid(),
    settings: z.union([
      botSeatCommandSchema.options[0].omit({ requestId: true, expectedRoomRevision: true }),
      botSeatCommandSchema.options[1].omit({ requestId: true, expectedRoomRevision: true }),
    ]),
  }),
]);
export type RoomCommand = z.input<typeof roomCommandSchema>;
export type RoomCommandDetails = RoomCommand extends infer C
  ? C extends RoomCommand
    ? Omit<C, 'requestId' | 'expectedRoomRevision'>
    : never
  : never;
export const roomStartedSchema = z.object({ matchId: z.string().uuid() });
export const roomLeftSchema = z.object({ left: z.literal(true) });
export const roomInviteResultSchema = z.object({
  inviteCode: z.string().nullable(),
  inviteIssuedAt: z.string(),
  room: roomSnapshotSchema,
});
export const lobbyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(512).optional(),
    gameId: z.string().max(128).optional(),
    roomType: z.enum(['open', 'password']).optional(),
    status: z.enum(['waiting', 'in_game', 'finished', 'closed']).optional(),
  })
  .strict();
export const lobbyRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gameId: z.string(),
  gameVersion: z.string(),
  status: z.enum(['waiting', 'in_game', 'finished', 'closed']),
  seatCount: z.number().int(),
  occupiedCount: z.number().int(),
  hasPassword: z.boolean(),
  isMember: z.boolean(),
  hostDisplayName: z.string(),
  hostFriendId: friendIdSchema,
});
export const lobbyPageSchema = z.object({
  items: lobbyRoomSchema.array(),
  nextCursor: z.string().nullable(),
});
export const gameRulesSchema = z.object({
  gameId: z.string(),
  version: z.string(),
  rules: z.string(),
});
export type CreateRoomInput = z.input<typeof createRoomInputSchema>;
export type LobbyQuery = z.input<typeof lobbyQuerySchema>;
export type LobbyRoom = z.infer<typeof lobbyRoomSchema>;
export const pingMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('ping'),
    requestId: requestIdSchema,
  })
  .strict();
export const pongMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('pong'),
    requestId: requestIdSchema,
  })
  .strict();
export const gameCommandSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('game.command'),
    requestId: requestIdSchema,
    matchId: z.string().min(1).max(128),
    expectedRevision: z.number().int().nonnegative(),
    action: z.object({ type: z.string().min(1).max(64), payload: z.unknown() }).strict(),
  })
  .strict();
export const playerSnapshotSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('player.snapshot'),
    matchId: z.string(),
    revision: z.number().int().nonnegative(),
    view: z.unknown(),
    delivery: z.enum(['snapshot', 'live', 'catch-up']),
  })
  .strict();

export const createLabMatchSchema = z
  .object({
    gameId: z.string().min(1).max(128),
    version: z.string().min(1).max(32),
    options: z.unknown(),
  })
  .strict();
export const labActionSchema = z
  .object({
    testSeatId: z.string().min(1).max(128),
    requestId: requestIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    action: z.unknown(),
  })
  .strict();

export const matchActionSchema = z
  .object({
    requestId: requestIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    expectedControllerEpoch: z.number().int().nonnegative().optional(),
    action: z.unknown(),
  })
  .strict();

export const controllerCommandSchema = z
  .object({
    requestId: requestIdSchema,
    expectedControllerEpoch: z.number().int().nonnegative(),
    controllerType: z.enum(['human', 'script', 'model']),
    profileId: z.string().uuid().optional(),
    policyId: z.literal('basic-v1').optional(),
  })
  .strict();

export const matchViewSchema = z
  .object({
    players: z
      .array(
        z
          .object({
            seatId: z.string(),
            seatIndex: z.number().int().nonnegative(),
            displayName: z.string(),
            occupantKind: z.enum(['human', 'bot']),
          })
          .strict(),
      )
      .optional(),
    assetBinding: assetBindingSchema.nullable().optional(),
    cues: z.array(presentationCueSchema).max(128).optional(),
    matchId: z.string().uuid(),
    roomId: z.string().uuid(),
    gameId: z.string(),
    gameVersion: z.string(),
    revision: z.number().int().nonnegative(),
    status: z.enum(['active', 'finished', 'aborted']),
    seatIndex: z.number().int().nonnegative(),
    controller: z
      .object({
        type: z.enum(['human', 'script', 'model']),
        controllerEpoch: z.number().int().nonnegative(),
        controllerVersion: z.number().int().nonnegative(),
        policyId: z.string().nullable(),
        profileId: z.string().uuid().nullable().optional(),
      })
      .strict(),
    aiStatus: z
      .object({
        status: z.enum(['idle', 'queued', 'running', 'submitting', 'blocked']),
        version: z.number().int().nonnegative(),
        safeErrorCode: z.string().nullable(),
      })
      .strict(),
    controllers: z
      .array(
        z
          .object({
            seatIndex: z.number().int().nonnegative(),
            type: z.enum(['human', 'script', 'model']),
            controllerEpoch: z.number().int().nonnegative(),
            controllerVersion: z.number().int().nonnegative(),
            aiStatus: z.enum(['idle', 'queued', 'running', 'submitting', 'blocked']),
            aiStatusVersion: z.number().int().nonnegative(),
            safeErrorCode: z.string().nullable(),
          })
          .strict(),
      )
      .optional(),
    view: z.unknown(),
    delivery: z.enum(['snapshot', 'live']),
    events: z.array(z.unknown()).optional(),
  })
  .strict();
export type MatchView = z.infer<typeof matchViewSchema>;
export const matchCommandReceiptSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('accepted'),
      requestId: requestIdSchema,
      appliedRevision: z.number().int().positive(),
    })
    .strict(),
  z.object({ outcome: z.literal('not_found'), requestId: requestIdSchema }).strict(),
]);
export type MatchCommandReceipt = z.infer<typeof matchCommandReceiptSchema>;
export const matchSnapshotMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('match.snapshot'),
    matchId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    snapshot: matchViewSchema,
  })
  .strict();

export * from './game-packages.js';

// Replay responses contain only the authenticated participant's projection.
export const matchReplayQuerySchema = z
  .object({
    revision: z.coerce.number().int().nonnegative().max(2147483647).optional(),
  })
  .strict();
export const matchReplaySchema = z
  .object({
    matchId: z.string().uuid(),
    gameId: z.string(),
    gameVersion: z.string(),
    status: z.enum(['finished', 'aborted']),
    firstRevision: z.number().int().nonnegative(),
    lastRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    seatIndex: z.number().int().nonnegative(),
    actorSeatId: z.string().uuid().nullable(),
    recordedAt: z.string().datetime(),
    players: matchViewSchema.shape.players.unwrap(),
    assetBinding: assetBindingSchema.nullable(),
    view: z.unknown(),
    events: z.array(z.unknown()),
  })
  .strict();
export type MatchReplay = z.infer<typeof matchReplaySchema>;
