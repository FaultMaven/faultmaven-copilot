import { vi } from 'vitest';

/**
 * `browser` objects shaped like each build target, for tests that load the
 * background entrypoint.
 *
 * `wxt/browser` is the raw `browser`/`chrome` global with no polyfill, so what
 * the background can call depends entirely on which namespaces the running
 * browser exposes:
 *
 *   Chrome MV3:  `action` + `sidePanel`
 *   Firefox MV2: `browserAction` + `sidebarAction` (present only because the
 *                Firefox manifest declares `sidebar_action`); no `action`, no
 *                `sidePanel`
 *
 * Load the background AFTER installing a shape (see `loadBackgroundWith` in the
 * tests that use this) so module-level reads see the target under test, not
 * whichever shape an earlier import happened to capture.
 *
 * The panel mocks are STATEFUL, modelled on the documented semantics. The
 * release paths read before they write, so a call-spy that always answered the
 * defaults would make "navigate away and the panel comes back" vacuously green.
 */

/** The page both manifests declare as the panel (`side_panel` / `sidebar_action`). */
export const PANEL_PAGE = 'sidepanel_manual.html';

type Listener = (...args: any[]) => unknown;

export interface BrowserShape {
  browser: Record<string, any>;
  /** The last listener registered on each event this harness captures. */
  listeners: Record<string, Listener>;
  /** Backing store for `storage.local`. */
  storage: Record<string, unknown>;
}

function capture(listeners: Record<string, Listener>, name: string) {
  return {
    addListener: vi.fn((fn: Listener) => {
      listeners[name] = fn;
    }),
    removeListener: vi.fn(),
  };
}

function commonApis(
  listeners: Record<string, Listener>,
  storage: Record<string, unknown>,
  extensionOrigin: string,
  manifest: Record<string, unknown>,
) {
  return {
    runtime: {
      id: 'test-copilot-id',
      onMessage: capture(listeners, 'message'),
      onInstalled: capture(listeners, 'installed'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `${extensionOrigin}${path.startsWith('/') ? path : `/${path}`}`),
      getManifest: vi.fn(() => manifest),
    },
    identity: {
      getRedirectURL: vi.fn(() => 'https://test.example/'),
      launchWebAuthFlow: vi.fn(),
    },
    tabs: {
      onUpdated: capture(listeners, 'tabUpdated'),
      query: vi.fn().mockResolvedValue([]),
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: capture(listeners, 'permissionsAdded'),
      onRemoved: capture(listeners, 'permissionsRemoved'),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (storage[key] !== undefined) out[key] = storage[key];
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }),
      },
      onChanged: capture(listeners, 'storageChanged'),
    },
  };
}

export interface ChromeShape extends BrowserShape {
  /** Tab-specific side panel options, as `sidePanel.setOptions` left them. */
  panelOptionsByTab: Map<number, { enabled?: boolean; path?: string }>;
}

/** Chrome MV3: `action` + a stateful `sidePanel`. */
export function chromeMv3Shape(): ChromeShape {
  const listeners: Record<string, Listener> = {};
  const storage: Record<string, unknown> = {};
  const panelOptionsByTab = new Map<number, { enabled?: boolean; path?: string }>();
  const defaults = { enabled: true, path: PANEL_PAGE };

  const browser = {
    ...commonApis(listeners, storage, 'chrome-extension://test-copilot-id', {
      side_panel: { default_path: PANEL_PAGE },
    }),
    action: { onClicked: capture(listeners, 'toolbarClick') },
    sidePanel: {
      open: vi.fn().mockResolvedValue(undefined),
      // With a tabId: tab-specific options. `getOptions` answers those if set,
      // else "the default side panel options".
      setOptions: vi.fn(async (options: { tabId?: number; enabled?: boolean; path?: string }) => {
        const { tabId, ...rest } = options ?? {};
        if (typeof tabId !== 'number') return;
        panelOptionsByTab.set(tabId, { ...(panelOptionsByTab.get(tabId) ?? defaults), ...rest });
      }),
      getOptions: vi.fn(async ({ tabId }: { tabId?: number }) => {
        if (typeof tabId === 'number' && panelOptionsByTab.has(tabId)) {
          return { tabId, ...panelOptionsByTab.get(tabId) };
        }
        return { tabId, ...defaults };
      }),
    },
  };

  return { browser, listeners, storage, panelOptionsByTab };
}

export interface FirefoxShape extends BrowserShape {
  /** Tab-specific sidebar panels (absolute URLs), as `setPanel` left them. */
  panelByTab: Map<number, string>;
  /** The absolute URL `getPanel` answers for a tab with no panel of its own. */
  globalPanelUrl: string;
}

/**
 * Firefox MV2 as the built manifest declares it: `browserAction` and a
 * stateful `sidebarAction`. `setPanel({ tabId, panel: null })` removes the
 * tab-specific panel and the tab inherits the global one; `getPanel` answers
 * with an absolute URL.
 */
export function firefoxMv2Shape(): FirefoxShape {
  const listeners: Record<string, Listener> = {};
  const storage: Record<string, unknown> = {};
  const panelByTab = new Map<number, string>();
  const origin = 'moz-extension://test-copilot-id';
  const globalPanelUrl = `${origin}/${PANEL_PAGE}`;
  const absolute = (panel: string) => new URL(panel, `${origin}/`).href;

  const browser = {
    ...commonApis(listeners, storage, origin, {
      sidebar_action: { default_panel: PANEL_PAGE },
    }),
    browserAction: { onClicked: capture(listeners, 'toolbarClick') },
    sidebarAction: {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      toggle: vi.fn().mockResolvedValue(undefined),
      setPanel: vi.fn(async ({ tabId, panel }: { tabId?: number; panel: string | null }) => {
        if (typeof tabId !== 'number') return;
        if (panel === null || panel === '') panelByTab.delete(tabId);
        else panelByTab.set(tabId, absolute(panel));
      }),
      getPanel: vi.fn(async ({ tabId }: { tabId?: number }) =>
        typeof tabId === 'number' && panelByTab.has(tabId) ? panelByTab.get(tabId)! : globalPanelUrl,
      ),
    },
  };

  return { browser, listeners, storage, panelByTab, globalPanelUrl };
}
