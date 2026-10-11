import { z } from 'zod';
import { avatarSchema } from './profile.js';

export const friendIdSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,36}$/);
export const friendIdInputValueSchema = z.string().trim()
  .transform(value => value.replace(/^@/, ''))
  .pipe(friendIdSchema);
export const formatFriendId = (value: string) => `@${value}`;
export const socialPersonSchema = z.object({
  id: z.string().uuid(), friendId: friendIdSchema,
  displayName: z.string(), avatar: avatarSchema,
});
export const socialIdentitySchema = z.object({
  friendId: friendIdSchema, revision: z.number().int().positive(),
  changeIntervalDays: z.number().int().min(0).max(3650),
  nextChangeAt: z.string().datetime().nullable(),
  canChange: z.boolean(),
});
export const socialSettingsSchema = z.object({
  friendIdChangeDays: z.number().int().min(0).max(3650),
  revision: z.number().int().positive(),
}).strict();
export const socialSettingsInputSchema = socialSettingsSchema.omit({ revision: true }).extend({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
}).strict();
export type SocialSettingsInput = z.infer<typeof socialSettingsInputSchema>;
export const socialRequestSchema = z.object({ requestId: z.string().uuid() }).strict();
export const friendIdInputSchema = socialRequestSchema.extend({
  friendId: friendIdInputValueSchema, expectedRevision: z.number().int().positive(),
}).strict();
export const friendRequestInputSchema = socialRequestSchema.extend({
  friendId: friendIdInputValueSchema, expectedAccountId: z.string().uuid().optional(),
}).strict();
export type FriendRequestInput = z.infer<typeof friendRequestInputSchema>;
export const friendshipCommandSchema = socialRequestSchema.extend({
  action: z.enum(['accept', 'reject', 'cancel', 'remove']), expectedRevision: z.number().int().positive(),
}).strict();
export const friendshipSchema = z.object({
  person: socialPersonSchema, status: z.enum(['pending', 'accepted', 'rejected', 'removed']),
  direction: z.enum(['incoming', 'outgoing']), revision: z.number().int().positive(),
  unread: z.number().int().nonnegative(),
});
export const socialMessageSchema = z.object({
  id: z.string().uuid(), sequence: z.string().regex(/^[1-9][0-9]*$/), senderId: z.string().uuid(), text: z.string(), createdAt: z.string().datetime(),
});
export const messageInputSchema = socialRequestSchema.extend({ text: z.string().trim().min(1).max(2000) }).strict();
export const socialPageQuerySchema = z.object({ before: z.string().uuid().optional(), after: z.string().uuid().optional() }).strict()
  .refine(value => !(value.before && value.after));
export const messagePageSchema = z.object({ items: socialMessageSchema.array(), nextCursor: z.string().uuid().nullable() });
export const publicMessageSchema = socialMessageSchema.extend({ sender: socialPersonSchema });
export const publicMessagePageSchema = z.object({ items: publicMessageSchema.array(), nextCursor: z.string().uuid().nullable() });
export type PublicMessage = z.infer<typeof publicMessageSchema>;
export const readMessagesInputSchema = socialRequestSchema.extend({ messageId: z.string().uuid() }).strict();
export const friendInviteInputSchema = socialRequestSchema.extend({
  friendAccountId: z.string().uuid(), expectedRoomRevision: z.number().int().nonnegative(),
}).strict();
export const friendInviteCommandSchema = socialRequestSchema.extend({
  action: z.enum(['accept', 'reject']), password: z.string().min(1).max(128).optional(),
}).strict();
export const friendInviteSchema = z.object({
  id: z.string().uuid(), sender: socialPersonSchema, recipient: socialPersonSchema,
  roomId: z.string().uuid(), roomName: z.string(), hasPassword: z.boolean(),
  status: z.enum(['pending', 'accepted', 'rejected']), expiresAt: z.string().datetime(),
  available: z.boolean(),
});
export const socialOverviewSchema = z.object({
  identity: socialIdentitySchema, friends: friendshipSchema.array(), requests: friendshipSchema.array(),
  invitations: friendInviteSchema.array(),
});
export const socialUpdatesQuerySchema = z
  .object({ version: z.string().regex(/^[a-f0-9]{64}$/).optional() })
  .strict();
export const socialUpdatesSchema = z.discriminatedUnion('changed', [
  z.object({ changed: z.literal(false), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({
    changed: z.literal(true),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    overview: socialOverviewSchema,
  }).strict(),
]);
export const socialDoneSchema = z.object({ done: z.literal(true) });
export type SocialPerson = z.infer<typeof socialPersonSchema>;
export type SocialOverview = z.infer<typeof socialOverviewSchema>;
export type SocialMessage = z.infer<typeof socialMessageSchema>;
export type FriendshipCommand = z.infer<typeof friendshipCommandSchema>;
export type FriendInviteCommand = z.infer<typeof friendInviteCommandSchema>;
