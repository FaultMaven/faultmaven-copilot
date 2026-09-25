import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { firefoxMv2Shape, type FirefoxShape } from '../support/browser-shapes';

/**
 * The Dashboard yield on Firefox (ADR-018), through the Firefox sidebar.
 *
 * Firefox's sidebar is window-wide, like Chromium's side panel, so on a
 * Dashboard tab that shows its own copilot it would double up. Firefox cannot
 * hide an open sidebar per tab; it can give one tab its own panel. So a yielded
 * tab shows a small placeholder page (`sidebarAction.setPanel({ tabId, panel })`)
 * and releasing it clears that tab's panel (`panel: null`), which hands it back
 * the global one.
 *
 * WHEN the panel yields and releases is the shared rule in side-panel-yield.ts,
 * covered in depth against Chromium by side-panel-yield.test.ts. These cases
 * prove the Firefox surface is driven by that same rule — each yield trigger and
 * each release trigger — and that it keeps the sole-writer property the release
 * path depends on.
 */

const state = vi.hoisted(() => {
  (globalThis as any).defineBackground = (config: unknown) => config;
  return { current: {} as Record<string, any> };
});

vi.mock('wxt/browser', () => ({
  get browser() {
    return state.current;
  },
}));

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  authManager: { saveAuthState: vi.fn(), clearAuthState: vi.fn() },
}));

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

const CLOUD_DASHBOARD = 'https://app.faultmaven.ai';
const SELF_HOSTED_DASHBOARD = 'https://fm.internal.example.com';
const GRAFANA = 'https://grafana.example.com';
const PLACEHOLDER = 'moz-extension://test-copilot-id/panel_yielded.html';

let shape: FirefoxShape;

