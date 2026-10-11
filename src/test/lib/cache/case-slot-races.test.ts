/**
 * Writers racing on the single case-list slot (#330).
 *
 * The real case service and the real cache over a Map-backed host store whose
 * reads can be held open, so each interleaving is forced rather than hoped for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HostStore, StoredValue } from '@faultmaven/copilot-ui/shared/host';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { createCase } from '@faultmaven/copilot-ui/lib/api';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { clearSessionEnding } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { OWNED_KEYS_INDEX_KEY, resetOwnedStorageIndex } from '@faultmaven/copilot-ui/lib/owned-storage';
import { authManager } from '../../../extension/auth/auth-manager';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
// The extension's auth row lives in its own storage; only the cache half of
// `clearAuthState` is under test here.
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } },
}));

const SLOT = 'faultmaven_case_cache';

const row = (id: string, title = id): UserCase => ({
  case_id: id,
  title,
  state: 'inquiry',
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  message_count: 0,
  owner_id: 'u1',
  driver_id: 'u1',
  enterprise_id: 'e1',
  closure_reason: null,
  closed_at: null,
});

type Hold = { entered: () => void; release: Promise<void> };

/** A store whose next slot read, or next slot write, can be held open until released. */
function holdableStore() {
  const data = new Map<string, StoredValue>();
  let hold: Hold | null = null;
  let setHold: Hold | null = null;
  const store: HostStore = {
    get: async (keys) => {
      const snapshot = Object.fromEntries(
        keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]),
      ) as Record<string, StoredValue>;
      if (hold && keys.includes(SLOT)) {
        const h = hold;
        hold = null;
        h.entered();
        await h.release;
      }
      return snapshot;
    },
    set: async (items) => {
      if (setHold && SLOT in items) {
        const h = setHold;
        setHold = null;
        h.entered();
        await h.release;
      }
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    remove: async (keys) => {
      for (const k of keys) data.delete(k);
    },
    subscribe: () => () => {},
  };
  const makeHold = () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r));
    const h: Hold = { entered, release: new Promise<void>((r) => (release = r)) };
    return { h, entered: enteredP, release: () => release() };
  };
  /** Hold the next slot read; resolves `entered` once that read has taken its snapshot. */
  const holdNextRead = () => {
    const { h, entered, release } = makeHold();
    hold = h;
    return { entered, release };
  };
  /**
   * Hold the next slot write at the store; resolves `entered` once the writer
   * has passed its generation check and is inside `ownedStorage.set`.
   */
  const holdNextWrite = () => {
    const { h, entered, release } = makeHold();
    setHold = h;
    return { entered, release };
  };
  const has = (key: string) => data.has(key);
  const slotIds = () =>
    ((data.get(SLOT) as { cases: UserCase[] } | undefined)?.cases ?? []).map((c) => c.case_id);
  const slotTitles = () =>
    ((data.get(SLOT) as { cases: UserCase[] } | undefined)?.cases ?? []).map((c) => c.title);
  return { store, holdNextRead, holdNextWrite, has, slotIds, slotTitles };
}

let s: ReturnType<typeof holdableStore>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetOwnedStorageIndex();
  s = holdableStore();
  setHostStore(s.store);
  setApiTransport({
    baseUrl: async () => 'http://localhost:8090',
    accessToken: async () => 'test-token',
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'ended' as const,
  });
  await caseCacheManager.invalidateCache();
});

describe('createCase leaves the slot to the next fetch (#330 item 1)', () => {
  // A sidebar fetch that starts after createCase's invalidation can land before
  // createCase returns, holding the new case already. Prepending the case
  // optimistically on top of that page listed it twice.
  it('a sidebar page landing right after the invalidation does not get the case twice', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({ ...row('case-new'), user_id: 'u1' }),
    });
    const invalidate = caseCacheManager.invalidateCache.bind(caseCacheManager);
    vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      await invalidate();
      // The sidebar's own fetch, issued after the invalidation, lands now.
      await caseCacheManager.setCachedCases(
        [row('case-new'), row('case-old')],
        caseCacheManager.currentGeneration(),
      );
    });

    await createCase({ title: 'case-new' } as never);

    expect(s.slotIds()).toEqual(['case-new', 'case-old']);
  });
});

