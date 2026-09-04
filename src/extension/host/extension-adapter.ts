/**
 * The extension host's implementation of the adapter.
 *
 * A thin, honest wrapper over `browser.*` — it adds no behaviour, so converting
 * a call site to it cannot change what the extension does. That is the point of
 * doing this while the extension is still the only host: the interface earns
 * its shape in production, and the second host is not also the first test of it.
 *
 * What it composes rather than defines: the store (`extension-store.ts`, which
 * every extension context installs) and the endpoints (`endpoints.ts`, which is
 * a user's persisted choice). What it defines is what only a side panel needs —
 * navigation and page capture.
 */
import { browser } from 'wxt/browser';
import { capturePage } from './extension-page-capture';
import { extensionEndpoints, getDashboardUrl } from './endpoints';
import { extensionStore } from './extension-store';
import { createLogger } from '../../lib/utils/logger';
import type { HostCapabilities } from '../../shared/host';

const log = createLogger('extensionHost');

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
    // No empty-baseUrl guard: `getDashboardUrl()` falls back to the Cloud
    // default and cannot return an empty string, so the guard that used to sit
    // here was unreachable — a test written against it could only pass
    // vacuously.
    const baseUrl = (await getDashboardUrl()).replace(/\/+$/, '');
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
 * The extension's capabilities, as a module singleton.
 *
 * No session: nobody is signed in at module load, and the entry point composes
 * this with one before the shell is mounted. Stable by construction, so it is
 * safe in a hook's dependency array — a host rebuilt on every render would
 * re-run every effect that subscribes through it.
 */
export const extensionHost: HostCapabilities = {
  store: extensionStore,
  endpoints: extensionEndpoints,
  navigation,
  // The one capability that is genuinely host-specific rather than
  // host-flavoured: a web page cannot read another tab, at all. Extensions can,
  // so this arm is `supported: true` and carries the implementation.
  pageCapture: { supported: true, capture: capturePage },
};
