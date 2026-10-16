import { createRoomResponseSchema } from '@boardgame/protocol';
import { coinAdjustmentSchema, coinHistoryQuerySchema, coinWalletPageSchema, coinWalletSchema, type CoinAdjustment } from '@boardgame/protocol';
import {
  badgeCollectionSchema, badgeDisplayInputSchema, badgeGrantInputSchema, displayedBadgesSchema,
  type BadgeDisplayInput, type BadgeGrantInput,
} from '@boardgame/protocol';
import {
  sessionPublicSchema,
  loginInputSchema,
  logoutResultSchema,
  roomPageSchema,
  joinRoomInputSchema,
  roomCommandSchema,
  roomStartedSchema,
  roomLeftSchema,
  roomInviteResultSchema,
  type RoomCommand,
  type CreateRoomInput as RoomCreateInput,
} from '@boardgame/protocol';
import {
  modelProfileSchema,
  modelEndpointSchema,
  modelProfileSavedSchema,
  modelConnectionTestSchema,
  modelSettingsStatusSchema,
  modelDeletedSchema,
  modelCredentialSavedSchema,
  modelCredentialRevokedSchema,
  type ModelProfileInput,
  type ModelProfileUpdate,
} from '@boardgame/protocol';
import {
  apiEnvelopeSchema,
  matchReplaySchema,
  matchReplayQuerySchema,
  matchCommandReceiptSchema,
  matchViewSchema,
  pongMessageSchema,
} from '@boardgame/protocol';
import {
  createRoomInputSchema,
  createRoomResultSchema,
  lobbyPageSchema,
  gameRulesSchema,
  type CreateRoomInput,
  type LobbyQuery,
} from '@boardgame/protocol';
import { AssetClient } from './assets.js';
import { gamePackageResultSchema, gamePackageReviewSchema } from '@boardgame/protocol';
import {
  adminOverviewSchema,
  adminAccountPageSchema,
  adminAccountSchema,
  adminGameSchema,
  adminAccountCommandSchema,
  adminGameCommandSchema,
  adminUpdateStatusSchema,
  adminUpdateCommandSchema,
  type AdminAccountCommand,
  type AdminGameCommand,
} from '@boardgame/protocol';
import {
  gameSubmissionInputSchema,
  gameSubmissionReviewSchema,
  gameSubmissionSchema,
  gameSubmissionPageSchema,
  type GameSubmissionInput,
  type GameSubmissionReview,
} from '@boardgame/protocol';
import { botSeatCommandSchema, roomSnapshotSchema, type BotSeatCommand } from '@boardgame/protocol';
import {
  gamePresentationSchema,
  gamePresentationInputSchema,
  type GamePresentationInput,
} from '@boardgame/protocol';
import {
  profileSchema,
  profileInputSchema,
  matchHistorySchema,
  type ProfileInput,
} from '@boardgame/protocol';
import {
  socialOverviewSchema,
  socialUpdatesSchema,
  socialUpdatesQuerySchema,
  socialPersonSchema,
  socialIdentitySchema,
  friendIdInputSchema,
  friendRequestInputSchema,
  friendshipSchema,
  friendshipCommandSchema,
  socialDoneSchema,
  messagePageSchema,
  messageInputSchema,
  socialMessageSchema,
  readMessagesInputSchema,
  publicMessageSchema,
  publicMessagePageSchema,
  friendInviteInputSchema,
  friendInviteSchema,
  friendInviteCommandSchema,
  socialSettingsSchema,
  socialSettingsInputSchema,
  type SocialSettingsInput,
  type FriendshipCommand,
  type FriendInviteCommand,
  type FriendRequestInput,
} from '@boardgame/protocol';
export type { AssetDraft, AssetVersion } from './assets.js';

