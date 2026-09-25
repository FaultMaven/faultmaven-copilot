import { describe, it, expect, vi } from 'vitest';
import { loadManifest } from '../support/manifest';

// See src/test/support/manifest.ts for why `wxt` is stubbed rather than loaded.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * The panel has a declared surface on every built target.
 *
 * Chromium shows it through `side_panel`. WXT strips that key from the Firefox
 * MV2 output without translating it, so the Firefox manifest must declare its
 * own `sidebar_action` — without it `browser.sidebarAction` does not exist and
 * nothing in the add-on can show the panel. Both must name the same document.
 *
 * Asserts the manifest FACTORY, not a built manifest on disk, so the answer
 * depends on the source alone.
 */
describe('panel surface per target', () => {
  it('declares a Firefox sidebar showing the same page as the Chrome side panel', async () => {
    const chrome = await loadManifest({ browser: 'chrome', manifestVersion: 3 });
    const firefox = await loadManifest({ browser: 'firefox', manifestVersion: 2 });

    const panelPath = (chrome.side_panel as { default_path?: string } | undefined)?.default_path;
    expect(panelPath).toBeTruthy();

    const sidebar = firefox.sidebar_action as { default_panel?: string } | undefined;
    expect(sidebar?.default_panel).toBe(panelPath);
  });

  it('keeps `sidebar_action` out of the Chrome manifest', async () => {
    // WXT does not strip it from the Chrome output, and Chrome does not know it.
    const chrome = await loadManifest({ browser: 'chrome', manifestVersion: 3 });
    expect(Object.prototype.hasOwnProperty.call(chrome, 'sidebar_action')).toBe(false);
  });
});
