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

  it('does not open the Firefox sidebar on install', async () => {
    // Firefox opens a new add-on's sidebar at install unless told not to;
    // Chrome never opens the side panel unasked. The toolbar icon opens it on both.
    const firefox = await loadManifest({ browser: 'firefox', manifestVersion: 2 });
    const sidebar = firefox.sidebar_action as { open_at_install?: boolean } | undefined;
    expect(sidebar?.open_at_install).toBe(false);
  });

  it('requests `sidePanel` on Chromium only', async () => {
    // Firefox has no such permission (its sidebar needs none), WXT does not
    // strip it, and AMO's linter reports it as invalid.
    const chrome = await loadManifest({ browser: 'chrome', manifestVersion: 3 });
    const firefox = await loadManifest({ browser: 'firefox', manifestVersion: 2 });
    expect(chrome.permissions).toContain('sidePanel');
    expect(firefox.permissions).not.toContain('sidePanel');
    // Nothing else moves: the two lists differ by exactly that entry.
    expect((chrome.permissions as string[]).filter((p) => p !== 'sidePanel')).toEqual(firefox.permissions);
  });

  it('keeps `sidebar_action` out of the Chrome manifest', async () => {
    // WXT does not strip it from the Chrome output, and Chrome does not know it.
    const chrome = await loadManifest({ browser: 'chrome', manifestVersion: 3 });
    expect(Object.prototype.hasOwnProperty.call(chrome, 'sidebar_action')).toBe(false);
  });
});
