import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { modelProfileInputSchema, modelProfileUpdateSchema } from '@boardgame/protocol';
import type { PoolClient } from 'pg';
import type { Database } from './db/index.js';
import { AppError } from './errors.js';
import { type ModelAdapter, MockModelAdapter, OpenAiChatAdapter, parseModelChoice, resolvePublicHttpsTarget } from './model-ai.js';

type ProfileRow = { id: string; endpoint_id: string; credential_id: string | null; has_credential: boolean; profile_version: number; base_url: string };
type CredentialRow = { endpoint_id: string; nonce: Buffer | null; auth_tag: Buffer | null; ciphertext: Buffer | null };

export class ModelProfileService {
  private readonly key: Buffer | null;

  constructor(private db: Database, secret: string | undefined) {
    const decoded = secret ? Buffer.from(secret, 'base64') : null;
    this.key = decoded?.length === 32 ? decoded : null;
  }

  settingsStatus() { return { credentialsAvailable: this.key !== null }; }

  async endpoints() {
    const result = await this.db.query<{ id: string; display_name: string; protocol: string }>(
      "SELECT id,display_name,protocol FROM provider_endpoints WHERE enabled=true AND capabilities->>'ownerAccountId' IS NULL AND capabilities->>'internal' IS NULL ORDER BY id",
    );
    return result.rows.map(row => ({ id: row.id, name: row.display_name, protocol: row.protocol }));
  }

  async list(owner: string) {
    return (await this.db.query(`SELECT p.id,p.name,p.endpoint_id,e.base_url,p.model_id,p.parameters,p.enabled,
      p.credential_id IS NOT NULL AND c.revoked_at IS NULL AS has_credential,
      COALESCE(v.version,0) AS profile_version FROM model_profiles p
      JOIN provider_endpoints e ON e.id=p.endpoint_id LEFT JOIN model_credentials c ON c.id=p.credential_id
      LEFT JOIN LATERAL(SELECT version FROM model_profile_versions WHERE profile_id=p.id ORDER BY version DESC LIMIT 1)v ON true
      WHERE p.owner_account_id=$1 AND p.deleted_at IS NULL AND p.official_offer_id IS NULL ORDER BY p.created_at`, [owner])).rows;
  }

  private requireEncryption() {
    if (!this.key) throw new AppError('SERVICE_UNAVAILABLE', '模型凭证加密尚未配置，请联系管理员配置后再保存 API key', 503);
    return this.key;
  }

  private async lockedProfile(client: PoolClient, owner: string, id: string) {
    z.string().uuid().parse(id);
    const result = await client.query<ProfileRow>(`SELECT p.id,p.endpoint_id,p.credential_id,e.base_url,
      p.credential_id IS NOT NULL AND c.revoked_at IS NULL AS has_credential,
      (SELECT max(version) FROM model_profile_versions WHERE profile_id=p.id) AS profile_version
      FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id
      LEFT JOIN model_credentials c ON c.id=p.credential_id
      WHERE p.id=$1 AND p.owner_account_id=$2 AND p.deleted_at IS NULL AND p.official_offer_id IS NULL FOR UPDATE OF p`, [id, owner]);
    if (!result.rows[0]) throw new AppError('FORBIDDEN', '模型配置不存在或已删除', 404);
    return result.rows[0];
  }

  private async revoke(client: PoolClient, credentialId: string | null) {
    if (credentialId) await client.query('UPDATE model_credentials SET revoked_at=now(),authorization_version=authorization_version+1 WHERE id=$1 AND revoked_at IS NULL', [credentialId]);
  }

  private async assertNotInUse(client: PoolClient, id: string) {
    if ((await client.query('SELECT 1 FROM official_ai_offers WHERE source_profile_id=$1', [id])).rowCount)
      throw new AppError('STATE_CONFLICT', '此配置已用于官方 AI，不能编辑或删除；请创建新配置发布新档位。密钥仍可轮换或撤销。', 409);
    const active = await client.query(`SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id
      WHERE p.model_profile_id=$1 AND p.controller_type='model' AND m.status='active' LIMIT 1`, [id]);
    if (active.rowCount) throw new AppError('STATE_CONFLICT', '此配置正在用于模型托管或模型 AI，请先收回本人控制或结束对局，再编辑或删除', 409);
  }

