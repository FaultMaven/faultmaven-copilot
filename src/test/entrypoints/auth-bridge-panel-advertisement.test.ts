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
  DASHBOARD_PANEL_WITHDRAWN_MESSAGE,
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

function reportedWithdrawal(): boolean {
  return mockBrowser.runtime.sendMessage.mock.calls.some(
    (call: any[]) => call[0]?.action === 'dashboardPanelWithdrawn'
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
    /**
     * ADR-018 D0 row 7: the attribute NO LONGER YIELDS, in any value.
     *
     * It is a claim about the BUILD — "this deployment could host a panel" —
     * and it is in the initial HTML, before React and before there is a user.
     * It therefore cannot express the two things that actually decide whether a
     * panel is on screen: a per-profile preference, and a route (one document
     * serves `/login` and `/cases`). Yielding on it hid the extension's panel
     * on pages that mount none, and could never be retracted.
     *
     * Every value is asserted, not just the advertising one, because the
     * regression to guard against is someone restoring the document_end read —
     * and a test that only checked `'1'` would let `'true'` back in.
     */
    it.each(['1', 'true', '2.1.0', '', 'false', '0'])(
      'never reports a panel on the strength of the attribute alone (%o)',
      async (value) => {
        document.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, value);

        bridge.main!({} as any);
        await settle();

        expect(reportedPanel()).toBe(false);
      }
    );

    it('reports nothing when the page carries no attribute at all', async () => {
      bridge.main!({} as any);
      await settle();

      // Silence is still the safe answer, and now it is the ONLY answer the
      // attribute can give. This is the deployment-lag case — an older
      // self-hosted image, or Cloud before its own panel ships.
      expect(reportedPanel()).toBe(false);
    });
  });

  describe('the withdrawal (ADR-018 D0)', () => {
    it('forwards a withdrawal from the Dashboard origin', async () => {
      // The counterpart to the advertisement. Without it the claim is
      // monotonic — a page can say "I host a panel" and never "not any more" —
      // and a user who turns the built-in panel off on an already-yielded tab
      // is left with NEITHER surface.
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_WITHDRAWN_MESSAGE }, CLOUD_DASHBOARD);

      expect(reportedWithdrawal()).toBe(true);
    });

    it('forwards a withdrawal from a configured self-hosted Dashboard', async () => {
      storageStore.dashboardUrl = SELF_HOSTED_DASHBOARD;
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_WITHDRAWN_MESSAGE }, SELF_HOSTED_DASHBOARD);

      expect(reportedWithdrawal()).toBe(true);
    });

    it('ignores a withdrawal from an untrusted origin', async () => {
      // The same origin gate as every other message on this channel. A
      // withdrawal from elsewhere cannot do harm — releasing only ever SHOWS
      // the panel — but the bridge has one rule about who may speak to it, and
      // an exception here would be a second rule to keep in step.
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_WITHDRAWN_MESSAGE }, 'https://evil.example.com');

      expect(reportedWithdrawal()).toBe(false);
    });

    it('does not confuse the two messages in either direction', async () => {
      // They differ by one word in a string constant and mean opposite things.
      bridge.main!({} as any);
      await settle();

      await pagePosts({ type: DASHBOARD_PANEL_MESSAGE }, CLOUD_DASHBOARD);
      expect(reportedPanel()).toBe(true);
      expect(reportedWithdrawal()).toBe(false);

      vi.clearAllMocks();

      await pagePosts({ type: DASHBOARD_PANEL_WITHDRAWN_MESSAGE }, CLOUD_DASHBOARD);
      expect(reportedWithdrawal()).toBe(true);
      expect(reportedPanel()).toBe(false);
    });
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
