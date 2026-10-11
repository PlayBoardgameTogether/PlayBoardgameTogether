import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from './db/index.js';
import type pg from 'pg';
import type { ApiConfig } from './config.js';
import { AppError } from './errors.js';
import { registrationInputSchema, registrationResultSchema } from '@boardgame/protocol';

export const usernameSchema = z.string().regex(/^[A-Za-z0-9_]{3,32}$/);
export const passwordSchema = z.string().min(12).max(128);
export const displayNameSchema = z.string().min(1).max(32);
export type { AccountPublic } from "@boardgame/protocol";
import type { AccountPublic } from "@boardgame/protocol";
export type AuthContext = { sessionId: string; account: AccountPublic; expiresAt: Date; csrfHash: string; tokenHash: string };
type AccountRow = { id: string; username_canonical: string; display_name: string; password_hash: string; role: AccountPublic['role']; status: AccountPublic['status'] };

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const publicAccount = (row: AccountRow): AccountPublic => ({ id: row.id, username: row.username_canonical, displayName: row.display_name, role: row.role, status: row.status });
export const SESSION_COOKIE = 'boardgame_session';
export const CSRF_COOKIE = 'boardgame_csrf';
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
}
function cookie(token: string, config: ApiConfig, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.COOKIE_SECURE ? '; Secure' : ''}`;
}
function csrfCookie(token:string,config:ApiConfig,maxAge:number){return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=${maxAge}${config.COOKIE_SECURE?'; Secure':''}`;}

class FailureLimiter {
  private values = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  check(key: string) { const now = Date.now(); const values = (this.values.get(key) ?? []).filter(v => now - v < this.windowMs); this.values.set(key, values); if (values.length >= this.max) throw new AppError('RATE_LIMITED', 'Too many failed attempts; retry later', 429, true); }
  fail(key: string) { const values = this.values.get(key) ?? []; values.push(Date.now()); this.values.set(key, values); }
  clear(key: string) { this.values.delete(key); }
}

