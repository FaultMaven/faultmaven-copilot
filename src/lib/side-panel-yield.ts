// src/lib/side-panel-yield.ts
import { browser } from 'wxt/browser';
import { isTrustedDashboardOrigin } from './auth/trusted-origin';
import { createLogger } from './utils/logger';

/**
 * Yield the side panel on Dashboard tabs.
 *
 * The panel is opened window-wide (`sidePanel.open({ windowId })` in the
 * toolbar-icon handler), so it stays visible on every tab in that window. On a
 * Dashboard tab the page already IS the product: signed out that is two sign-in
 * boxes side by side, and signed in it will be two chat panels for one account
 * once the dashboard ships its own panel.
 *
 * INVARIANT: on a tab whose origin is a configured Dashboard origin the panel is
 * not visible; on every other tab it behaves exactly as before.
 *
 * The two failure directions are NOT symmetric. Suppressing the panel on a
 * non-Dashboard tab (Grafana, an AWS console, local tooling) removes the product
 * from the only surface it has there, and is far worse than leaving it up on the
 * Dashboard. Every decision below therefore fails towards "show the panel":
 * an unreadable URL, an opaque origin, a storage read that throws, a browser
 * that does not offer the API — all leave the tab alone.
 *
 * ORIGIN SET — one source of truth. `isTrustedDashboardOrigin` already answers
 * "is this origin the Dashboard?" for the auth bridge (Cloud default plus the
 * user's configured `dashboardUrl`). This reuses that predicate rather than
 * deriving a second list, so the yield rule cannot drift away from the origin
 * the bridge is registered and trusted for.
 */

const log = createLogger('SidePanelYield');

/**
 * The slice of `chrome.sidePanel` this rule needs.
 *
 * Declared locally rather than imported: `browser.sidePanel` is typed for the
 * Chromium build, and feature-detecting through this shape is what lets the
 * same module load harmlessly on a target that has no side panel at all.
 */
interface PanelOptions {
  tabId?: number;
  path?: string;
  enabled?: boolean;
}

interface PerTabSidePanel {
  setOptions(options: PanelOptions): Promise<void>;
  getOptions(options: { tabId?: number }): Promise<PanelOptions>;
}

/**
 * The per-tab side panel API, or null where it does not exist.
 *
 * Chromium only. Firefox's MV2 build has no `browser.sidePanel` whatsoever, and
 * wxt.config.ts already treats the side panel as a Chromium-family feature (the
 * `minimum_chrome_version` floor is emitted for chrome/edge/opera and withheld
 * from firefox for exactly this reason). Feature-detection rather than a second
 * build-target list: a list here would be a copy of that one, free to drift, and
 * the thing we actually depend on is whether the methods exist.
 *
 * `setOptions` AND `getOptions` are both required — the release path reads
 * before it writes, so a target with only half the API must be left alone
 * rather than half-driven.
 */
function perTabSidePanel(): PerTabSidePanel | null {
  const api = (browser as unknown as { sidePanel?: Partial<PerTabSidePanel> }).sidePanel;
  if (!api || typeof api.setOptions !== 'function' || typeof api.getOptions !== 'function') {
    return null;
  }
  return api as PerTabSidePanel;
}

/**
 * The window-level panel document, read from the manifest we are actually
 * running.
 *
 * Chromium has no "clear these tab options" call, so releasing a tab means
 * setting `enabled: true` again, and the documented form of that call carries a
 * `path`. Reading `side_panel.default_path` back from the manifest keeps this
 * from becoming a second copy of the path declared in wxt.config.ts — a copy
 * that would silently point at a document that no longer exists if the entry
 * point were ever renamed.
 */
function globalPanelPath(): string | undefined {
  try {
    const manifest = browser.runtime.getManifest() as { side_panel?: { default_path?: string } };
    return manifest?.side_panel?.default_path;
  } catch {
    return undefined;
  }
}

/** Is this tab showing a configured Dashboard origin? */
async function isDashboardTab(url: string | undefined): Promise<boolean> {
  if (!url) return false;

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    // Not a URL we can reason about (browser-internal pages, a blank tab).
    return false;
  }

  // `about:blank`, `data:` and friends serialize to the opaque origin "null".
  // Never treat that as the Dashboard — an opaque origin is not evidence.
  if (!origin || origin === 'null') return false;

  return isTrustedDashboardOrigin(origin);
}

/**
 * Apply the invariant to one tab.
 *
 * Yielding writes `enabled: false` for that tab id only: Chromium hides the
 * panel while such a tab is in front and brings the window-level panel straight
 * back on any other tab, so nothing about the window-wide open path changes.
 *
 * Releasing is deliberately narrower than "everything that is not the
 * Dashboard". It reads the tab's CURRENT options first and writes only when
 * they actually say `enabled: false` — i.e. only to tabs this rule (or a
 * previous run of it) suppressed. Two things follow, both of them about the
 * worse failure direction:
 *
 *  - A tab that has never been on the Dashboard is never written to at all, so
 *    it keeps the pristine window-level panel rather than acquiring tab-specific
 *    options it did not ask for.
 *  - The browser's own per-tab state is the memory, not a Set in this worker.
 *    An MV3 worker is evicted routinely; anything it remembered about which tabs
 *    it had disabled would be gone by the time that tab navigated away, and the
 *    tab would stay dark. Reading the state back cannot lose it.
 */
export async function reconcileSidePanelForTab(
  tabId: number | undefined,
  url: string | undefined
): Promise<void> {
  const sidePanel = perTabSidePanel();
  if (!sidePanel) return;
  if (typeof tabId !== 'number' || tabId < 0) return;

  try {
    if (await isDashboardTab(url)) {
      await sidePanel.setOptions({ tabId, enabled: false });
      return;
    }

    const current = await sidePanel.getOptions({ tabId });
    // Only an explicit `false` is ours to undo. A tab with no tab-specific
    // options reports the defaults, and must be left exactly as it is.
    if (current?.enabled !== false) return;

    const path = globalPanelPath();
    await sidePanel.setOptions({ tabId, enabled: true, ...(path ? { path } : {}) });
  } catch (error) {
    // A tab can close underneath us, and a browser can refuse an option write.
    // Neither is worth failing anything over: the next navigation reconciles.
    log.debug('Side panel reconcile skipped for tab', { tabId, error });
  }
}

/**
 * Apply the invariant to every open tab.
 *
 * Two callers, both of which change the ANSWER for tabs nobody is navigating:
 * worker startup (the browser may have restored Dashboard tabs, and per-tab
 * options do not necessarily survive an extension reload), and a change to the
 * configured Dashboard URL — which must release the old origin's tabs in the
 * same pass that yields on the new one's.
 */
export async function reconcileSidePanelForAllTabs(): Promise<void> {
  if (!perTabSidePanel()) return;

  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => reconcileSidePanelForTab(tab.id, tab.url)));
  } catch (error) {
    log.warn('Could not reconcile side panel visibility across tabs', error);
  }
}
