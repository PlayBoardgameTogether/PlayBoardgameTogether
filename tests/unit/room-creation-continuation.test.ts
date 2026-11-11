import { describe, expect, it } from 'vitest';
import { roomCreationContinuation } from '../../apps/web/src/auth/room-creation.js';

describe('creation continuation through authentication', () => {
  it('keeps only an exact creation route, dropping unrelated or secret state', () => {
    for (const roomCreationPath of ['/rooms/new', '/games/online.uno/1.2.0/new']) {
      expect(roomCreationContinuation({ roomCreationPath, password: 'discard-me' })).toEqual({
        roomCreationPath,
      });
    }
  });

  it('rejects arbitrary redirects, path traversal and credential-bearing URLs', () => {
    for (const roomCreationPath of [
      'https://example.com/games/uno/1/new',
      '//example.com/rooms/new',
      '/games/../1/new',
      '/games/uno/../new',
      '/games/%2e%2e/1/new',
      '/rooms/new?inviteCode=secret',
      '/rooms/new#secret',
      '/admin/accounts',
      '/games/uno/1/new/../../admin',
      '/games/uno/1/new\n',
      '/games/uno/1/new?next=//example.com',
    ]) {
      expect(roomCreationContinuation({ roomCreationPath })).toBeUndefined();
    }
  });

  it('ignores missing and malformed browser state', () => {
    for (const state of [
      null,
      undefined,
      'text',
      123,
      {},
      { roomCreationPath: 1 },
      { roomCreationPath: '/games/' + 'x'.repeat(256) + '/1/new' },
    ]) {
      expect(roomCreationContinuation(state)).toBeUndefined();
    }
  });
});