export class AuthService {
  private ipLimiter: FailureLimiter;
  private userLimiter: FailureLimiter;
  private cleanupTimer: NodeJS.Timeout;
  private revokedListeners = new Set<(accountId: string, sessionId?: string) => void>();
  private notificationClient: pg.PoolClient | undefined;
  private notificationRetry: NodeJS.Timeout | undefined;
  private closed = false;
  constructor(private db: Database, private config: ApiConfig) {
    this.ipLimiter = new FailureLimiter(config.LOGIN_IP_FAILURES ?? 10, config.LOGIN_WINDOW_MS ?? 10 * 60_000);
    this.userLimiter = new FailureLimiter(config.LOGIN_USER_FAILURES ?? 5, config.LOGIN_WINDOW_MS ?? 10 * 60_000);
    this.cleanupTimer = setInterval(() => void db.query('DELETE FROM sessions WHERE expires_at < now() OR revoked_at < now() - interval \'7 days\'').catch(() => undefined), 60 * 60_000);
    this.cleanupTimer.unref();
  }
  onRevoked(listener: (accountId: string, sessionId?: string) => void) { this.revokedListeners.add(listener); return () => this.revokedListeners.delete(listener); }
  private retryNotifications() {
    if (this.closed || this.notificationRetry) return;
    this.notificationRetry = setTimeout(() => { this.notificationRetry = undefined; void this.listenForRevocations().catch(() => undefined); }, 5000);
    this.notificationRetry.unref();
  }
  async listenForRevocations() {
    if (this.closed || this.notificationClient || typeof this.db.connect !== 'function') return;
    let client: pg.PoolClient;
    try { client = await this.db.connect(); }
    catch (error) { this.retryNotifications(); throw error; }
    try {
      await client.query('LISTEN boardgame_session_revoked');
      client.on('notification', message => {
        if (message.channel === 'boardgame_session_revoked' && message.payload) {
          for (const listener of this.revokedListeners) listener(message.payload);
        }
      });
      client.on('error', error => { if (this.notificationClient === client) { this.notificationClient = undefined; client.release(error); this.retryNotifications(); } });
      this.notificationClient = client;
    } catch (error) { client.release(); this.retryNotifications(); throw error; }
  }
  assertOrigin(request: FastifyRequest) { if (request.headers.origin !== this.config.WEB_ORIGIN) throw new AppError('FORBIDDEN', 'Request origin is not allowed', 403); }
  async register(raw: unknown) {
    const input = registrationInputSchema.parse(raw);
    const passwordHash = await hashPassword(input.password);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Serialize with friend ID edits and automatic CLI account ID allocation.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('social-write', 0))");
      await client.query(`INSERT INTO accounts
        (id,username_canonical,display_name,password_hash,role,status,friend_id)
        VALUES($1,$2,$3,$4,'user','active',$5)`,
      [randomUUID(), input.userId, input.displayName, passwordHash, input.userId]);
      await client.query('COMMIT');
      return registrationResultSchema.parse({
        username: input.userId, displayName: input.displayName, friendId: input.userId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new AppError('STATE_CONFLICT', '这个用户 ID 已被使用，请换一个', 409);
      }
      throw error;
    } finally {
      client.release();
    }
  }
  async login(username: string, password: string, ip: string) {
    username = username.replace(/^@/, '');
    const canonical = username.toLowerCase(); this.ipLimiter.check(ip); this.userLimiter.check(canonical);
    const found = usernameSchema.safeParse(username).success ? await this.db.query<AccountRow>('SELECT id,username_canonical,display_name,password_hash,role,status FROM accounts WHERE username_canonical=$1', [canonical]) : { rows: [] as AccountRow[] };
    const row = found.rows[0];
    let valid = false;
    if (row) { try { valid = await verifyPassword(row.password_hash, password); } catch { valid = false; } }
    else { try { await verifyPassword('$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQxMjM0NTY3OA$4Zg7IL1rCRrp4lh0AQiR31n4t61YhQWnGcRlQfYGkY0', password); } catch { void 0; } }
    if (!row || !valid || row.status !== 'active') { this.ipLimiter.fail(ip); this.userLimiter.fail(canonical); throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid username or password', 401); }
    this.ipLimiter.clear(ip); this.userLimiter.clear(canonical);
    const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url'); const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + (this.config.SESSION_TTL_MS ?? 7 * 24 * 60 * 60_000));
    await this.db.query('INSERT INTO sessions(id,account_id,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [sessionId, row.id, digest(token), digest(csrf), expiresAt]);
    return { account: publicAccount(row), token, csrfToken: csrf, expiresAt };
  }
  setCookie(reply: FastifyReply, token: string, csrfToken?:string) { const age=Math.floor((this.config.SESSION_TTL_MS ?? 7 * 24 * 60 * 60_000) / 1000);reply.header('set-cookie',[cookie(token,this.config,age),csrfCookie(csrfToken??'',this.config,age)]); }
  clearCookie(reply: FastifyReply) { reply.header('set-cookie', [cookie('', this.config, 0),csrfCookie('',this.config,0)]); }
  csrfFor(request:FastifyRequest,auth:AuthContext){const value=cookieValue(request.headers.cookie,CSRF_COOKIE);return value&&digest(value)===auth.csrfHash?value:null;}
  async authenticate(request: FastifyRequest, optional = false): Promise<AuthContext | null> {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    if (!token) { if (optional) return null; throw new AppError('UNAUTHENTICATED', 'Authentication required', 401); }
    const result = await this.db.query<AccountRow & { session_id: string; expires_at: Date; csrf_token_hash: string }>(`SELECT a.id,a.username_canonical,a.display_name,a.role,a.status,s.id session_id,s.expires_at,s.csrf_token_hash FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, [digest(token)]);
    const row = result.rows[0];
    if (!row || row.status !== 'active') { if (optional) return null; throw new AppError('UNAUTHENTICATED', 'Session is invalid or expired', 401); }
    return { sessionId: row.session_id, account: publicAccount(row), expiresAt: row.expires_at, csrfHash: row.csrf_token_hash, tokenHash: digest(token) };
  }
  assertCsrf(request: FastifyRequest, auth: AuthContext) {
    const raw = request.headers['x-csrf-token']; const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw new AppError('FORBIDDEN', 'CSRF token is required', 403);
    const a = Buffer.from(digest(value)); const b = Buffer.from(auth.csrfHash); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('FORBIDDEN', 'CSRF token is invalid', 403);
  }
  async logout(auth: AuthContext | null) { if (!auth) return; await this.db.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1', [auth.sessionId]); for (const listener of this.revokedListeners) listener(auth.account.id, auth.sessionId); }
  async revokeAccount(accountId: string) { await this.db.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1', [accountId]); for (const listener of this.revokedListeners) listener(accountId); }
  close() { this.closed = true; clearInterval(this.cleanupTimer); if (this.notificationRetry) clearTimeout(this.notificationRetry); this.notificationClient?.release(); this.notificationClient = undefined; }
}

export async function createAccount(db: Database, input: { username: string; displayName: string; password: string; role: AccountPublic['role'] }) {
  const username = usernameSchema.parse(input.username).toLowerCase(); const displayName = displayNameSchema.parse(input.displayName); const password = passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(password); const id = randomUUID();
  await db.query('INSERT INTO accounts(id,username_canonical,display_name,password_hash,role,status) VALUES($1,$2,$3,$4,$5,\'active\')', [id, username, displayName, passwordHash, input.role]);
  return id;
}
