import { makeAccount } from '@/test/fixtures';

// jest.mock calls below are hoisted above these imports by babel-jest.
import { syncService } from '../syncService';

const mockWrites: { userId: string; id: string }[] = [];
const mockState = { fail: true };
jest.mock('../supabase/client', () => ({ supabase: {} }));
jest.mock('../supabase/repository', () => ({
  SupabaseRepository: class {
    mockUser: string;
    constructor(_db: unknown, mockUserId: string) {
      this.mockUser = mockUserId;
    }
    async upsertAccount(a: { id: string }) {
      if (mockState.fail) throw new Error('offline');
      mockWrites.push({ userId: this.mockUser, id: a.id });
    }
  },
}));


/** V1 audit (P0): a write queued for user A must never be replayed into user B's account. */
it('switching users drops the previous user’s queued writes', async () => {
  syncService.attach('user-a');
  syncService.upsertAccount(makeAccount({ id: 'a-account' }));
  await syncService.flush();
  expect(syncService.pending()).toBe(1); // offline: still queued for A

  mockState.fail = false;
  syncService.attach('user-b');
  await syncService.flush();
  expect(mockWrites).toEqual([]);
  expect(syncService.pending()).toBe(0);

  syncService.upsertAccount(makeAccount({ id: 'b-account' }));
  await syncService.flush();
  expect(mockWrites).toEqual([{ userId: 'user-b', id: 'b-account' }]);
});

it('the same user re-attaching (token refresh) keeps and replays its queue', async () => {
  mockWrites.length = 0;
  mockState.fail = true;
  syncService.attach('user-b');
  syncService.upsertAccount(makeAccount({ id: 'b2' }));
  await syncService.flush();
  mockState.fail = false;
  syncService.attach('user-b');
  await syncService.flush();
  expect(mockWrites).toEqual([{ userId: 'user-b', id: 'b2' }]);
});