async function start(
  tabs: Array<{ id: number; url: string }> = [],
  seed: (s: FirefoxShape) => void = () => {},
) {
  shape = firefoxMv2Shape();
  shape.browser.tabs.query.mockResolvedValue(tabs);
  seed(shape);
  state.current = shape.browser;
  (globalThis as any).browser = shape.browser;
  vi.resetModules();
  const background = (await import('../../entrypoints/background')).default as { main(): void };
  background.main();
  await settle();
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The panel Firefox would show in the sidebar while this tab is in front. */
function panelOn(tabId: number): Promise<string> {
  return shape.browser.sidebarAction.getPanel({ tabId });
}

async function advertise(tabId: number, origin: string) {
  shape.listeners.message(
    { action: 'dashboardPanelAvailable' },
    { id: 'test-copilot-id', tab: { id: tabId }, url: `${origin}/cases` },
    vi.fn(),
  );
  await settle();
}

async function withdraw(tabId: number) {
  shape.listeners.message(
    { action: 'dashboardPanelWithdrawn' },
    { id: 'test-copilot-id', tab: { id: tabId } },
    vi.fn(),
  );
  await settle();
}

async function update(tabId: number, changeInfo: Record<string, unknown>, url: string) {
  shape.listeners.tabUpdated(tabId, changeInfo, { id: tabId, url });
  await settle();
}

describe('Firefox sidebar yields on Dashboard tabs that show their own copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the placeholder on a Dashboard tab that advertises, and nowhere else', async () => {
    await start();
    await advertise(10, CLOUD_DASHBOARD);

    expect(await panelOn(10)).toBe(PLACEHOLDER);
    // Another tab in the window keeps the real panel.
    expect(await panelOn(11)).toBe(shape.globalPanelUrl);
  });

  it('yields for a configured self-hosted Dashboard', async () => {
    await start();
    shape.storage.dashboardUrl = SELF_HOSTED_DASHBOARD;
    await advertise(12, SELF_HOSTED_DASHBOARD);

    expect(await panelOn(12)).toBe(PLACEHOLDER);
  });

  it('ignores an advertisement from a non-Dashboard origin', async () => {
    await start();
    await advertise(13, GRAFANA);

    expect(await panelOn(13)).toBe(shape.globalPanelUrl);
    expect(shape.browser.sidebarAction.setPanel).not.toHaveBeenCalled();
  });

  it('releases when the page withdraws its panel', async () => {
    await start();
    await advertise(14, CLOUD_DASHBOARD);
    expect(await panelOn(14)).toBe(PLACEHOLDER);
    await withdraw(14);

    expect(await panelOn(14)).toBe(shape.globalPanelUrl);
    expect(shape.panelByTab.has(14)).toBe(false);
  });

  it('releases when the tab loads a new document, but not on the updates a page emits after asserting', async () => {
    await start();
    await advertise(15, CLOUD_DASHBOARD);

    // Title/favicon/SPA-route updates on the same document keep the yield.
    await update(15, { title: 'Case 42' }, `${CLOUD_DASHBOARD}/cases/42`);
    await update(15, { status: 'complete' }, `${CLOUD_DASHBOARD}/cases/42`);
    expect(await panelOn(15)).toBe(PLACEHOLDER);

    // A new document voids the old document's claim.
    await update(15, { status: 'loading' }, `${CLOUD_DASHBOARD}/cases/42`);
    expect(await panelOn(15)).toBe(shape.globalPanelUrl);
  });

  it('releases when the tab navigates off the Dashboard', async () => {
    await start();
    await advertise(16, CLOUD_DASHBOARD);
    expect(await panelOn(16)).toBe(PLACEHOLDER);
    await update(16, { status: 'complete', url: `${GRAFANA}/d/abc` }, `${GRAFANA}/d/abc`);

    expect(await panelOn(16)).toBe(shape.globalPanelUrl);
  });

  it('releases the old origin when the configured Dashboard URL changes', async () => {
    await start();
    shape.storage.dashboardUrl = SELF_HOSTED_DASHBOARD;
    await advertise(17, SELF_HOSTED_DASHBOARD);
    expect(await panelOn(17)).toBe(PLACEHOLDER);

    shape.browser.tabs.query.mockResolvedValue([{ id: 17, url: `${SELF_HOSTED_DASHBOARD}/cases` }]);
    shape.storage.dashboardUrl = 'https://other.example.com';
    shape.listeners.storageChanged({ dashboardUrl: { newValue: 'https://other.example.com' } }, 'local');
    await settle();

    expect(await panelOn(17)).toBe(shape.globalPanelUrl);
  });

  it('releases, at startup, a yielded tab that left the Dashboard while the background was down', async () => {
    // The browser, not the background, remembers per-tab panels: a restarted
    // background finds tab 18 still showing the placeholder, now on Grafana.
    await start([{ id: 18, url: `${GRAFANA}/d/abc` }], (s) => {
      s.panelByTab.set(18, PLACEHOLDER);
    });

    expect(await panelOn(18)).toBe(shape.globalPanelUrl);
  });

  it('leaves, at startup, a yielded tab that is still on the Dashboard', async () => {
    // Whether that page still shows its panel is not something a URL can
    // answer; only its own withdrawal or a new document releases it.
    await start([{ id: 21, url: `${CLOUD_DASHBOARD}/cases` }], (s) => {
      s.panelByTab.set(21, PLACEHOLDER);
    });

    expect(await panelOn(21)).toBe(PLACEHOLDER);
  });

  it('never writes to a tab it did not yield (sole writer)', async () => {
    await start();
    // A tab showing some other tab-specific panel is not this rule's to clear.
    shape.panelByTab.set(19, 'moz-extension://test-copilot-id/something_else.html');

    await withdraw(19);
    await update(19, { status: 'loading' }, `${GRAFANA}/`);
    await update(20, { status: 'loading' }, `${GRAFANA}/`);

    expect(shape.browser.sidebarAction.setPanel).not.toHaveBeenCalled();
    expect(await panelOn(19)).toBe('moz-extension://test-copilot-id/something_else.html');
  });
});
