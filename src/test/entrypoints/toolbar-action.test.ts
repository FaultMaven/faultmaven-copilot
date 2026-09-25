import { describe, it, expect, vi, beforeAll } from 'vitest';
import { chromeMv3Shape, firefoxMv2Shape, type BrowserShape } from '../support/browser-shapes';

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
 * Each case installs its target's `browser` BEFORE importing the background,
 * so every module-level read sees that target rather than a shape captured by
 * an earlier import.
 */

const state = vi.hoisted(() => {
  (globalThis as any).defineBackground = (config: unknown) => config;
  return { current: {} as Record<string, any> };
});

// A getter, so a re-imported module graph reads the shape installed for it.
vi.mock('wxt/browser', () => ({
  get browser() {
    return state.current;
  },
}));

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  authManager: { saveAuthState: vi.fn(), clearAuthState: vi.fn() },
}));

// Not under test here.
vi.mock('../../extension/auth/auth-bridge-registration', () => ({
  reconcileAuthBridgeRegistration: vi.fn(),
  unregisterAuthBridge: vi.fn(),
}));

// Import (and so transform) the background's module graph once, up front, with
// a generous timeout. Each case then re-imports it after `vi.resetModules()`,
// which re-evaluates but reuses the transform; without this the first case pays
// for the whole graph and can time out under a loaded full-suite run.
beforeAll(async () => {
  state.current = firefoxMv2Shape().browser;
  await import('../../entrypoints/background');
}, 60_000);

async function loadBackgroundWith(shape: BrowserShape): Promise<{ main(): void }> {
  state.current = shape.browser;
  (globalThis as any).browser = shape.browser;
  vi.resetModules();
  return (await import('../../entrypoints/background')).default as { main(): void };
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toolbar icon', () => {
  describe('Chrome MV3 (action + sidePanel)', () => {
    it('opens the side panel for the clicked window', async () => {
      const shape = chromeMv3Shape();
      const background = await loadBackgroundWith(shape);

      expect(() => background.main()).not.toThrow();
      expect(shape.browser.action.onClicked.addListener).toHaveBeenCalledTimes(1);

      shape.listeners.toolbarClick({ id: 7, windowId: 3 });
      await settle();

      expect(shape.browser.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    });
  });

  describe('Firefox MV2 (browserAction + sidebarAction)', () => {
    it('starts without throwing, and wires the toolbar and the per-tab yield', async () => {
      const shape = firefoxMv2Shape();
      const background = await loadBackgroundWith(shape);

      expect(() => background.main()).not.toThrow();
      expect(shape.browser.browserAction.onClicked.addListener).toHaveBeenCalledTimes(1);
      // The Dashboard yield runs on Firefox too (side-panel-yield.ts), so the
      // navigation listener that releases it must be there.
      expect(shape.browser.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    });

    it('opens the sidebar from the toolbar click, synchronously', async () => {
      const shape = firefoxMv2Shape();
      (await loadBackgroundWith(shape)).main();

      // Firefox honours sidebarAction.open() only while the user-input handler
      // is still on the stack: a call after any `await` is refused with "may
      // only be called from a user input handler". So the call must already
      // have happened when the listener returns, before anything settles.
      shape.listeners.toolbarClick({ id: 7, windowId: 3 });

      expect(shape.browser.sidebarAction.open).toHaveBeenCalledTimes(1);
    });

    it('handles a refused open rather than leaving an unhandled rejection', async () => {
      // A plain function, not `vi.fn().mockRejectedValue()`: a vitest mock
      // subscribes to every promise it returns (to record `settledResults`),
      // which marks the rejection handled and would hide a missing `.catch`.
      let opens = 0;
      const shape = firefoxMv2Shape();
      shape.browser.sidebarAction.open = () => {
        opens++;
        return Promise.reject(new Error('refused'));
      };
      (await loadBackgroundWith(shape)).main();

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        shape.listeners.toolbarClick({ id: 7, windowId: 3 });
        await settle();
      } finally {
        process.off('unhandledRejection', unhandled);
      }

      expect(opens).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe('a browser with a toolbar button but no usable panel API', () => {
    it.each([
      ['no sidebarAction at all (an MV2 manifest without sidebar_action)', (b: Record<string, any>) => {
        delete b.sidebarAction;
      }],
      ['a sidebarAction without the per-tab calls', (b: Record<string, any>) => {
        delete b.sidebarAction.setPanel;
        delete b.sidebarAction.getPanel;
      }],
    ])('%s: starts, and registers nothing that could reach a missing API', async (_label, strip) => {
      const shape = firefoxMv2Shape();
      strip(shape.browser);
      const background = await loadBackgroundWith(shape);

      expect(() => background.main()).not.toThrow();
      expect(shape.browser.browserAction.onClicked.addListener).not.toHaveBeenCalled();
      expect(shape.browser.tabs.onUpdated.addListener).not.toHaveBeenCalled();
    });
  });
});
