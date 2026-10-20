import {
  profileSchema,
  matchHistorySchema,
  matchResultSchema,
  type ProfileInput,
} from '@boardgame/protocol';
import type { Database } from './db/index.js';

type ProfileRow = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  createdAt: Date;
};
type HistoryRow = {
  id: string;
  gameId: string;
  gameVersion: string;
  roomName: string;
  status: string;
  createdAt: Date;
  seatId: string;
  summary: unknown;
};

export class ProfileService {
  constructor(private db: Database) {}

  async get(accountId: string) {
    const result = await this.db.query<ProfileRow>(
      `SELECT id, username_canonical AS username, display_name AS "displayName",
        avatar, bio, created_at AS "createdAt" FROM accounts WHERE id=$1`,
      [accountId],
    );
    const row = result.rows[0]!;
    return profileSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
  }

  async save(accountId: string, input: ProfileInput) {
    const result = await this.db.query<ProfileRow>(
      `UPDATE accounts SET display_name=$2, avatar=$3, bio=$4 WHERE id=$1
        RETURNING id, username_canonical AS username, display_name AS "displayName",
        avatar, bio, created_at AS "createdAt"`,
      [accountId, input.displayName, input.avatar, input.bio],
    );
    const row = result.rows[0]!;
    return profileSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
  }

  async history(accountId: string, before?: string, gameId?: string) {
    // One statement keeps membership, cursor and metadata on the same snapshot.
    // The cursor must also belong to this account; no cross-account lookup leaks.
    const result = await this.db.query<HistoryRow>(
      `SELECT m.id, m.game_id AS "gameId", m.game_version AS "gameVersion",
        r.name AS "roomName", m.status, m.created_at AS "createdAt",
        p.seat_id AS "seatId", m.result_summary AS summary
       FROM match_participants p JOIN matches m ON m.id=p.match_id
       JOIN rooms r ON r.id=m.room_id
       WHERE p.account_id=$1 AND ($3::text IS NULL OR m.game_id=$3) AND ($2::uuid IS NULL OR (m.created_at,m.id) < (
         SELECT c.created_at,c.id FROM matches c JOIN match_participants cp ON cp.match_id=c.id
         WHERE c.id=$2 AND cp.account_id=$1 AND ($3::text IS NULL OR c.game_id=$3)))
       ORDER BY m.created_at DESC,m.id DESC LIMIT 21`,
      [accountId, before ?? null, gameId ?? null],
    );
    const items = result.rows.slice(0, 20).map(({ seatId, summary, ...row }) => {
      const parsed = row.status === 'finished' ? matchResultSchema.safeParse(summary) : null;
      const players = parsed?.success ? parsed.data.players : [];
      const own = players.find((item) => item.seatId === seatId);
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        result: own
          ? {
              winner: own.winner,
              sharedWin: own.winner && players.filter((item) => item.winner).length > 1,
              ...(own.score === undefined ? {} : { score: own.score }),
            }
          : null,
      };
    });
    return matchHistorySchema.parse({
      items,
      nextCursor: result.rows.length > 20 ? items.at(-1)?.id : null,
    });
  }
}
