/**
 * The extension host's implementation of the adapter.
 *
 * A thin, honest wrapper over `browser.*` — it adds no behaviour, so converting
 * a call site to it cannot change what the extension does. That is the point of
 * doing this while the extension is still the only host: the interface earns
 * its shape in production, and the second host is not also the first test of it.
 *
 * Only `store` is implemented, because only `store` is wired (see `WiredHost`).
 */
import { browser } from 'wxt/browser';
import type { HostStore, StoredValue, WiredHost } from './adapter';

/**
 * `browser.storage.local`, with one difference that is deliberate.
 *
 * `subscribe` takes the keys the caller cares about and filters for them, where
 * the raw `storage.onChanged` hands every listener every change in every area.
 * The filtering has to live somewhere; here it is written once and every caller
 * gets the same rule, rather than each call site re-deriving "is this mine?"
 * — which is how `useConfiguredEndpoint` came to test `changes.apiBaseUrl ||
 * changes.dashboardUrl || changes.apiEndpoint` inline.
 *
 * Membership, not truthiness: a key being PRESENT in the change set is the
 * signal, including a removal (whose `newValue` is `undefined`). Filtering on
 * the value would make a cleared endpoint invisible to its own subscriber.
 */
const store: HostStore = {
  get: (keys) => browser.storage.local.get(keys),

  set: (items) => browser.storage.local.set(items),

  remove: (keys) => browser.storage.local.remove(keys),

  subscribe(keys, onChange) {
    const listener = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => {
      // `local` only. `sync`, `session` and `managed` share this event, and a
      // caller asking about a local key must not be woken by a same-named key
      // in another area.
      if (areaName !== 'local') return;

      const changed: Record<string, StoredValue> = {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          changed[key] = changes[key].newValue;
        }
      }
      if (Object.keys(changed).length > 0) onChange(changed);
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  },
};

/**
 * The extension host, as a module singleton.
 *
 * Stable by construction, so it is safe in a hook's dependency array — a host
 * rebuilt on every render would re-run every effect that subscribes through it.
 */
export const extensionHost: WiredHost = { store };