  private async writeCredential(client: PoolClient, owner: string, profileId: string, endpointId: string, apiKey: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireEncryption(), nonce);
    cipher.setAAD(Buffer.from(`${owner}:${profileId}:${endpointId}`));
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const id = randomUUID();
    await client.query(`INSERT INTO model_credentials(id,owner_account_id,endpoint_id,ciphertext,nonce,auth_tag,key_version)
      VALUES($1,$2,$3,$4,$5,$6,'v1')`, [id, owner, endpointId, ciphertext, nonce, cipher.getAuthTag()]);
    return id;
  }

  async save(owner: string, raw: unknown, profileId?: string) {
    const parsed = profileId ? modelProfileUpdateSchema.parse(raw) : modelProfileInputSchema.parse(raw);
    const { apiKey, ...body } = modelProfileInputSchema.parse({
      name: parsed.name, endpointId: parsed.endpointId, baseUrl: parsed.baseUrl,
      modelId: parsed.modelId, parameters: parsed.parameters, enabled: parsed.enabled, apiKey: parsed.apiKey,
    });
    if (apiKey) this.requireEncryption();
    const target = body.endpointId === 'custom'
      ? await resolvePublicHttpsTarget(body.baseUrl ?? '') : undefined;
    const id = profileId ?? randomUUID();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const previous = profileId ? await this.lockedProfile(client, owner, id) : undefined;
      if (previous) await this.assertNotInUse(client, id);
      if (previous && 'expectedVersion' in parsed && previous.profile_version !== parsed.expectedVersion) {
        throw new AppError('STATE_CONFLICT', '配置已在其他页面修改，请刷新后重新编辑', 409);
      }
      let endpointId = body.endpointId;
      let protocol: string;
      if (target) {
        protocol = 'openai-chat-completions';
        if (previous?.endpoint_id.startsWith('custom-') && previous.base_url === target.url.toString()) {
          endpointId = previous.endpoint_id;
        } else {
          endpointId = `custom-${randomUUID()}`;
          await client.query(`INSERT INTO provider_endpoints(id,display_name,protocol,base_url,capabilities)
            VALUES($1,$2,'openai-chat-completions',$3,$4)`, [endpointId, body.name, target.url.toString(), { ownerAccountId: owner }]);
        }
      } else {
        const endpoint = await client.query<{ protocol: string }>(`SELECT protocol FROM provider_endpoints WHERE id=$1 AND enabled=true
          AND capabilities->>'internal' IS NULL
          AND (capabilities->>'ownerAccountId' IS NULL OR capabilities->>'ownerAccountId'=$2)`, [endpointId, owner]);
        if (!endpoint.rows[0]) throw new AppError('VALIDATION_ERROR', '不允许使用此模型服务端点', 400);
        protocol = endpoint.rows[0].protocol;
      }
      const endpointChanged = previous !== undefined && previous.endpoint_id !== endpointId;
      if (endpointChanged && protocol !== 'mock' && !apiKey) {
        throw new AppError('VALIDATION_ERROR', '更换服务地址后请重新填写 API key', 400);
      }
      let credentialId = previous?.credential_id ?? null;
      if (apiKey || endpointChanged) {
        await this.revoke(client, credentialId);
        credentialId = apiKey && protocol !== 'mock' ? await this.writeCredential(client, owner, id, endpointId, apiKey) : null;
      }
      const version = (previous?.profile_version ?? 0) + 1;
      if (previous) {
        await client.query(`UPDATE model_profiles SET name=$3,endpoint_id=$4,model_id=$5,parameters=$6,enabled=$7,credential_id=$8,updated_at=now()
          WHERE id=$1 AND owner_account_id=$2`, [id, owner, body.name, endpointId, body.modelId, body.parameters, body.enabled, credentialId]);
      } else {
        await client.query(`INSERT INTO model_profiles(id,owner_account_id,name,endpoint_id,model_id,parameters,enabled,credential_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, owner, body.name, endpointId, body.modelId, body.parameters, body.enabled, credentialId]);
      }
      await client.query('INSERT INTO model_profile_versions(profile_id,version,snapshot) VALUES($1,$2,$3)',
        [id, version, { ...body, endpointId, profileVersion: version }]);
      await client.query('COMMIT');
      return { id, profileVersion: version };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async remove(owner: string, id: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const profile = await this.lockedProfile(client, owner, id);
      await this.assertNotInUse(client, id);
      await this.revoke(client, profile.credential_id);
      await client.query('UPDATE model_profiles SET deleted_at=now(),enabled=false,updated_at=now() WHERE id=$1', [id]);
      await client.query('COMMIT');
      return { deleted: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async replaceCredential(owner: string, id: string, raw: unknown) {
    const { apiKey } = z.object({ apiKey: z.string().trim().min(8).max(4096) }).strict().parse(raw);
    this.requireEncryption();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const profile = await this.lockedProfile(client, owner, id);
      const credentialId = await this.writeCredential(client, owner, id, profile.endpoint_id, apiKey);
      await this.revoke(client, profile.credential_id);
      await client.query('UPDATE model_profiles SET credential_id=$2,updated_at=now() WHERE id=$1', [id, credentialId]);
      await client.query('COMMIT');
      return { hasCredential: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async revokeCredential(owner: string, id: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const profile = await this.lockedProfile(client, owner, id);
      await this.revoke(client, profile.credential_id);
      await client.query('COMMIT');
      return { revoked: profile.has_credential };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async test(owner: string, id: string) {
    z.string().uuid().parse(id);
    const result = await this.db.query<CredentialRow & { model_id: string; protocol: string; base_url: string; profile_version: number }>(
      `SELECT p.model_id,p.endpoint_id,e.protocol,e.base_url,c.nonce,c.auth_tag,c.ciphertext,
      (SELECT max(version) FROM model_profile_versions WHERE profile_id=p.id) AS profile_version
      FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id
      LEFT JOIN model_credentials c ON c.id=p.credential_id AND c.revoked_at IS NULL
      WHERE p.id=$1 AND p.owner_account_id=$2 AND p.deleted_at IS NULL AND p.official_offer_id IS NULL AND p.enabled AND e.enabled`, [id, owner]);
    const profile = result.rows[0];
    if (!profile) throw new AppError('FORBIDDEN', '模型配置不存在、已删除或已停用', 404);
    // Read endpoint, model, version and encrypted credential in one database snapshot.
    // An edit racing a test must never send the new endpoint's key to the old endpoint.
    const apiKey = profile.protocol === 'mock' ? 'mock' : this.decryptValue(owner, id, profile);
    const attemptId = randomUUID();
    await this.db.query(`INSERT INTO model_attempts(id,owner_account_id,profile_id,profile_version,purpose,status)
      VALUES($1,$2,$3,$4,'test','dispatching')`, [attemptId, owner, id, profile.profile_version]);
    const started = Date.now();
    try {
      const adapter: ModelAdapter = profile.protocol === 'mock' ? new MockModelAdapter() : new OpenAiChatAdapter();
      const reply = await adapter.decide({ endpoint: profile.base_url, model: profile.model_id, apiKey,
        decisionId: 'connection-test', rules: '只返回连接测试 JSON。', view: { test: true },
        choices: [{ id: 'ok', description: '连接测试' }], timeoutMs: 30000 }, new AbortController().signal);
      parseModelChoice(reply.raw, 'connection-test', new Set(['ok']));
      await this.db.query(`UPDATE model_attempts SET status='completed',provider_request_id=$2,returned_model_id=$3,
        input_tokens=$4,output_tokens=$5,latency_ms=$6,finished_at=now() WHERE id=$1`,
      [attemptId, reply.requestId ?? null, reply.model ?? null, reply.inputTokens, reply.outputTokens, Date.now() - started]);
      return { attemptId, status: 'completed', kind: adapter.kind };
    } catch (error) {
      await this.db.query(`UPDATE model_attempts SET status='failed',safe_error_code=$2,latency_ms=$3,finished_at=now() WHERE id=$1`,
        [attemptId, error instanceof AppError ? error.code : 'AI_PROVIDER_FAILED', Date.now() - started]);
      throw error;
    }
  }

  async decryptCredential(owner: string, id: string) {
    const result = await this.db.query<CredentialRow>(
      `SELECT c.endpoint_id,c.nonce,c.auth_tag,c.ciphertext FROM model_credentials c JOIN model_profiles p ON p.credential_id=c.id
      WHERE p.id=$1 AND p.owner_account_id=$2 AND p.deleted_at IS NULL AND p.enabled AND c.revoked_at IS NULL`, [id, owner]);
    return this.decryptValue(owner, id, result.rows[0]);
  }

  private decryptValue(owner: string, id: string, value: CredentialRow | undefined) {
    const key = this.requireEncryption();
    if (!value?.nonce || !value.auth_tag || !value.ciphertext) throw new AppError('FORBIDDEN', '未配置有效 API key，请编辑配置并重新保存密钥', 403);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, value.nonce);
      decipher.setAAD(Buffer.from(`${owner}:${id}:${value.endpoint_id}`));
      decipher.setAuthTag(value.auth_tag);
      return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
    } catch { throw new AppError('SERVICE_UNAVAILABLE', '已保存密钥无法解密，请编辑配置并重新保存 API key', 503); }
  }
}
