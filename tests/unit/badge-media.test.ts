import { describe, expect, it } from 'vitest';
import { badgeMediaSchema } from '../../apps/web/src/badges/media.js';

describe('optional badge media', () => {
  it('supports no artwork, poster only and selected models', () => {
    expect(badgeMediaSchema.parse({})).toEqual({});
    expect(
      badgeMediaSchema.parse({
        welcome: { poster: '/badges/welcome/cover.webp' },
        contributor: { model: '/badges/contributor/model.glb' },
      }),
    ).toHaveProperty('contributor.model', '/badges/contributor/model.glb');
  });

  it.each([
    { welcome: { model: 'https://example.com/model.glb' } },
    { welcome: { model: '/badges/../private.glb' } },
    { welcome: { model: '/badges/test.gltf' } },
    { welcome: { poster: '/badges/test.svg' } },
    { unknown: { model: '/badges/test.glb' } },
  ])('rejects unapproved assets: %j', (value) => {
    expect(badgeMediaSchema.safeParse(value).success).toBe(false);
  });
});
