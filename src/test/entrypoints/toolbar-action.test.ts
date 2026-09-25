import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The toolbar icon reveals the panel on every target the extension is built
 * for, and the background starts on every one of them.
 *
 * INVARIANT: the background registers only listeners whose API exists in the
 * browser it runs in. On Chromium (MV3) the toolbar icon is `action` and the
 * panel is `sidePanel`; on Firefox (MV2) the toolbar icon is `browserAction`
 * and the panel is the `sidebar_action` the manifest declares, reached through
 * `sidebarAction`. `wxt/browser` is the raw `browser`/`chrome` global — no
 * polyfill maps one onto the other — so an unconditional `browser.action.*`
 * throws while the MV2 background is still starting.
 *
 * These drive the BACKGROUND ENTRYPOINT against a browser object shaped like
 * each target, rather than testing a helper: whether `main()` survives startup
 * is itself part of the invariant.
 */

const { mockBrowser, clicks } = vi.hoisted(() => {
  (global as any).defineBackground = (config: any) => config;
  return {
    // Some modules read `runtime.getManifest` at import time; each test
    // replaces the whole shape before it mounts the background.
    mockBrowser: { runtime: { getManifest: () => ({}) } } as Record<string, any>,
    clicks: [] as Array<(tab: { id?: number; windowId?: number }) => unknown>,
  };
});

vi.mock('wxt/browser', () => ({ browser: mockBrowser }));
(global as any).browser = mockBrowser;

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  authManager: { saveAuthState: vi.fn(), clearAuthState: vi.fn() },
}));

// Not under test here, and it reaches for scripting/permissions APIs whose
// Firefox shape is irrelevant to the toolbar.
vi.mock('../../extension/auth/auth-bridge-registration', () => ({
  reconcileAuthBridgeRegistration: vi.fn(),
  unregisterAuthBridge: vi.fn(),
}));

import backgroundEntry from '../../entrypoints/background';

const listener = () => ({ addListener: vi.fn(), removeListener: vi.fn() });

/** A toolbar-button namespace whose click listener lands in `clicks`. */
function toolbarButton() {
  return {
    onClicked: {
      addListener: vi.fn((fn: (tab: { id?: number; windowId?: number }) => unknown) => {
        clicks.push(fn);
      }),
      removeListener: vi.fn(),
    },
  };
}

/** Everything both targets expose that the background touches at startup. */
function commonApis() {
  return {
    runtime: {
      id: 'test-copilot-id',
      onMessage: listener(),
      onInstalled: listener(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `moz-extension://test-copilot-id${path}`),
      getManifest: vi.fn(() => ({})),
    },
    identity: {
      getRedirectURL: vi.fn(() => 'https://0123456789abcdef0123456789abcdef01234567.extensions.allizom.org/'),
      launchWebAuthFlow: vi.fn(),
    },
    tabs: { onUpdated: listener(), query: vi.fn().mockResolvedValue([]) },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: listener(),
      onRemoved: listener(),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: listener(),
    },
  };
}

/** Chrome MV3: `action` + `sidePanel`. */
function chromeMv3() {
  return {
    ...commonApis(),
    action: toolbarButton(),
    sidePanel: {
      open: vi.fn().mockResolvedValue(undefined),
      setOptions: vi.fn().mockResolvedValue(undefined),
      getOptions: vi.fn().mockResolvedValue({ enabled: true }),
    },
  };
}

/**
 * Firefox MV2 as the built manifest declares it: `browser_action` +
 * `sidebar_action`, so the namespaces are `browserAction` and `sidebarAction`.
 * There is no `action` and no `sidePanel`.
 */
function firefoxMv2() {
  return {
    ...commonApis(),
    browserAction: toolbarButton(),
    sidebarAction: {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      toggle: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function useBrowser(shape: Record<string, any>) {
  for (const key of Object.keys(mockBrowser)) delete mockBrowser[key];
  Object.assign(mockBrowser, shape);
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toolbar icon', () => {
  beforeEach(() => {
    clicks.length = 0;
  });

  describe('Chrome MV3 (action + sidePanel)', () => {
    it('opens the side panel for the clicked window', async () => {
      useBrowser(chromeMv3());

      expect(() => backgroundEntry.main()).not.toThrow();
      expect(mockBrowser.action.onClicked.addListener).toHaveBeenCalledTimes(1);

      await clicks[0]({ id: 7, windowId: 3 });

      expect(mockBrowser.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    });
  });

  describe('Firefox MV2 (browserAction + sidebarAction)', () => {
    it('starts without throwing', () => {
      useBrowser(firefoxMv2());

      expect(() => backgroundEntry.main()).not.toThrow();
    });

    it('opens the sidebar from the toolbar click, synchronously', () => {
      useBrowser(firefoxMv2());
      backgroundEntry.main();

      expect(mockBrowser.browserAction.onClicked.addListener).toHaveBeenCalledTimes(1);
      expect(clicks).toHaveLength(1);

      // Firefox honours sidebarAction.open() only while the user-input handler
      // is still on the stack: a call after any `await` is refused with "may
      // only be called from a user input handler". So the call must already
      // have happened when the listener returns, before anything settles.
      void clicks[0]({ id: 7, windowId: 3 });

      expect(mockBrowser.sidebarAction.open).toHaveBeenCalledTimes(1);
    });

    it('handles a refused open rather than leaving an unhandled rejection', async () => {
      // A plain function, not `vi.fn().mockRejectedValue()`: a vitest mock
      // subscribes to every promise it returns (to record `settledResults`),
      // which marks the rejection handled and would hide a missing `.catch`.
      let opens = 0;
      const shape = firefoxMv2();
      shape.sidebarAction.open = (() => {
        opens++;
        return Promise.reject(new Error('refused'));
      }) as typeof shape.sidebarAction.open;
      useBrowser(shape);
      backgroundEntry.main();

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        clicks[0]({ id: 7, windowId: 3 });
        await settle();
      } finally {
        process.off('unhandledRejection', unhandled);
      }

      expect(opens).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe('a browser with a toolbar button but no panel API', () => {
    it('starts, and registers no click handler that could reach a missing API', () => {
      // An MV2 manifest without `sidebar_action` (or any future target that
      // has neither panel API): there is nothing the click could reveal.
      const shape: Record<string, any> = firefoxMv2();
      delete shape.sidebarAction;
      useBrowser(shape);

      expect(() => backgroundEntry.main()).not.toThrow();
      expect(mockBrowser.browserAction.onClicked.addListener).not.toHaveBeenCalled();
      expect(clicks).toHaveLength(0);
    });
  });
});
