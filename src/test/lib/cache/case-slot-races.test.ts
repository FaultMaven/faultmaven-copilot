/**
 * Writers racing on the single case-list slot (#330).
 *
 * The real case service and the real cache over a Map-backed host store whose
 * reads can be held open, so each interleaving is forced rather than hoped for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HostStore, StoredValue } from '@faultmaven/copilot-ui/shared/host';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { createCase } from '@faultmaven/copilot-ui/lib/api';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
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

/** A store whose next slot read can be held open until released. */
function holdableStore() {
  const data = new Map<string, StoredValue>();
  let hold: { entered: () => void; release: Promise<void> } | null = null;
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
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    remove: async (keys) => {
      for (const k of keys) data.delete(k);
    },
    subscribe: () => () => {},
  };
  /** Hold the next slot read; resolves `entered` once that read has taken its snapshot. */
  const holdNextRead = () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r));
    hold = { entered, release: new Promise<void>((r) => (release = r)) };
    return { entered: enteredP, release };
  };
  const slotIds = () =>
    ((data.get(SLOT) as { cases: UserCase[] } | undefined)?.cases ?? []).map((c) => c.case_id);
  const slotTitles = () =>
    ((data.get(SLOT) as { cases: UserCase[] } | undefined)?.cases ?? []).map((c) => c.title);
  return { store, holdNextRead, slotIds, slotTitles };
}

let s: ReturnType<typeof holdableStore>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
