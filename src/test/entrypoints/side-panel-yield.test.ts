import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The side panel yields on Dashboard tabs (#229).
 *
 * INVARIANT: on a tab whose origin is a configured Dashboard origin the panel
 * is not visible; on every other tab it behaves exactly as before.
 *
 * These drive the BACKGROUND ENTRYPOINT rather than the yield module directly,
 * for two reasons. It binds the wiring — the navigation listener and the
 * settings-change reconcile are as much a part of the invariant as the rule
 * itself — and it means every assertion here is a behavioural one that a build
 * without the feature fails by doing nothing, rather than by failing to import.
 *
 * The two failure directions are not symmetric. Suppressing the panel on a
 * NON-Dashboard tab removes the product from the only surface it has there, so
 * that direction is tested harder than the redundancy this issue exists to
 * remove: the origin set is exercised with a look-alike host, a look-alike
 * port, and the release path after navigating away.
 */

const {
  mockBrowser,
  listeners,
  mockSidePanel,
  storageStore,
  panelOptionsByTab,
  MANIFEST_PANEL_PATH,
} = vi.hoisted(() => {
  (global as any).defineBackground = (config: any) => config;

  const listeners: Record<string, any> = {};
  const storageStore: Record<string, any> = {};

  // The document wxt.config.ts declares as `side_panel.default_path`. The rule
  // reads it back off the running manifest, so this fixture is what proves the
  // release path restores the REAL panel rather than a hard-coded guess.
  const MANIFEST_PANEL_PATH = 'sidepanel_manual.html';

  /**
   * A stateful stand-in for chrome.sidePanel, modelled on the documented
   * semantics: `setOptions` with a tabId writes tab-specific options, and
   * `getOptions` with a tabId returns those if present and otherwise "the
   * default side panel options (used for any tab that doesn't have specific
   * settings)". A plain call-spy would not do — the release path READS before
   * it writes, so a stub that always answered the defaults would make the
   * "navigate back and the panel returns" case vacuously green.
   */
  const panelOptionsByTab = new Map<number, { enabled?: boolean; path?: string }>();
  const defaults = { enabled: true, path: MANIFEST_PANEL_PATH };

  const mockSidePanel = {
    open: vi.fn().mockResolvedValue(undefined),
    setOptions: vi.fn(async (options: any) => {
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
  };

  const mockBrowserObj: any = {
    runtime: {
      id: 'test-copilot-id',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onInstalled: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `chrome-extension://test-copilot-id${path}`),
      getManifest: vi.fn(() => ({ side_panel: { default_path: MANIFEST_PANEL_PATH } })),
    },
    identity: {
      getRedirectURL: vi.fn(() => 'https://test.chromiumapp.org/'),
      launchWebAuthFlow: vi.fn(),
    },
    tabs: {
      onUpdated: {
        addListener: vi.fn((fn: any) => {
          listeners.tabUpdated = fn;
        }),
        removeListener: vi.fn(),
      },
      query: vi.fn().mockResolvedValue([]),
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, any> = {};
          for (const key of keys) {
            if (storageStore[key] !== undefined) out[key] = storageStore[key];
          }
          return out;
        }),
        set: vi.fn(async (obj: Record<string, any>) => {
          Object.assign(storageStore, obj);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storageStore[key];
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: any) => {
          listeners.storageChanged = fn;
        }),
        removeListener: vi.fn(),
      },
    },
    action: { onClicked: { addListener: vi.fn(), removeListener: vi.fn() } },
    sidePanel: mockSidePanel,
  };

  return {
    mockBrowser: mockBrowserObj,
    listeners,
    mockSidePanel,
    storageStore,
    panelOptionsByTab,
    MANIFEST_PANEL_PATH,
  };
});

vi.mock('wxt/browser', () => ({ browser: mockBrowser }));
(global as any).browser = mockBrowser;

vi.mock('../../lib/api', () => ({
  authManager: { saveAuthState: vi.fn(), clearAuthState: vi.fn() },
}));

// The auth bridge's own registration is not under test here; only the fact
// that the yield rule shares its origin set is.
vi.mock('../../lib/auth/auth-bridge-registration', () => ({
  reconcileAuthBridgeRegistration: vi.fn(),
  unregisterAuthBridge: vi.fn(),
}));

