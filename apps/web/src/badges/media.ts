import { z } from 'zod';
import { badgeIdSchema, type Badge } from '@boardgame/protocol';

// Only repository-managed, same-origin assets; this is not an upload endpoint.
const modelPath = z.string().regex(/^\/badges\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.glb$/);
const posterPath = z
  .string()
  .regex(/^\/badges\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|webp)$/);
export const badgeMediaSchema = z.partialRecord(
  badgeIdSchema,
  z.object({ model: modelPath.optional(), poster: posterPath.optional() }).strict(),
);
export type BadgeMedia = z.infer<typeof badgeMediaSchema>[Badge['id']];

let media: Promise<z.infer<typeof badgeMediaSchema>> | undefined;
export function loadBadgeMedia() {
  media ??= fetch('/badges/manifest.json', { credentials: 'omit' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Badge media unavailable');
      const value: unknown = await response.json();
      return badgeMediaSchema.parse(value);
    })
    .catch(() => ({}));
  return media;
}
