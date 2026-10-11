import type { AccountPublic, SessionPublic } from '@boardgame/protocol';

// Synthetic, complete public DTO; contains no real session or account credentials.
export function sessionFixture(account: Partial<AccountPublic> = {}): SessionPublic {
  return {
    account: {
      id: '10000000-0000-4000-8000-000000000001',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
      status: 'active',
      ...account,
    },
    csrfToken: 'fixture-csrf',
    expiresAt: '2099-10-06T00:00:00.000Z',
  };
}