import backgroundEntry from '../../entrypoints/background';

const CLOUD_DASHBOARD = 'https://app.faultmaven.ai';
const SELF_HOSTED_DASHBOARD = 'https://fm.internal.example.com';
const GRAFANA = 'https://grafana.example.com';

/** Let every queued promise chain finish before asserting. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function mount() {
  backgroundEntry.main();
}

/**
 * Hand one update to the worker's tabs.onUpdated listener.
 *
 * The missing listener is named rather than left to die on "tabUpdated is not
 * a function": a build that never subscribes to navigation cannot hold the
 * invariant at all, and that is the finding, not a broken fixture.
 */
function dispatchTabUpdate(tabId: number, changeInfo: any, tab: any) {
  expect(
    typeof listeners.tabUpdated,
    'the worker registered no tabs.onUpdated listener, so the side panel cannot follow navigation'
  ).toBe('function');
  listeners.tabUpdated(tabId, changeInfo, tab);
}

/** Drive a tab navigation the way chrome.tabs.onUpdated does. */
async function navigate(tabId: number, url: string) {
  dispatchTabUpdate(tabId, { status: 'complete', url }, { id: tabId, url });
  await settle();
}

/** Drive a Settings write of the configured Dashboard URL. */
async function configureDashboardUrl(url: string) {
  storageStore.dashboardUrl = url;
  listeners.storageChanged({ dashboardUrl: { newValue: url } }, 'local');
  await settle();
}

/** What the browser would do with this tab: is the panel shown on it? */
async function panelIsVisibleOn(tabId: number): Promise<boolean> {
  const options = await mockSidePanel.getOptions({ tabId });
  return options?.enabled !== false;
}

