import { createDatabase } from '../../apps/api/src/db/index.js';
import { createAccount } from '../../apps/api/src/auth.js';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required');
  const db = createDatabase(url);
  try {
    await db.query('TRUNCATE accounts CASCADE');
    await db.query('TRUNCATE registration_email_challenges');
    await db.query('TRUNCATE registration_mail_settings');
    await db.query('UPDATE registration_mail_test_limit SET requested_at=NULL');
    await db.query('UPDATE game_installations SET enabled=true');
    await db.query('UPDATE social_settings SET friend_id_change_days=30,revision=1');
    for (const [username, displayName] of [
      ['stage2_a', '玩家 A'], ['stage2_b', '玩家 B'], ['stage2_c', '玩家 C'],
      ['stage3_a', '玩家 D'], ['stage3_b', '玩家 E'],
    ] as const) {
      await createAccount(db, { username, displayName, password: 'stage two password', role: 'user' });
    }
    await createAccount(db, {
      username: 'stage7_admin', displayName: '资源管理员',
      password: 'stage two password', role: 'administrator',
    });
  } finally {
    await db.end();
  }
}