describe('a local edit cannot overwrite a page written after its read (#330 item 2)', () => {
  it('a fresh page landing between the edit read and its write survives', async () => {
    await caseCacheManager.setCachedCases([row('case-A'), row('case-B')], caseCacheManager.currentGeneration());

    // The edit reads the old page and is held there.
    const held = s.holdNextRead();
    const edit = caseCacheManager.updateOptimisticCase('case-A', { title: 'Renamed' });
    await held.entered;

    // Meanwhile a sidebar fetch lands: case-B was reassigned away, case-C to the user.
    const fetchWrite = caseCacheManager.setCachedCases(
      [row('case-A'), row('case-C')],
      caseCacheManager.currentGeneration(),
    );
    await Promise.resolve();
    held.release();
    await Promise.all([edit, fetchWrite]);

    // The server's membership stands; the edit did not put the old page back.
    expect(s.slotIds()).toEqual(['case-A', 'case-C']);
  });

  it('an edit queued behind a fresh page applies to that page', async () => {
    await caseCacheManager.setCachedCases([row('case-A'), row('case-B')], caseCacheManager.currentGeneration());

    const fetchWrite = caseCacheManager.setCachedCases(
      [row('case-A'), row('case-C')],
      caseCacheManager.currentGeneration(),
    );
    const edit = caseCacheManager.updateOptimisticCase('case-A', { title: 'Renamed' });
    await Promise.all([fetchWrite, edit]);

    expect(s.slotIds()).toEqual(['case-A', 'case-C']);
    expect(s.slotTitles()).toEqual(['Renamed', 'case-C']);
  });

  it('a fresh page queued behind an edit is still refused after an invalidation', async () => {
    await caseCacheManager.setCachedCases([row('case-A')], caseCacheManager.currentGeneration());

    const held = s.holdNextRead();
    const edit = caseCacheManager.updateOptimisticCase('case-A', { title: 'Renamed' });
    await held.entered;
    const fetchWrite = caseCacheManager.setCachedCases([row('case-A'), row('case-B')], caseCacheManager.currentGeneration());
    const invalidation = caseCacheManager.invalidateCache();
    held.release();
    await Promise.all([edit, fetchWrite, invalidation]);

    expect(s.slotIds()).toEqual([]);
  });
});

describe('a removal waits for a write already landing (#330)', () => {
  it('an invalidation while a page is inside its store write leaves the slot empty', async () => {
    // The write has passed its generation check and is inside
    // `ownedStorage.set` when the invalidation is asked for.
    const held = s.holdNextWrite();
    const fetchWrite = caseCacheManager.setCachedCases([row('case-A')], caseCacheManager.currentGeneration());
    await held.entered;

    const invalidation = caseCacheManager.invalidateCache();
    held.release();
    await Promise.all([fetchWrite, invalidation]);

    expect(s.has(SLOT)).toBe(false);
  });

  it('discarding an expired slot moves the generation', async () => {
    vi.useFakeTimers();
    try {
      await caseCacheManager.setCachedCases([row('case-A')], caseCacheManager.currentGeneration());
      vi.advanceTimersByTime(6 * 60 * 1000);
      const before = caseCacheManager.currentGeneration();

      expect(await caseCacheManager.getCachedCases()).toBeNull();

      expect(caseCacheManager.currentGeneration()).toBe(before + 1);
      expect(s.has(SLOT)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sign-out fences the slot', () => {
  afterEach(() => {
    clearSessionEnding();
    useAppStore.setState({ currentUser: null } as never);
  });

  // A sidebar fetch goes out for user A; A signs out (a notification from the
  // host, or the Dashboard's own sign-out) and the purge runs; then the fetch
  // lands. Unfenced, it rewrote A's driven cases with a fresh fetch time, and
  // the next user signing in within the TTL was served them.
  it('a sidebar fetch in flight across a sign-out does not refill the slot', async () => {
    await caseCacheManager.setCachedCases([row('case-A')], caseCacheManager.currentGeneration());
    useAppStore.setState({ currentUser: { id: 'user-a', username: 'alice', roles: ['user'] } } as never);

    const fetchGeneration = caseCacheManager.currentGeneration(); // the fetch goes out
    useAppStore.getState().applyHostAuthState(null);
    await vi.waitFor(() => {
      expect(s.has(SLOT)).toBe(false);
      expect(s.has(OWNED_KEYS_INDEX_KEY)).toBe(false);
    });

    await caseCacheManager.setCachedCases([row('case-A')], fetchGeneration); // and lands

    expect(s.has(SLOT)).toBe(false);
    expect(s.has(OWNED_KEYS_INDEX_KEY)).toBe(false);
  });

  // `clearAllAuthData` never rejects and must reach its sign-out broadcast. A
  // storage call that never settles must not hold it in the slot queue.
  it('the extension teardown does not wait on a wedged slot queue', async () => {
    const held = s.holdNextWrite();
    const wedged = caseCacheManager.setCachedCases([row('case-A')], caseCacheManager.currentGeneration());
    await held.entered;
    const before = caseCacheManager.currentGeneration();

    try {
      const outcome = await Promise.race([
        authManager.clearAuthState().then(() => 'returned'),
        new Promise((r) => setTimeout(() => r('wedged'), 200)),
      ]);
      expect(outcome).toBe('returned');
      expect(caseCacheManager.currentGeneration()).toBe(before + 1);
    } finally {
      held.release();
      await wedged;
    }
    // The removal it queued still runs once the queue moves.
    await vi.waitFor(() => expect(s.has(SLOT)).toBe(false));
  });
});
