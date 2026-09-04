/**
 * The host's key-value store, for the modules that cannot ask React for it.
 *
 * The Zustand store, its slices and the persistence machinery are plain modules
 * called from effects, callbacks and background continuations. They cannot read
 * context, so — exactly as with `ApiTransport` — the host installs its store
 * once, above the shared UI, and they use it.
 *
 * This is deliberately the SAME `HostStore` the components get from `useHost()`,
 * not a parallel abstraction: one store, one set of keys, one set of change
 * notifications. A second storage path is how `faultmaven_current_case` came to
 * have two writers in the first place.
 *
 * Reads before installation THROW. Silently falling back to extension storage
 * would work perfectly in the extension and fail only in the Dashboard, which is
 * the failure this whole boundary exists to make impossible.
 */
import type { HostStore } from '../shared/host';

let store: HostStore | null = null;

export function setHostStore(next: HostStore): void {
  store = next;
}

/** Test seam: drop the installed store so a leak between tests is loud. */
export function clearHostStore(): void {
  store = null;
}

export function getHostStore(): HostStore {
  if (!store) {
    throw new Error(
      'No HostStore installed. The host must call setHostStore() before the shared UI reads or writes state.',
    );
  }
  return store;
}
