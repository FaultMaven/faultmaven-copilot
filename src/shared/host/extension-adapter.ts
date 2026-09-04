/**
 * The extension host's implementation of the adapter.
 *
 * A thin, honest wrapper over `browser.*` — it adds no behaviour, so converting
 * a call site to it cannot change what the extension does. That is the point of
 * doing this while the extension is still the only host: the interface earns
 * its shape in production, and the second host is not also the first test of it.
 *
 * Only `store`, `navigation` and `pageCapture` are implemented, because only
 * those are wired (see `WiredHost`).
 */
import { browser } from 'wxt/browser';
import { capturePage } from './extension-page-capture';
import { getDashboardUrl } from '../../config';
import { createLogger } from '../../lib/utils/logger';
import type { HostCapabilities, HostStore, StoredValue } from './adapter';

const log = createLogger('extensionHost');

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
 * Navigation, as the extension performs it.
 *
 * `dashboard` takes a PATH, not a URL. Where the Dashboard lives is a property
 * of the host — the extension reads a user-configured endpoint out of storage,
 * a web host is already serving it — so resolving the base URL belongs here and
 * not in a component. The shared UI knows only that it wants `/cases/<id>`.
 *
 * The focus-or-create behaviour is preserved exactly: an existing Dashboard tab
 * is focused and only navigated when it is not already on the target, which is
 * what stops "Open Dashboard" from throwing away a tab's scroll position and
 * form state on every click.
 */
const navigation: HostCapabilities['navigation'] = {
  async dashboard(path) {
    const baseUrl = (await getDashboardUrl()).replace(/\/+$/, '');
    if (!baseUrl) return;
    const targetUrl = `${baseUrl}${path}`;
    try {
      const tabs = await browser.tabs.query({ url: `${baseUrl}/*` });
      if (tabs.length > 0 && tabs[0].id != null) {
        const currentUrl = tabs[0].url ?? '';
        const updateOpts: { active: boolean; url?: string } = { active: true };
        if (!currentUrl.startsWith(targetUrl)) {
          updateOpts.url = targetUrl;
        }
        await browser.tabs.update(tabs[0].id, updateOpts);
      } else {
        await browser.tabs.create({ url: targetUrl });
      }
    } catch (error) {
      // `tabs` permission revoked, or the query rejected. Opening a plain window
      // still gets the user where they asked to go.
      log.warn('tabs navigation failed; falling back to window.open', error);
      window.open(targetUrl, '_blank');
    }
  },

  // The extension HAS a settings surface, so this is a function rather than
  // null. A host without one supplies null and the UI renders no affordance —
  // which is the whole reason this member is nullable instead of a no-op.
  settings: async () => {
    await browser.runtime.openOptionsPage();
  },
};

/**
 * The extension host, as a module singleton.
 *
 * Stable by construction, so it is safe in a hook's dependency array — a host
 * rebuilt on every render would re-run every effect that subscribes through it.
 */
/**
 * The extension's capabilities. No session: nobody is signed in at module load,
 * and the entry point composes this with one before the shell is mounted.
 */
export const extensionHost: HostCapabilities = {
  store,
  navigation,
  // The one capability that is genuinely host-specific rather than
  // host-flavoured: a web page cannot read another tab, at all. Extensions can,
  // so this arm is `supported: true` and carries the implementation.
  pageCapture: { supported: true, capture: capturePage },
};
