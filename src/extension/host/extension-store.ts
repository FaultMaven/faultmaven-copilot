/**
 * `browser.storage.local`, as a `HostStore`.
 *
 * Its own file rather than a const inside the adapter because the store is the
 * one capability EVERY extension context needs — the background worker and the
 * options page install it too, and neither of them has a side panel, a tab to
 * capture or a settings page to navigate to. Importing the whole adapter to get
 * at the store would drag page capture and navigation into those bundles.
 *
 * A thin, honest wrapper: it adds no behaviour, so converting a call site to it
 * cannot change what the extension does.
 */
import { browser } from 'wxt/browser';
import type { HostStore, StoredValue } from '../../shared/host';

/**
 * One difference from the raw API, and it is deliberate.
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
export const extensionStore: HostStore = {
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