import {
  registrationInputSchema,
  registrationResultSchema,
  type RegistrationInput,
} from '@boardgame/protocol';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly traceId: string,
  ) {
    super(message);
  }
}
export class ApiClient {
  async coinWallet(before?: number, signal?: AbortSignal) {
    const query = coinHistoryQuerySchema.parse({ before });
    return coinWalletPageSchema.parse(await this.request<unknown>(
      `/profile/coins${query.before === undefined ? '' : `?before=${query.before}`}`,
      signal ? { signal } : undefined,
    ));
  }
  async adminCoinWallet(accountId: string, before?: number, signal?: AbortSignal) {
    const query = coinHistoryQuerySchema.parse({ before });
    return coinWalletPageSchema.parse(await this.request<unknown>(
      `/admin/accounts/${encodeURIComponent(accountId)}/coins${query.before === undefined ? '' : `?before=${query.before}`}`,
      signal ? { signal } : undefined,
    ));
  }
  async adjustAdminCoins(accountId: string, input: CoinAdjustment) {
    return coinWalletSchema.parse(await this.request<unknown>(
      `/admin/accounts/${encodeURIComponent(accountId)}/coins`, {
        method: 'POST', body: JSON.stringify(coinAdjustmentSchema.parse(input)),
      },
    ));
  }
  async adminUpdateStatus(signal?: AbortSignal) {
    return adminUpdateStatusSchema.parse(
      await this.request<unknown>('/admin/updates', signal ? { signal } : undefined),
    );
  }
  async checkAdminUpdate(requestId: string, signal?: AbortSignal) {
    return adminUpdateStatusSchema.parse(
      await this.request<unknown>('/admin/updates/check', {
        method: 'POST',
        body: JSON.stringify(adminUpdateCommandSchema.parse({ requestId })),
        ...(signal ? { signal } : {}),
      }),
    );
  }
  async register(input: RegistrationInput) {
    return registrationResultSchema.parse(
      await this.request<unknown>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(registrationInputSchema.parse(input)),
      }),
    );
  }
  async reviewGamePackage(file: Blob, signal?: AbortSignal) {
    return gamePackageReviewSchema.parse(
      await this.request<unknown>('/admin/game-packages/review', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: file,
        ...(signal ? { signal } : {}),
      }),
    );
  }
  async installGamePackage(
    file: Blob,
    requestId: string,
    signal?: AbortSignal,
    expectedCatalogHash?: string,
  ) {
    return gamePackageResultSchema.parse(
      await this.request<unknown>(
        `/admin/game-packages?requestId=${encodeURIComponent(requestId)}${expectedCatalogHash ? `&expectedCatalogHash=${encodeURIComponent(expectedCatalogHash)}` : ''}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: file,
          ...(signal ? { signal } : {}),
        },
      ),
    );
  }
  async socialSettings() {
    return socialSettingsSchema.parse(await this.request<unknown>('/admin/social-settings'));
  }
  async setSocialSettings(input: SocialSettingsInput) {
    return socialSettingsSchema.parse(
      await this.request<unknown>('/admin/social-settings', {
        method: 'PUT',
        body: JSON.stringify(socialSettingsInputSchema.parse(input)),
      }),
    );
  }
  async social(signal?: AbortSignal) {
    return socialOverviewSchema.parse(
      await this.request<unknown>('/social', signal ? { signal } : undefined),
    );
  }
  async socialUpdates(version?: string, signal?: AbortSignal) {
    const query = socialUpdatesQuerySchema.parse({ version });
    return socialUpdatesSchema.parse(
      await this.request<unknown>(
        `/social/updates${query.version ? `?version=${query.version}` : ''}`,
        signal ? { signal } : undefined,
      ),
    );
  }
  async searchFriend(friendId: string) {
    return socialPersonSchema
      .nullable()
      .parse(
        await this.request<unknown>(`/social/search?friendId=${encodeURIComponent(friendId)}`),
      );
  }
  async changeFriendId(input: { requestId: string; friendId: string; expectedRevision: number }) {
    return socialIdentitySchema.parse(
      await this.request<unknown>('/social/id', {
        method: 'PUT',
        body: JSON.stringify(friendIdInputSchema.parse(input)),
      }),
    );
  }
  async requestFriend(input: FriendRequestInput) {
    return friendshipSchema.parse(
      await this.request<unknown>('/social/requests', {
        method: 'POST',
        body: JSON.stringify(friendRequestInputSchema.parse(input)),
      }),
    );
  }
  async updateFriend(id: string, input: FriendshipCommand) {
    return socialDoneSchema.parse(
      await this.request<unknown>(`/social/friends/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(friendshipCommandSchema.parse(input)),
      }),
    );
  }
  async directMessages(id: string, before?: string, signal?: AbortSignal, after?: string) {
    const query = new URLSearchParams();
    if (before) query.set('before', before);
    if (after) query.set('after', after);
    return messagePageSchema.parse(
      await this.request<unknown>(
        `/social/friends/${encodeURIComponent(id)}/messages${query.size ? `?${query}` : ''}`,
        signal ? { signal } : undefined,
      ),
    );
  }
  async sendDirectMessage(id: string, input: { requestId: string; text: string }) {
    return socialMessageSchema.parse(
      await this.request<unknown>(`/social/friends/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify(messageInputSchema.parse(input)),
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  async publicMessages(before?: string, signal?: AbortSignal, after?: string) {
    const query = new URLSearchParams();
    if (before) query.set('before', before);
    if (after) query.set('after', after);
    return publicMessagePageSchema.parse(
      await this.request<unknown>(
        `/social/public/messages${query.size ? `?${query}` : ''}`,
        signal ? { signal } : undefined,
      ),
    );
  }
  async sendPublicMessage(input: { requestId: string; text: string }) {
    return publicMessageSchema.parse(
      await this.request<unknown>('/social/public/messages', {
        method: 'POST',
        body: JSON.stringify(messageInputSchema.parse(input)),
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  async readDirectMessages(id: string, input: { requestId: string; messageId: string }) {
    return socialDoneSchema.parse(
      await this.request<unknown>(`/social/friends/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        body: JSON.stringify(readMessagesInputSchema.parse(input)),
      }),
    );
  }
  async inviteFriendToRoom(
    id: string,
    input: { requestId: string; friendAccountId: string; expectedRoomRevision: number },
  ) {
    return friendInviteSchema.parse(
      await this.request<unknown>(`/rooms/${encodeURIComponent(id)}/friend-invitations`, {
        method: 'POST',
        body: JSON.stringify(friendInviteInputSchema.parse(input)),
      }),
    );
  }
  async respondFriendInvitation(id: string, input: FriendInviteCommand) {
    return friendInviteSchema.parse(
      await this.request<unknown>(`/social/invitations/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(friendInviteCommandSchema.parse(input)),
      }),
    );
  }
  async adminOverview() {
    return adminOverviewSchema.parse(await this.request<unknown>('/admin/overview'));
  }
  async adminAccounts(search = '', before?: string) {
    const query = new URLSearchParams({ search });
    if (before) query.set('before', before);
    return adminAccountPageSchema.parse(await this.request<unknown>(`/admin/accounts?${query}`));
  }
  async setAdminAccountStatus(id: string, input: AdminAccountCommand) {
    return adminAccountSchema.parse(
      await this.request<unknown>(`/admin/accounts/${encodeURIComponent(id)}/status`, {
        method: 'PUT',
        body: JSON.stringify(adminAccountCommandSchema.parse(input)),
      }),
    );
  }
  async adminGames() {
    return adminGameSchema.array().parse(await this.request<unknown>('/admin/games'));
  }
  async setAdminGameStatus(id: string, version: string, input: AdminGameCommand) {
    return adminGameSchema.parse(
      await this.request<unknown>(
        `/admin/games/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/status`,
        {
          method: 'PUT',
          body: JSON.stringify(adminGameCommandSchema.parse(input)),
        },
      ),
    );
  }
  async submitGame(input: GameSubmissionInput) {
    return gameSubmissionSchema.parse(
      await this.request<unknown>('/game-submissions', {
        method: 'POST',
        body: JSON.stringify(gameSubmissionInputSchema.parse(input)),
      }),
    );
  }
  async gameSubmissions(before?: string) {
    return gameSubmissionPageSchema.parse(
      await this.request<unknown>(
        `/game-submissions${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      ),
    );
  }
  async gameSubmission(id: string) {
    return gameSubmissionSchema.parse(
      await this.request<unknown>(`/game-submissions/${encodeURIComponent(id)}`),
    );
  }
  async adminGameSubmissions(before?: string) {
    return gameSubmissionPageSchema.parse(
      await this.request<unknown>(
        `/admin/game-submissions${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      ),
    );
  }
  async adminGameSubmission(id: string) {
    return gameSubmissionSchema.parse(
      await this.request<unknown>(`/admin/game-submissions/${encodeURIComponent(id)}`),
    );
  }
  async reviewGameSubmission(id: string, input: GameSubmissionReview) {
    return gameSubmissionSchema.parse(
      await this.request<unknown>(`/admin/game-submissions/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: JSON.stringify(gameSubmissionReviewSchema.parse(input)),
      }),
    );
  }
  async gamePresentations() {
    return gamePresentationSchema
      .array()
      .parse(await this.request<unknown>('/games/presentations'));
  }
  async saveGamePresentation(id: string, version: string, input: GamePresentationInput) {
    return gamePresentationSchema.parse(
      await this.request<unknown>(
        `/games/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/presentation`,
        { method: 'PUT', body: JSON.stringify(gamePresentationInputSchema.parse(input)) },
      ),
    );
  }
  async profile() {
    return profileSchema.parse(await this.request<unknown>('/profile'));
  }
  async badges(signal?: AbortSignal) {
    return badgeCollectionSchema.parse(
      await this.request<unknown>('/profile/badges', { signal: signal ?? null }),
    );
  }
  async displayedBadges(accountId: string, signal?: AbortSignal) {
    return displayedBadgesSchema.parse(
      await this.request<unknown>(`/profile/badges/${encodeURIComponent(accountId)}`, {
        signal: signal ?? null,
      }),
    );
  }
  async saveDisplayedBadges(input: BadgeDisplayInput) {
    return badgeCollectionSchema.parse(
      await this.request<unknown>('/profile/badges', {
        method: 'PUT',
        body: JSON.stringify(badgeDisplayInputSchema.parse(input)),
      }),
    );
  }
  async adminBadges(accountId: string, signal?: AbortSignal) {
    return badgeCollectionSchema.parse(
      await this.request<unknown>(`/admin/accounts/${encodeURIComponent(accountId)}/badges`, {
        signal: signal ?? null,
      }),
    );
  }
  async grantBadge(accountId: string, input: BadgeGrantInput) {
    return badgeCollectionSchema.parse(
      await this.request<unknown>(`/admin/accounts/${encodeURIComponent(accountId)}/badges`, {
        method: 'PUT',
        body: JSON.stringify(badgeGrantInputSchema.parse(input)),
      }),
    );
  }
  async saveProfile(input: ProfileInput) {
    return profileSchema.parse(
      await this.request<unknown>('/profile', {
        method: 'PUT',
        body: JSON.stringify(profileInputSchema.parse(input)),
      }),
    );
  }
  async matchHistory(before?: string) {
    return matchHistorySchema.parse(
      await this.request<unknown>(
        `/profile/matches${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      ),
    );
  }
  readonly assets = new AssetClient((path, init) => this.request<unknown>(path, init));
  private csrfToken: string | null = null;
  constructor(private base = '/api/v1') {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    if (init?.method && init.method !== 'GET' && this.csrfToken)
      headers.set('x-csrf-token', this.csrfToken);
    const controller = new AbortController();
    const callerSignal = init?.signal;
    const cancel = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort', cancel, { once: true });
    // Binary uploads include server-side media/package validation and get a longer deadline.
    const timeoutMs = init?.body != null && typeof init.body !== 'string' ? 120000 : 30000;
    const deadline = setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    );
    try {
      const response = await fetch(`${this.base}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status === 204) return undefined as T;
      const body = apiEnvelopeSchema.parse(await response.json());
      if (!body.ok)
        throw new ApiError(body.error.code, body.error.message, body.error.retryable, body.traceId);
      return body.data as T;
    } finally {
      clearTimeout(deadline);
      callerSignal?.removeEventListener('abort', cancel);
    }
  }
  async login(username: string, password: string) {
    const input = loginInputSchema.parse({ username, password });
    const session = sessionPublicSchema.parse(
      await this.request<unknown>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    );
    this.csrfToken = session.csrfToken;
    return session;
  }
  async me(signal?: AbortSignal) {
    const session = sessionPublicSchema.parse(
      await this.request<unknown>('/auth/me', signal ? { signal } : undefined),
    );
    this.csrfToken = session.csrfToken;
    return session;
  }
  async logout() {
    try {
      return logoutResultSchema.parse(
        await this.request<unknown>('/auth/logout', { method: 'POST' }),
      );
    } finally {
      this.csrfToken = null;
      if (typeof sessionStorage !== 'undefined')
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('boardgame:pending-match:')) sessionStorage.removeItem(key);
        }
    }
  }
  async rooms(cursor?: string) {
    return roomPageSchema.parse(
      await this.request<unknown>(`/rooms${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    );
  }
  async createConfiguredRoom(body: CreateRoomInput) {
    return createRoomResultSchema.parse(
      await this.request<unknown>('/rooms', {
        method: 'POST',
        body: JSON.stringify(createRoomInputSchema.parse(body)),
      }),
    );
  }
  async lobby(query: LobbyQuery = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '') params.set(key, String(value));
    return lobbyPageSchema.parse(await this.request<unknown>(`/rooms/lobby?${params}`));
  }
  async joinPublicRoom(id: string, body: { requestId: string; password?: string }) {
    await this.request<unknown>(`/rooms/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  async gameRules(id: string, version: string) {
    return gameRulesSchema.parse(
      await this.request<unknown>(
        `/games/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/rules`,
      ),
    );
  }
  async saveRoomBot(id: string, seatId: string, method: 'PUT' | 'PATCH', body: BotSeatCommand) {
    return roomSnapshotSchema.parse(
      await this.request<unknown>(
        `/rooms/${encodeURIComponent(id)}/seats/${encodeURIComponent(seatId)}/bot`,
        {
          method,
          body: JSON.stringify(botSeatCommandSchema.parse(body)),
        },
      ),
    );
  }
  async room(id: string, signal?: AbortSignal) {
    return roomSnapshotSchema.parse(
      await this.request<unknown>(
        `/rooms/${encodeURIComponent(id)}`,
        signal ? { signal } : undefined,
      ),
    );
  }
  async createRoom(body: RoomCreateInput) {
    return createRoomResponseSchema.parse(
      await this.request<unknown>('/rooms', {
        method: 'POST',
        body: JSON.stringify(createRoomInputSchema.parse(body)),
      }),
    );
  }
  async joinRoom(body: { requestId: string; inviteCode: string; password?: string }) {
    return roomSnapshotSchema.parse(
      await this.request<unknown>('/rooms/join', {
        method: 'POST',
        body: JSON.stringify(joinRoomInputSchema.parse(body)),
      }),
    );
  }
  async roomCommand(id: string, raw: RoomCommand) {
    const command = roomCommandSchema.parse(raw);
    const { type, ...input } = command;
    let path: string;
    let method: string;
    let body: unknown = input;
    switch (command.type) {
      case 'seat':
        path = 'my-seat';
        method = 'PUT';
        break;
      case 'unseat':
        path = 'my-seat';
        method = 'DELETE';
        break;
      case 'ready':
        path = 'my-ready';
        method = 'PUT';
        break;
      case 'config':
        path = 'config';
        method = 'PATCH';
        break;
      case 'assets':
        path = 'assets';
        method = 'PUT';
        break;
      case 'add-bot':
      case 'configure-bot':
      case 'remove-bot':
        path = `seats/${encodeURIComponent(command.seatId)}/bot`;
        method =
          command.type === 'remove-bot' ? 'DELETE' : command.type === 'add-bot' ? 'PUT' : 'PATCH';
        body = {
          requestId: command.requestId,
          expectedRoomRevision: command.expectedRoomRevision,
          ...('settings' in command ? command.settings : {}),
        };
        break;
      default:
        path = command.type;
        method = 'POST';
    }
    const result = await this.request<unknown>(`/rooms/${encodeURIComponent(id)}/${path}`, {
      method,
      body: JSON.stringify(body),
    });
    if (type === 'start') return roomStartedSchema.parse(result);
    if (type === 'leave') return roomLeftSchema.parse(result);
    if (type === 'invite') return roomInviteResultSchema.parse(result);
    return roomSnapshotSchema.parse(result);
  }
  async matchReplay(id: string, revision?: number) {
    const query = matchReplayQuerySchema.parse(revision === undefined ? {} : { revision });
    const suffix = query.revision === undefined ? '' : `?revision=${query.revision}`;
    return matchReplaySchema.parse(
      await this.request<unknown>(`/matches/${encodeURIComponent(id)}/replay${suffix}`, {
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  matchView(id: string) {
    return this.matchSnapshot(id);
  }
  async matchSnapshot(id: string, signal?: AbortSignal) {
    return matchViewSchema.parse(
      await this.request<unknown>(`/matches/${encodeURIComponent(id)}/view`, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      }),
    );
  }
  async matchCommandReceipt(id: string, requestId: string) {
    return matchCommandReceiptSchema.parse(
      await this.request<unknown>(
        `/matches/${encodeURIComponent(id)}/commands/${encodeURIComponent(requestId)}`,
        { signal: AbortSignal.timeout(10000) },
      ),
    );
  }
  async submitMatchAction(
    id: string,
    body: {
      requestId: string;
      expectedRevision: number;
      expectedControllerEpoch: number;
      action: unknown;
    },
  ) {
    return matchViewSchema.parse(
      await this.request<unknown>(`/matches/${encodeURIComponent(id)}/actions`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  async setMyController(
    id: string,
    body: {
      requestId: string;
      expectedControllerEpoch: number;
      controllerType: 'human' | 'script' | 'model';
      policyId?: 'basic-v1';
      profileId?: string;
    },
  ) {
    return matchViewSchema.parse(
      await this.request<unknown>(`/matches/${encodeURIComponent(id)}/my-controller`, {
        method: 'PUT',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  async modelEndpoints() {
    return modelEndpointSchema.array().parse(await this.request<unknown>('/model-endpoints'));
  }
  async modelSettingsStatus() {
    return modelSettingsStatusSchema.parse(await this.request<unknown>('/me/model-settings'));
  }
  async modelProfiles() {
    return modelProfileSchema.array().parse(await this.request<unknown>('/me/model-profiles'));
  }
  async createModelProfile(body: ModelProfileInput) {
    return modelProfileSavedSchema.parse(
      await this.request<unknown>('/me/model-profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  }
  async updateModelProfile(id: string, body: ModelProfileUpdate) {
    return modelProfileSavedSchema.parse(
      await this.request<unknown>(`/me/model-profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
  }
  async deleteModelProfile(id: string) {
    return modelDeletedSchema.parse(
      await this.request<unknown>(`/me/model-profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    );
  }
  async testModelProfile(id: string) {
    return modelConnectionTestSchema.parse(
      await this.request<unknown>(`/me/model-profiles/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: '{}',
      }),
    );
  }
  async setModelCredential(id: string, apiKey: string) {
    return modelCredentialSavedSchema.parse(
      await this.request<unknown>(`/me/model-profiles/${encodeURIComponent(id)}/credential`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      }),
    );
  }
  async revokeModelCredential(id: string) {
    return modelCredentialRevokedSchema.parse(
      await this.request<unknown>(`/me/model-profiles/${encodeURIComponent(id)}/credential`, {
        method: 'DELETE',
      }),
    );
  }
  games<T>(signal?: AbortSignal) {
    return this.request<T>('/games', signal ? { signal } : undefined);
  }
  createMatch<T>(options: unknown, signal?: AbortSignal) {
    return this.request<T>('/dev/lab/matches', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'demo.test-counter', version: '0.1.0', options }),
      ...(signal ? { signal } : {}),
    });
  }
  view<T>(matchId: string, seatId: string, signal?: AbortSignal) {
    return this.request<T>(
      `/dev/lab/matches/${encodeURIComponent(matchId)}/view?seat=${encodeURIComponent(seatId)}`,
      signal ? { signal } : undefined,
    );
  }
  action<T>(matchId: string, command: unknown, signal?: AbortSignal) {
    return this.request<T>(`/dev/lab/matches/${encodeURIComponent(matchId)}/actions`, {
      method: 'POST',
      body: JSON.stringify(command),
      ...(signal ? { signal } : {}),
    });
  }
  deleteMatch(matchId: string, signal?: AbortSignal) {
    return this.request<void>(`/dev/lab/matches/${encodeURIComponent(matchId)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }
}
export function pingWebSocket(signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const url = new URL('/api/v1/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket ping timed out'));
    }, 5000);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        ws.close();
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
    ws.addEventListener('message', (event) => {
      try {
        const raw: unknown = JSON.parse(String(event.data));
        if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'hello')
          ws.send(JSON.stringify({ protocolVersion: 1, type: 'ping', requestId: id }));
        if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'pong') {
          const pong = pongMessageSchema.parse(raw);
          if (pong.requestId === id) {
            clearTimeout(timer);
            ws.close();
            resolve(Math.round(performance.now() - started));
          }
        }
      } catch {
        clearTimeout(timer);
        ws.close();
        reject(new Error('WebSocket returned an invalid protocol message'));
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket unavailable'));
    });
  });
}
