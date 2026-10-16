import type pg from 'pg';
import {
  coinLedgerEntrySchema,
  coinWalletPageSchema,
  coinWalletSchema,
  type CoinAdjustment,
} from '@boardgame/protocol';
import type { Database } from '../db/index.js';
import { AppError } from '../errors.js';

export class CoinService {
  constructor(private db: Database) {}

  async wallet(accountId: string, before?: number) {
    // Balance and history share one statement snapshot, including first writes.
    const result = await this.db.query<{
      accountId: string;
      displayName: string;
      balance: number;
      revision: number;
      entries: unknown[];
    }>(
      `SELECT a.id AS "accountId", a.display_name AS "displayName",
      COALESCE(w.balance,0) AS balance, COALESCE(w.revision,0) AS revision,
      COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.revision DESC) FROM (
        SELECT id,revision,delta,balance_after AS "balanceAfter",reason,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
        FROM boardgame_coin_ledger WHERE account_id=a.id
          AND ($2::integer IS NULL OR revision<$2)
        ORDER BY revision DESC LIMIT 21
      ) e),'[]'::jsonb) AS entries
      FROM accounts a LEFT JOIN boardgame_coin_wallets w ON w.account_id=a.id
      WHERE a.id=$1`,
      [accountId, before ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('VALIDATION_ERROR', '账户不存在', 404);
    const entries = row.entries.slice(0, 20).map((entry) => coinLedgerEntrySchema.parse(entry));
    return coinWalletPageSchema.parse({
      ...row,
      entries,
      nextCursor: row.entries.length > 20 ? entries.at(-1)!.revision : null,
    });
  }

  // The administrator command owns authorization, deduplication, receipt and commit.
  async adjust(client: pg.PoolClient, actorId: string, accountId: string, input: CoinAdjustment) {
    const account = await client.query<{ display_name: string }>(
      'SELECT display_name FROM accounts WHERE id=$1 FOR SHARE',
      [accountId],
    );
    if (!account.rowCount) throw new AppError('VALIDATION_ERROR', '账户不存在', 404);
    await client.query(
      'INSERT INTO boardgame_coin_wallets(account_id) VALUES($1) ON CONFLICT DO NOTHING',
      [accountId],
    );
    const found = await client.query<{ balance: number; revision: number }>(
      'SELECT balance,revision FROM boardgame_coin_wallets WHERE account_id=$1 FOR UPDATE',
      [accountId],
    );
    const wallet = found.rows[0]!;
    if (wallet.revision !== input.expectedRevision)
      throw new AppError('STATE_CONFLICT', '钱包已变化，请刷新后重新决定', 409);
    const balance = wallet.balance + input.delta;
    if (balance < 0) throw new AppError('ACTION_NOT_ALLOWED', '桌游币余额不足，无法扣回', 422);
    if (balance > 1_000_000_000 || wallet.revision === 2_147_483_647)
      throw new AppError('ACTION_NOT_ALLOWED', '桌游币钱包已达上限', 422);
    const revision = wallet.revision + 1;
    await client.query(
      'UPDATE boardgame_coin_wallets SET balance=$2,revision=$3 WHERE account_id=$1',
      [accountId, balance, revision],
    );
    await client.query(
      `INSERT INTO boardgame_coin_ledger
      (account_id,revision,delta,balance_after,reason,actor_account_id,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [accountId, revision, input.delta, balance, input.reason, actorId, input.requestId],
    );
    return coinWalletSchema.parse({
      accountId,
      displayName: account.rows[0]!.display_name,
      balance,
      revision,
    });
  }
}
