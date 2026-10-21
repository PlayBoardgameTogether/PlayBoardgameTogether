import { z } from 'zod';
import { personalMatchResultSchema } from './match-result.js';

export const avatarSchema = z.enum(['dice', 'leaf', 'cat', 'rocket', 'star', 'coffee']);
export const profileInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(32),
    avatar: avatarSchema,
    bio: z.string().trim().max(300),
  })
  .strict();
export const profileSchema = profileInputSchema.extend({
  id: z.string().uuid(),
  username: z.string(),
  createdAt: z.string().datetime(),
});
export const matchHistoryQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    gameId: z.string().min(1).max(128).optional(),
  })
  .strict();
export const matchHistorySchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      gameId: z.string(),
      gameVersion: z.string(),
      roomName: z.string(),
      status: z.enum(['active', 'finished', 'aborted']),
      createdAt: z.string().datetime(),
      result: personalMatchResultSchema.nullable().optional(),
    }),
  ),
  nextCursor: z.string().uuid().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput = z.infer<typeof profileInputSchema>;
export type MatchHistory = z.infer<typeof matchHistorySchema>;
