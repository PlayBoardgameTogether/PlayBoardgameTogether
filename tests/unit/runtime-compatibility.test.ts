import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertReleaseCompatibility,
  releaseCapabilities,
} from '../../scripts/runtime-compatibility.mjs';

describe('release runtime capability metadata', () => {
  let path: string;
  beforeEach(async () => {
    path = await mkdtemp(join(tmpdir(), 'playboard-capabilities-'));
  });
  afterEach(async () => {
    await rm(path, { recursive: true, force: true });
  });

  it('treats a legacy release without metadata as supporting no optional contracts', async () => {
    expect(await releaseCapabilities(path)).toEqual([]);
  });

  it('reads the explicit supported contract without inferring from a platform version', async () => {
    await writeFile(
      join(path, 'runtime-capabilities.json'),
      JSON.stringify({
        format: 1,
        packagePublicResults: ['winners-scores-v1'],
      }),
    );
    expect(await releaseCapabilities(path)).toEqual(['winners-scores-v1']);
  });

  it.each([undefined, 'postgresql://user:private-password@%%%/private-db'])(
    'refuses missing or malformed database configuration without leaking connection details',
    async (DATABASE_URL) => {
      const result = assertReleaseCompatibility(path, { DATABASE_URL });
      await expect(result).rejects.toMatchObject({ code: 'RUNTIME_INCOMPATIBLE' });
      await result.catch((error: Error) => expect(error.message).not.toContain('private'));
    },
  );

  it.each([
    'secret=private',
    'null',
    JSON.stringify({ format: 2, packagePublicResults: [] }),
    JSON.stringify({ format: 1, packagePublicResults: ['unknown-private-contract'] }),
    JSON.stringify({ format: 1, packagePublicResults: ['winners-scores-v1', 'winners-scores-v1'] }),
    JSON.stringify({ format: 1, packagePublicResults: [], private: 'secret' }),
  ])('fails closed on malformed metadata without exposing its contents: %s', async (value) => {
    await writeFile(join(path, 'runtime-capabilities.json'), value);
    await expect(releaseCapabilities(path)).rejects.toMatchObject({ code: 'RUNTIME_INCOMPATIBLE' });
    await releaseCapabilities(path).catch((error: Error) => {
      expect(error.message).not.toContain('private');
      expect(error.message).not.toContain('secret');
    });
  });
});
