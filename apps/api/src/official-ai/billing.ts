import { aiPointBillsSchema } from '@boardgame/protocol';
import type { Database } from '../db/index.js';

// Always prefer the settled snapshot: a late provider report must not reprice history.
export const ledgerUsageJoin = `
  LEFT JOIN official_ai_reservations r ON r.ledger_id=l.id AND r.account_id=l.account_id
  LEFT JOIN model_attempts a ON a.id=r.attempt_id`;
export const ledgerInputTokens = `COALESCE((l.token_billing->>'inputTokens')::bigint,a.input_tokens)`;
export const ledgerOutputTokens = `COALESCE((l.token_billing->>'outputTokens')::bigint,a.output_tokens)`;

export async function readPointBills(db: Database, accountId: string, before?: string) {
  // Group before paginating, in one statement/snapshot, so long matches are never split.
  const rows = (
    await db.query(
      `
    WITH entries AS (
      SELECT l.*,${ledgerInputTokens} AS input_tokens,${ledgerOutputTokens} AS output_tokens
      FROM ai_point_ledger l ${ledgerUsageJoin} WHERE l.account_id=$1
    ), grouped AS (
      SELECT *,
        sum(delta) OVER bill AS total_delta,
        count(*) FILTER (WHERE kind='action') OVER bill AS action_count,
        COALESCE(sum(input_tokens) OVER bill,0) AS total_input,
        COALESCE(sum(output_tokens) OVER bill,0) AS total_output,
        count(*) FILTER (WHERE kind='action' AND (input_tokens IS NULL OR output_tokens IS NULL))
          OVER bill AS missing_usage,
        row_number() OVER (PARTITION BY kind,COALESCE(match_id,id) ORDER BY created_at DESC,id DESC) AS position
      FROM entries WINDOW bill AS (PARTITION BY kind,COALESCE(match_id,id))
    )
    SELECT g.id,g.kind,g.match_id AS "matchId",g.note,g.total_delta::float8 AS delta,
      g.action_count::int AS "actionCount",g.total_input::float8 AS "inputTokens",
      g.total_output::float8 AS "outputTokens",g.missing_usage::int AS "missingUsageCount",
      CASE WHEN m.id IS NOT NULL THEN COALESCE(i.manifest->>'name',m.game_id) END AS "gameName",
      g.created_at
    FROM grouped g LEFT JOIN matches m ON m.id=g.match_id
    LEFT JOIN game_installations i ON i.game_id=m.game_id AND i.game_version=m.game_version
    WHERE g.position=1 AND ($2::uuid IS NULL OR (g.created_at,g.id)<
      (SELECT created_at,id FROM entries WHERE id=$2))
    ORDER BY g.created_at DESC,g.id DESC LIMIT 21`,
      [accountId, before ?? null],
    )
  ).rows;
  const items = rows.slice(0, 20).map((row) => ({
    ...row,
    createdAt: (row.created_at as Date).toISOString(),
  }));
  return aiPointBillsSchema.parse({
    items,
    nextCursor: rows.length > 20 ? items.at(-1)!.id : null,
  });
}
