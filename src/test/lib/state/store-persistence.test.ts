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

import { debouncedPersist } from '../../../lib/state/store';

// Let the debounced async persistence body run to completion.
const drain = async () => {
  debouncedPersist.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const emptyState = () => ({
  conversationTitles: {},
  titleSources: {},
  conversations: {},
  pendingOperations: {},
  optimisticCases: [],
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
        'conversations',
        'pendingOperations',
        'optimisticCases'
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

  it('always persists pinnedCases as an array', async () => {
    debouncedPersist({ ...emptyState(), pinnedCases: ['case-7'] });
    await drain();

    const saved = storageSet.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.pinnedCases).toEqual(['case-7']);
  });
});
