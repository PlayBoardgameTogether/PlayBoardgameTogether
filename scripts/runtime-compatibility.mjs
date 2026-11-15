import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

function incompatible() {
  return Object.assign(new Error('Installed game packages require a compatible runtime'), {
    code: 'RUNTIME_INCOMPATIBLE',
    reason: 'readiness',
  });
}

export async function releaseCapabilities(path) {
  let value;
  try {
    value = JSON.parse(await readFile(resolve(path, 'runtime-capabilities.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw incompatible();
  }
  if (
    value?.format !== 1 ||
    Object.keys(value).sort().join(',') !== 'format,packagePublicResults' ||
    !Array.isArray(value.packagePublicResults) ||
    value.packagePublicResults.some((contract) => contract !== 'winners-scores-v1') ||
    new Set(value.packagePublicResults).size !== value.packagePublicResults.length
  )
    throw incompatible();
  return value.packagePublicResults;
}

export async function requiredCapabilities(client) {
  // Also works before migration 039 without selecting a missing column or
  // reading every package's potentially large rules/HTML into JSON.
  // Include disabled versions: they remain necessary for locked matches/replays.
  const exists = await client.query(
    `SELECT 1 FROM pg_attribute
     WHERE attrelid=to_regclass('public.game_packages')
       AND attname='public_result_contract' AND NOT attisdropped`,
  );
  if (!exists.rowCount) return [];
  const result = await client.query(`
    SELECT DISTINCT public_result_contract AS contract
    FROM public.game_packages WHERE public_result_contract IS NOT NULL
  `);
  return result.rows.map((row) => row.contract);
}

export async function assertReleaseCompatibility(path, env) {
  const supported = await releaseCapabilities(path);
  let client;
  try {
    if (!env.DATABASE_URL) throw incompatible();
    client = new pg.Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
    });
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const required = await requiredCapabilities(client);
    if (required.some((contract) => !supported.includes(contract))) throw incompatible();
    await client.query('COMMIT');
  } catch {
    // No database URI, raw SQL diagnostics or candidate metadata in errors/logs.
    throw incompatible();
  } finally {
    await client?.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertReleaseCompatibility(resolve(process.argv[2] || '.'), process.env).then(
    () => console.log('[runtime-compatibility] compatible'),
    () => {
      console.error(
        '[runtime-compatibility] blocked; check database access and release capabilities',
      );
      process.exitCode = 1;
    },
  );
}
