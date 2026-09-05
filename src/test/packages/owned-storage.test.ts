/**
 * What the package owns in the host store, and how it knows.
 *
 * Sign-out used to remove a hand-written LIST of keys, and a list is wrong the
 * moment a writer is added without remembering it: `faultmaven_case_cache`
 * holds case ids and titles, was never on the list, and survived a sign-out
 * with the previous user's titles in it (proved against the real package from
 * the Dashboard). The package records what it WRITES instead, so the next key
 * is registered by the act of being written.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setHostStore, clearHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import {
  ownedStorage,
  purgeOwnedStorage,
  resetOwnedStorageIndex,
  OWNED_KEYS_INDEX_KEY,
} from '@faultmaven/copilot-ui/lib/owned-storage';
import type { StoredValue } from '@faultmaven/copilot-ui/shared/host';

const PKG = join(process.cwd(), 'packages/copilot-ui');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'public') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** An in-memory host store, with the map the assertions read. */
function stubStore() {
  const data: Record<string, StoredValue> = {};
  setHostStore({
    get: async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items: Record<string, StoredValue>) => {
      Object.assign(data, items);
    },
    remove: async (keys: string[]) => {
      for (const key of keys) delete data[key];
    },
    subscribe: () => () => {},
  });
  return data;
}

beforeEach(() => {
  clearHostStore();
  resetOwnedStorageIndex();
});

describe('the package writes through one door', () => {
  /**
   * The gate. `ownedStorage` can only record what goes through it, so a writer
   * that reaches `getHostStore()` directly is a key that escapes the purge —
   * which is exactly how the case cache escaped it. Two files may still name
   * it: the one that installs it, and the one that wraps it.
   */
  it('no package module calls getHostStore() except the seam and the wrapper', () => {
    const allowed = new Set(['lib/host-store.ts', 'lib/owned-storage.ts']);
    const files = sourceFiles(PKG);
    expect(files.length).toBeGreaterThan(50); // the walk found the package

    const offenders = files
      .map((file) => [relative(PKG, file), readFileSync(file, 'utf8')] as const)
      .filter(([rel]) => !allowed.has(rel))
      .filter(([, source]) => /getHostStore\(\)\s*\./.test(source))
      .map(([rel]) => rel);

    expect(
      offenders,
      `these write or read around the owned-key record:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('ownedStorage', () => {
  it('registers a key as it writes it, and purges everything it registered', async () => {
    const data = stubStore();

    await ownedStorage.set({ faultmaven_case_cache: { cases: [] } });
    await ownedStorage.set({ conversationTitles: { 'case-1': 'a title' } });

    expect(data[OWNED_KEYS_INDEX_KEY]).toEqual([
      'faultmaven_case_cache',
      'conversationTitles',
    ]);

    const removed = await purgeOwnedStorage();

    expect(removed.sort()).toEqual(['conversationTitles', 'faultmaven_case_cache']);
    expect(Object.keys(data)).toEqual([]); // the index goes too
  });

  /**
   * Ownership is "the package put this here", not "the package read it". The
   * extension's endpoint configuration and its onboarding flag are written by
   * the HOST through `getHostStore()` and read by the package; purging those on
   * sign-out would send a self-hosted deployment back to the Cloud default and
   * re-run onboarding.
   */
  it('does not claim a key it only read', async () => {
    const data = stubStore();
    data.apiBaseUrl = 'https://fm.internal.example';
    data.hasCompletedFirstRun = true;

    const read = await ownedStorage.get(['apiBaseUrl', 'hasCompletedFirstRun']);
    expect(read.apiBaseUrl).toBe('https://fm.internal.example');

    await purgeOwnedStorage();

    expect(data.apiBaseUrl).toBe('https://fm.internal.example');
    expect(data.hasCompletedFirstRun).toBe(true);
  });

  /**
   * The index is written BEFORE the data. Over-approximating is harmless — a
   * remove of a key that was never written is a no-op — while the other order
   * leaves a written key unregistered whenever the index write is the one that
   * fails.
   */
  it('registers before it writes, so a failed write cannot leave an unowned key', async () => {
    const data = stubStore();
    const order: string[] = [];
    const inner = {
      get: async (keys: string[]) =>
        Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
      set: async (items: Record<string, StoredValue>) => {
        order.push(Object.keys(items)[0]);
        Object.assign(data, items);
      },
      remove: async () => {},
      subscribe: () => () => {},
    };
    setHostStore(inner);

    await ownedStorage.set({ sessionId: 'sess-1' });

    expect(order).toEqual([OWNED_KEYS_INDEX_KEY, 'sessionId']);
  });

  /** A page that reloads has only what the page before it left in the store. */
  it('reads the index from the store, so a previous page life is still purged', async () => {
    const data = stubStore();
    data[OWNED_KEYS_INDEX_KEY] = ['faultmaven_case_cache'];
    data.faultmaven_case_cache = { cases: [{ title: 'from the last page' }] };

    const removed = await purgeOwnedStorage();

    expect(removed).toEqual(['faultmaven_case_cache']);
    expect(Object.keys(data)).toEqual([]);
  });
});
