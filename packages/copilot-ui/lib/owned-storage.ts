/**
 * The package's own door to the host store, and the record of what it owns.
 *
 * Sign-out has to remove everything the package persisted for the user who is
 * leaving. That was a hand-written list of keys, and a list is wrong the moment
 * someone adds a key without remembering it — which is exactly what happened:
 * `faultmaven_case_cache` holds case ids and titles, was never on the list, and
 * survived a sign-out with the previous user's titles in it.
 *
 * So the package records what it writes. Every package write goes through
 * `ownedStorage`, which adds the key to an index kept in the host store beside
 * the data; the purge reads the index and removes all of it. A key added by a
 * future writer is registered by the act of being written, so it cannot escape
 * the purge the way a list lets it.
 *
 * WRITES ONLY. Ownership is "the package put this here", not "the package read
 * it": `hasCompletedFirstRun` is the EXTENSION's onboarding flag and the
 * extension's endpoint configuration (`apiBaseUrl`, `dashboardUrl`) is the
 * extension's too — all of them written by the host through `getHostStore()`
 * directly. Purging those on sign-out would send a self-hosted deployment back
 * to the Cloud default and re-run onboarding, so reading a key must not claim
 * it.
 *
 * The index is written BEFORE the data it describes. Over-approximating is
 * harmless — removing a key that was never written is a no-op — while the
 * other order leaves a written key unregistered if the index write fails.
 */
import type { HostStore, StoredValue } from '../shared/host';
import { getHostStore } from './host-store';
import { createLogger } from './utils/logger';

const log = createLogger('OwnedStorage');

/** Where the package records the keys it has written. Owned, and purged too. */
export const OWNED_KEYS_INDEX_KEY = 'faultmaven_owned_keys';

let index: Promise<Set<string>> | null = null;

/**
 * The keys this package has written, from the store rather than from memory:
 * a page that reloads and then signs out without writing anything must still
 * purge what the page before it wrote.
 */
function loadIndex(): Promise<Set<string>> {
  if (!index) {
    index = (async () => {
      const known = new Set<string>();
      try {
        const stored = await getHostStore().get([OWNED_KEYS_INDEX_KEY]);
        const recorded = stored[OWNED_KEYS_INDEX_KEY];
        if (Array.isArray(recorded)) {
          for (const key of recorded) if (typeof key === 'string') known.add(key);
        }
      } catch (error) {
        // A store that cannot be read cannot tell us what it holds. The keys
        // this page writes are still registered below.
        log.warn('Could not read the owned-key index; starting from this page', error);
      }
      return known;
    })();
  }
  return index;
}

async function register(keys: string[]): Promise<void> {
  const known = await loadIndex();
  const fresh = keys.filter((key) => key !== OWNED_KEYS_INDEX_KEY && !known.has(key));
  if (fresh.length === 0) return;
  for (const key of fresh) known.add(key);
  await getHostStore().set({ [OWNED_KEYS_INDEX_KEY]: [...known] });
}

/**
 * The store, for package code. Same interface as `HostStore`, minus the
 * subscription (a subscriber is not a writer): `set` records what it writes.
 */
export const ownedStorage = {
  get(keys: string[]): Promise<Record<string, StoredValue>> {
    return getHostStore().get(keys);
  },

  async set(items: Record<string, StoredValue>): Promise<void> {
    await register(Object.keys(items));
    await getHostStore().set(items);
  },

  remove(keys: string[]): Promise<void> {
    return getHostStore().remove(keys);
  },
} satisfies Omit<HostStore, 'subscribe'>;

/**
 * Remove every key the package has written, and the index with them.
 *
 * Returns what it removed, so a caller can log it and a test can assert on it
 * rather than on a list written twice.
 */
export async function purgeOwnedStorage(): Promise<string[]> {
  const known = await loadIndex();
  const keys = [...known];
  try {
    if (keys.length > 0) await getHostStore().remove(keys);
    await getHostStore().remove([OWNED_KEYS_INDEX_KEY]);
  } finally {
    // Whatever the store did with that, this page no longer claims those keys.
    index = Promise.resolve(new Set<string>());
  }
  return keys;
}

/** Test seam: forget the index so the next read comes from the store again. */
export function resetOwnedStorageIndex(): void {
  index = null;
}