describe('Side panel yields on Dashboard tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelOptionsByTab.clear();
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    for (const key of Object.keys(listeners)) delete listeners[key];
    mockBrowser.tabs.query.mockResolvedValue([]);
    mockBrowser.sidePanel = mockSidePanel;
  });

  afterEach(() => {
    mockBrowser.sidePanel = mockSidePanel;
  });

  describe('failure direction 1 — the panel must NOT disappear off the Dashboard', () => {
    it('leaves a non-Dashboard tab entirely alone', async () => {
      mount();
      await settle();

      await navigate(1, `${GRAFANA}/d/abc/incident`);

      expect(await panelIsVisibleOn(1)).toBe(true);
      // Not merely "still enabled": a tab that has never been on the Dashboard
      // is never written to at all, so it keeps the pristine window-level panel
      // instead of acquiring tab-specific options it did not ask for.
      expect(mockSidePanel.setOptions).not.toHaveBeenCalled();
    });

    it('does not yield on a look-alike origin', async () => {
      // Configured before the worker starts: these cases are about what a
      // NAVIGATION does against an already-configured deployment.
      storageStore.dashboardUrl = SELF_HOSTED_DASHBOARD;
      mount();
      await settle();

      // Same host, different port, and a different host that merely contains
      // the configured one as a substring. Neither is the Dashboard.
      await navigate(2, `${SELF_HOSTED_DASHBOARD}:8443/cases`);
      await navigate(3, 'https://fm.internal.example.com.evil.test/cases');

      expect(await panelIsVisibleOn(2)).toBe(true);
      expect(await panelIsVisibleOn(3)).toBe(true);
      expect(mockSidePanel.setOptions).not.toHaveBeenCalled();
    });

    it('keeps the panel when a tab has no readable URL', async () => {
      mount();
      await settle();

      dispatchTabUpdate(4, { status: 'loading' }, { id: 4 });
      await settle();
      await navigate(5, 'about:blank');

      expect(await panelIsVisibleOn(4)).toBe(true);
      expect(await panelIsVisibleOn(5)).toBe(true);
      expect(mockSidePanel.setOptions).not.toHaveBeenCalled();
    });
  });

  describe('failure direction 2 — the panel must not double up on the Dashboard', () => {
    it('yields on the Cloud Dashboard origin', async () => {
      mount();
      await settle();

      await navigate(6, `${CLOUD_DASHBOARD}/cases/abc-123`);

      expect(mockSidePanel.setOptions).toHaveBeenCalledWith({ tabId: 6, enabled: false });
      expect(await panelIsVisibleOn(6)).toBe(false);
    });

    it('yields on a configured self-hosted Dashboard origin', async () => {
      // Configured before the worker starts: these cases are about what a
      // NAVIGATION does against an already-configured deployment.
      storageStore.dashboardUrl = SELF_HOSTED_DASHBOARD;
      mount();
      await settle();

      await navigate(7, `${SELF_HOSTED_DASHBOARD}/cases`);

      expect(await panelIsVisibleOn(7)).toBe(false);
    });
  });

  describe('the yield follows navigation', () => {
    it('yields when a tab navigates onto the Dashboard and releases it on the way back', async () => {
      mount();
      await settle();

      await navigate(8, `${GRAFANA}/d/abc/incident`);
      expect(await panelIsVisibleOn(8)).toBe(true);

      await navigate(8, `${CLOUD_DASHBOARD}/cases/abc-123`);
      expect(await panelIsVisibleOn(8)).toBe(false);

      await navigate(8, `${GRAFANA}/d/xyz/latency`);
      expect(await panelIsVisibleOn(8)).toBe(true);

      // The release restores the panel the manifest declares, read back off the
      // running manifest rather than duplicated here — so renaming the side
      // panel entry point cannot leave this pointing at a document that is gone.
      expect(mockSidePanel.setOptions).toHaveBeenCalledWith({
        tabId: 8,
        enabled: true,
        path: MANIFEST_PANEL_PATH,
      });
    });
  });

  describe('the yield follows the configured Dashboard URL', () => {
    it('moves to the new origin and releases the old one when Settings changes', async () => {
      const OLD_DASHBOARD = 'https://fm-old.example.com';
      const NEW_DASHBOARD = 'https://fm-new.example.com';

      mockBrowser.tabs.query.mockResolvedValue([
        { id: 20, url: `${OLD_DASHBOARD}/cases` },
        { id: 21, url: `${NEW_DASHBOARD}/cases` },
        { id: 22, url: `${GRAFANA}/d/abc` },
      ]);

      mount();
      await settle();

      await configureDashboardUrl(OLD_DASHBOARD);
      expect(await panelIsVisibleOn(20)).toBe(false);
      expect(await panelIsVisibleOn(21)).toBe(true);
      expect(await panelIsVisibleOn(22)).toBe(true);

      await configureDashboardUrl(NEW_DASHBOARD);

      // The old origin's tab gets the panel back...
      expect(await panelIsVisibleOn(20)).toBe(true);
      // ...the new origin's tab yields it...
      expect(await panelIsVisibleOn(21)).toBe(false);
      // ...and the unrelated tab was never touched by either pass.
      expect(await panelIsVisibleOn(22)).toBe(true);
      expect(mockSidePanel.setOptions).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 22 })
      );
    });

    it('reconciles the tabs that are already open when the worker starts', async () => {
      storageStore.dashboardUrl = SELF_HOSTED_DASHBOARD;
      mockBrowser.tabs.query.mockResolvedValue([
        { id: 30, url: `${SELF_HOSTED_DASHBOARD}/cases` },
        { id: 31, url: `${GRAFANA}/d/abc` },
      ]);

      mount();
      await settle();

      expect(await panelIsVisibleOn(30)).toBe(false);
      expect(await panelIsVisibleOn(31)).toBe(true);
    });
  });

  describe('non-Chromium targets', () => {
    it('registers nothing when the browser has no side panel API', async () => {
      // Firefox's MV2 build has no browser.sidePanel at all. Nothing about that
      // target may change, so the rule must not even attach a tab listener.
      delete mockBrowser.sidePanel;

      mount();
      await settle();

      expect(mockBrowser.tabs.onUpdated.addListener).not.toHaveBeenCalled();
      expect(listeners.tabUpdated).toBeUndefined();

      // And a Settings change still reconciles the auth bridge without throwing.
      mockBrowser.tabs.query.mockResolvedValue([{ id: 40, url: `${CLOUD_DASHBOARD}/cases` }]);
      await expect(configureDashboardUrl(CLOUD_DASHBOARD)).resolves.toBeUndefined();
    });
  });
});
