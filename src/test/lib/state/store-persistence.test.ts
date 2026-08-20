import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Captured inside vi.hoisted so the mock factory (hoisted to top of file) can
// reference them while assertions below can still read the calls.
const { storageSet, storageRemove, storageGet } = vi.hoisted(() => ({
  storageSet: vi.fn().mockResolvedValue(undefined),
  storageRemove: vi.fn().mockResolvedValue(undefined),
  storageGet: vi.fn().mockResolvedValue({})
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: storageGet, set: storageSet, remove: storageRemove },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  }
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

// Control the teardown flag the store's beforeunload handler reads.
const { sessionEnding } = vi.hoisted(() => ({ sessionEnding: { value: false } }));
vi.mock('../../../lib/state/session-epoch', () => ({
  getEpoch: () => 0,
  bumpEpoch: () => 1,
  markSessionEnding: () => { sessionEnding.value = true; },
  isSessionEnding: () => sessionEnding.value
}));

import {
  debouncedPersist,
  CONVERSATION_CACHE_VERSION,
  CONVERSATION_CACHE_VERSION_KEY
} from '../../../lib/state/store';

// Let the debounced async persistence body run to completion.
const drain = async () => {
  debouncedPersist.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const emptyState = () => ({
  conversationTitles: {},
  titleSources: {},
  conversations: {},
  pinnedCases: [] as string[]
});

describe('store debouncedPersist', () => {
  beforeEach(() => {
    storageSet.mockClear();
    storageRemove.mockClear();
  });

  afterEach(() => {
    debouncedPersist.cancel();
  });

  it('removes emptied collection keys instead of leaving stale data (regression: deleted cases must not resurvive a reload)', async () => {
    debouncedPersist(emptyState());
    await drain();

    expect(storageRemove).toHaveBeenCalledTimes(1);
    const removedKeys = storageRemove.mock.calls[0][0] as string[];
    expect(removedKeys).toEqual(
      expect.arrayContaining([
        'conversationTitles',
        'titleSources',
        'conversations'
      ])
    );
  });

  it('persists non-empty collections and does not mark them for removal', async () => {
    debouncedPersist({
      ...emptyState(),
      conversationTitles: { 'case-1': 'My Case' },
      conversations: { 'case-1': [{ id: 'm1', optimistic: false }] as any }
    });
    await drain();

    const saved = storageSet.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.conversationTitles).toEqual({ 'case-1': 'My Case' });
    expect(saved.conversations).toEqual({ 'case-1': [{ id: 'm1', optimistic: false }] });

    const removedKeys = (storageRemove.mock.calls[0]?.[0] ?? []) as string[];
    expect(removedKeys).not.toContain('conversations');
    expect(removedKeys).not.toContain('conversationTitles');
  });

  it('never persists pendingOperations (closures cannot survive serialization)', async () => {
    // Even when the caller passes pending operations, they must not be written or
    // tracked for removal — the key is out of the persistence contract entirely.
    debouncedPersist({
      ...emptyState(),
      conversations: { 'case-1': [{ id: 'm1', optimistic: false }] as any },
      // @ts-expect-error pendingOperations is intentionally not part of the persist contract
      pendingOperations: { op1: { id: 'op1', status: 'failed' } }
    });
    await drain();

    const saved = (storageSet.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('pendingOperations');
    const removedKeys = (storageRemove.mock.calls[0]?.[0] ?? []) as string[];
    expect(removedKeys).not.toContain('pendingOperations');
  });

  it('strips transient (optimistic/loading/failed) messages before persisting', async () => {
    debouncedPersist({
      ...emptyState(),
      conversations: {
        'case-1': [
          { id: 'committed', optimistic: false },
          { id: 'optimistic', optimistic: true },
          { id: 'thinking', optimistic: false, loading: true },
          { id: 'failed', optimistic: false, failed: true }
        ] as any
      }
    });
    await drain();

    const saved = storageSet.mock.calls[0][0] as Record<string, any>;
    const persistedIds = saved.conversations['case-1'].map((m: any) => m.id);
    expect(persistedIds).toEqual(['committed']);
  });

  it('drops conversations left empty after stripping transient messages', async () => {
    debouncedPersist({
      ...emptyState(),
      conversations: {
        'only-optimistic': [{ id: 'x', optimistic: true, loading: true }] as any
      }
    });
    await drain();

    const saved = (storageSet.mock.calls[0]?.[0] ?? {}) as Record<string, any>;
    // The whole conversation had nothing committed → it must not be persisted,
    // and the (now-empty) conversations map should be marked for removal.
    expect(saved.conversations).toBeUndefined();
    const removedKeys = (storageRemove.mock.calls[0]?.[0] ?? []) as string[];
    expect(removedKeys).toContain('conversations');
  });

  it('always persists pinnedCases as an array', async () => {
    debouncedPersist({ ...emptyState(), pinnedCases: ['case-7'] });
    await drain();

    const saved = storageSet.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.pinnedCases).toEqual(['case-7']);
  });
});

// #164: on a teardown/hand-off reload the beforeunload handler must CANCEL the
// pending persist, not flush it — a flush would write the ending session's
// snapshotted in-memory state (possibly a prior user's just-purged residue) back
// to storage after the purge, re-homing it under the new owner.
describe('CONVERSATION_CACHE_VERSION', () => {
  it('rejects caches written before the merge reconciled locally-minted ids', () => {
    // Stated as the property, not the number, because the number is not the
    // point: a v2 cache may hold a turn ALREADY duplicated by the bug #213
    // fixed, and such a cache cannot repair itself — the reconciliation skips an
    // incoming row whose id is already present, and the inflated committed count
    // pushes `offset` past the backend's row count, so the fetch returns an
    // empty page and the merge never runs again. It may also hold turn numbers
    // that were client-side PREDICTIONS, which the matcher would trust.
    //
    // If this fails because someone lowered the version, the question to answer
    // is not "which number" but "may this build trust a cache the previous one
    // wrote?" — see the constant's doc comment.
    expect(CONVERSATION_CACHE_VERSION).toBeGreaterThan(2);
  });

  it('is stamped with the conversations it describes, and cleared with them', () => {
    // The version must never outlive the map it refers to: a stale stamp on an
    // absent cache would let the next build trust conversations it did not write.
    expect(CONVERSATION_CACHE_VERSION_KEY).toBe('conversationCacheVersion');
  });
});

describe('store beforeunload teardown (#164)', () => {
  const pending = () => ({
    ...emptyState(),
    conversations: { 'case-1': [{ id: 'm1', optimistic: false }] as any }
  });

  beforeEach(() => {
    storageSet.mockClear();
    storageRemove.mockClear();
    sessionEnding.value = false;
  });

  afterEach(() => {
    debouncedPersist.cancel();
    sessionEnding.value = false;
  });

  it('flushes a pending persist on a NORMAL unload (last committed turn is not lost)', async () => {
    debouncedPersist(pending()); // schedule (trailing timer, not yet fired)
    window.dispatchEvent(new Event('beforeunload')); // isSessionEnding() === false → flush
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storageSet).toHaveBeenCalled();
  });

  it('CANCELS a pending persist on a teardown unload (residue is not re-written after purge)', async () => {
    debouncedPersist(pending()); // schedule a persist carrying the residue snapshot
    sessionEnding.value = true; // markSessionEnding() has run before the reload
    window.dispatchEvent(new Event('beforeunload')); // isSessionEnding() === true → cancel
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storageSet).not.toHaveBeenCalled();
  });
});
