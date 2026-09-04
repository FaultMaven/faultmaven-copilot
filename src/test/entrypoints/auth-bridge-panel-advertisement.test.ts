import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The page -> extension half of the built-in panel contract (#229).
 *
 * The Dashboard advertises that IT hosts the copilot panel; the auth-bridge
 * content script is the channel that carries the claim to the background. These
 * bind the shape of that contract (the attribute and the message named in
 * lib/auth/presence-marker.ts) and, just as importantly, that the claim is
 * refused from anywhere it must not be honoured.
 */

const { mockBrowser, storageStore, MANIFEST_VERSION } = vi.hoisted(() => {
  const MANIFEST_VERSION = '1.0.3';
  (global as any).defineContentScript = (config: any) => config;

  const storageStore: Record<string, any> = {};

  return {
    MANIFEST_VERSION,
    storageStore,
    mockBrowser: {
      runtime: {
        id: 'test-copilot-id',
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getManifest: vi.fn(() => ({ version: MANIFEST_VERSION })),
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
        },
      },
    },
  };
});

vi.mock('wxt/browser', () => ({ browser: mockBrowser }));

import bridge from '../../entrypoints/auth-bridge.content';
import {
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
} from '../../extension/auth/presence-marker';

const CLOUD_DASHBOARD = 'https://app.faultmaven.ai';
const SELF_HOSTED_DASHBOARD = 'https://fm.internal.example.com';

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Did the bridge report a built-in panel to the background? */
function reportedPanel(): boolean {
  return mockBrowser.runtime.sendMessage.mock.calls.some(
    (call: any[]) => call[0]?.action === 'dashboardPanelAvailable'
  );
}

/** Post a message the way the Dashboard page would. */
async function pagePosts(data: any, origin: string, source: any = window) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  await settle();
}

describe('Dashboard built-in panel advertisement (bridge side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    document.documentElement.removeAttribute(DASHBOARD_PANEL_ATTR);
    localStorage.clear();
  });

  describe('the attribute the page renders into its initial HTML', () => {
    it('reports a built-in panel when the attribute advertises', async () => {
      document.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, '1');

      bridge.main!({} as any);
      await settle();

      expect(reportedPanel()).toBe(true);
    });

    it('reports nothing when the page carries no attribute at all', async () => {
      bridge.main!({} as any);
      await settle();

      // Silence is the safe answer: a Dashboard that says nothing keeps the
      // extension's panel. This is the deployment-lag case — an older
      // self-hosted image, or Cloud before its own panel ships.
      expect(reportedPanel()).toBe(false);
    });

    it.each(['', 'false', '0'])(
      'treats the attribute value %o as NOT advertising',
      async (value) => {
        document.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, value);

        bridge.main!({} as any);
        await settle();

        // So a Dashboard can render the attribute unconditionally and flip it.
        expect(reportedPanel()).toBe(false);
      }
    );
  });

  describe('the message a page posts when it only learns later', () => {
    it('reports a built-in panel advertised after the document loaded', async () => {
      bridge.main!({} as any);
      await settle();
      expect(reportedPanel()).toBe(false);

      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, CLOUD_DASHBOARD);

      expect(reportedPanel()).toBe(true);
    });

    it('honours the message on a configured self-hosted Dashboard origin', async () => {
      storageStore.dashboardUrl = SELF_HOSTED_DASHBOARD;

      bridge.main!({} as any);
      await settle();
      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, SELF_HOSTED_DASHBOARD);

      expect(reportedPanel()).toBe(true);
    });

    it('refuses the message from an untrusted origin', async () => {
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, 'https://evil.example.com');
      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, 'https://grafana.example.com');

      expect(reportedPanel()).toBe(false);
    });

    it('refuses the message from a different window (an embedded frame)', async () => {
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, CLOUD_DASHBOARD, {} as any);

      expect(reportedPanel()).toBe(false);
    });
  });
});
