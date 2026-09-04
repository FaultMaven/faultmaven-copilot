/**
 * SCAFFOLDING. Not the design — the thing the design replaces.
 *
 * `src/shared/ui` imports `browser` from `wxt/browser` in eight files. In a
 * plain web page that module resolves to `globalThis.browser?.runtime?.id ?
 * globalThis.browser : globalThis.chrome` — i.e. **undefined** — so the first
 * `browser.storage.local.get(...)` is a TypeError, not a silent no-op. (Note
 * that the Dashboard's existing `window.browser` polyfill does NOT satisfy that
 * check: it has no `runtime.id`, so `wxt/browser` still hands back undefined.
 * It cannot serve the shared UI as it stands.)
 *
 * The playground's Vite config aliases `wxt/browser` here so the EXISTING UI
 * can run unmodified — "wrap, don't relocate". Every member is answered from
 * the same `HostAdapter` the design proposes, so the proof exercises the
 * adapter and not a second, parallel shim:
 *
 *   - the members a web host CAN answer are delegated to the adapter;
 *   - the members it cannot throw, naming the adapter member that replaces the
 *     call site during the migration.
 *
 * This file is deleted by the last migration PR, when no call site imports
 * `wxt/browser` any more. Until then its throw messages are the checklist.
 */
import { webHostAdapter } from './web-host';
import type { StoredValue } from '~/shared/host';

const host = webHostAdapter;

function notInThisHost(call: string, replacement: string): never {
  throw new Error(
    `${call} does not exist in the web host. Migration: replace this call site with ${replacement}.`,
  );
}

type ChangeListener = (
  changes: Record<string, { newValue?: StoredValue; oldValue?: StoredValue }>,
  areaName: string,
) => void;

const changeListeners = new Map<ChangeListener, () => void>();

export const browser = {
  storage: {
    local: {
      get: (keys: string[]) => host.store.get(keys),
      set: (items: Record<string, StoredValue>) => host.store.set(items),
      remove: (keys: string[]) => host.store.remove(keys),
    },
    // `useConfiguredEndpoint` subscribes to ALL keys and filters by name, so
    // the shim subscribes to all keys too and re-shapes the payload into the
    // `{ key: { newValue } }` form the extension API uses.
    onChanged: {
      addListener(listener: ChangeListener) {
        const unsubscribe = host.store.subscribe([], (changed) => {
          const shaped = Object.fromEntries(
            Object.entries(changed).map(([k, v]) => [k, { newValue: v }]),
          );
          listener(shaped, 'local');
        });
        changeListeners.set(listener, unsubscribe);
      },
      removeListener(listener: ChangeListener) {
        changeListeners.get(listener)?.();
        changeListeners.delete(listener);
      },
    },
  },

  runtime: {
    openOptionsPage: async () => {
      if (!host.navigation.settings) {
        notInThisHost('runtime.openOptionsPage()', 'host.navigation.settings (null here)');
      }
      return host.navigation.settings();
    },
    sendMessage: async () =>
      notInThisHost('runtime.sendMessage()', 'host.session (the host authenticates)'),
    onMessage: {
      addListener: () =>
        notInThisHost('runtime.onMessage', 'host.session (the host authenticates)'),
      removeListener: () => {},
    },
  },

  tabs: {
    query: async () => notInThisHost('tabs.query()', 'host.pageCapture / host.navigation'),
    update: async () => notInThisHost('tabs.update()', 'host.navigation.dashboard()'),
    create: async () => notInThisHost('tabs.create()', 'host.navigation.external()'),
  },

  permissions: {
    contains: async () => notInThisHost('permissions.contains()', 'host.pageCapture'),
    request: async () => notInThisHost('permissions.request()', 'host.pageCapture'),
  },

  scripting: {
    executeScript: async () => notInThisHost('scripting.executeScript()', 'host.pageCapture'),
  },
};
