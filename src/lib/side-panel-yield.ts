// src/lib/side-panel-yield.ts
import { browser } from 'wxt/browser';
import { isTrustedDashboardOrigin } from './auth/trusted-origin';
import { createLogger } from './utils/logger';

/**
 * Yield the side panel on Dashboard tabs that host their own copilot panel.
 *
 * The panel is opened window-wide (`sidePanel.open({ windowId })` in the
 * toolbar-icon handler), so it stays visible on every tab in that window. On a
 * Dashboard tab that renders the copilot itself, the page already IS the
 * product: signed out that is two sign-in boxes side by side, signed in it is
 * two chat panels for one account.
 *
 * INVARIANT: on a tab whose origin is a configured Dashboard origin AND whose
 * page advertises that it hosts the built-in panel, the extension's panel is
 * not visible. On every other tab — including a Dashboard that does NOT
 * advertise — it behaves exactly as before.
 *
 * Origin alone is deliberately NOT enough. A self-hosted Dashboard image from
 * before the built-in panel shipped, or Cloud between this extension release
 * and its own, has no panel to yield to; yielding on origin would delete a
 * workflow people use today (a case open on the Dashboard with the panel beside
 * it) on the deployment calendar rather than on any real signal. The page has to
 * say so itself — see DASHBOARD_PANEL_ATTR / DASHBOARD_PANEL_MESSAGE in
 * lib/auth/presence-marker.ts for the cross-repo contract.
 *
 * The two failure directions are NOT symmetric. Suppressing the panel on a tab
 * that has no built-in panel of its own removes the product from the only
 * surface it has there, and is far worse than leaving it up next to one. Every
 * decision below therefore fails towards "show the panel": an unreadable URL,
 * an opaque origin, a storage read that throws, a page that says nothing, a
 * browser without the API — all leave the tab alone.
 *
 * ORIGIN SET — one source of truth. `isTrustedDashboardOrigin` already answers
 * "is this origin the Dashboard?" for the auth bridge (Cloud default plus the
 * user's configured `dashboardUrl`). Both the advertisement check and the
 * release rule reuse that predicate rather than deriving a second list.
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

/** The origin of a URL, or undefined where there isn't a meaningful one. */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    // Not a URL we can reason about (browser-internal pages, a blank tab).
    return undefined;
  }
  // `about:blank`, `data:` and friends serialize to the opaque origin "null".
  // An opaque origin is not evidence of anything.
  if (!origin || origin === 'null') return undefined;
  return origin;
}

/** Is this tab showing a configured Dashboard origin? */
async function isDashboardTab(url: string | undefined): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return false;
  return isTrustedDashboardOrigin(origin);
}

/**
 * Hide the panel on one tab. Chromium hides it only while that tab is in front
 * and brings the window-level panel straight back on any other tab, so nothing
 * about the window-wide open path changes.
 */
async function yieldTab(sidePanel: PerTabSidePanel, tabId: number): Promise<void> {
  await sidePanel.setOptions({ tabId, enabled: false });
}

/**
 * Give one tab its panel back — but only if this rule is what took it away.
 *
 * The tab's CURRENT options are read first and rewritten only when they
 * actually say `enabled: false`. Two things follow, both of them about the
 * worse failure direction:
 *
 *  - A tab this rule never suppressed is not written to at all, so it keeps the
 *    pristine window-level panel rather than acquiring tab-specific options it
 *    did not ask for.
 *  - The browser's own per-tab state is the memory, not a Set in this worker.
 *    An MV3 worker is evicted routinely; anything it remembered about which tabs
 *    it had disabled would be gone by the time that tab navigated away, and the
 *    tab would stay dark. Reading the state back cannot lose it.
 */
async function releaseTab(sidePanel: PerTabSidePanel, tabId: number): Promise<void> {
  const current = await sidePanel.getOptions({ tabId });
  // Only an explicit `false` is ours to undo. A tab with no tab-specific
  // options reports the defaults, and must be left exactly as it is.
  if (current?.enabled !== false) return;

  const path = globalPanelPath();
  await sidePanel.setOptions({ tabId, enabled: true, ...(path ? { path } : {}) });
}

/**
 * A Dashboard page has told us it hosts the built-in copilot panel.
 *
 * `origin` must be the origin the BROWSER attributed to the sender, never one
 * the page put in the message body — a page cannot be trusted to name itself.
 * The content script already refuses to forward this from an untrusted origin;
 * re-checking here means a compromised or confused content script still cannot
 * make an arbitrary site suppress the panel, which is the whole of failure
 * direction 1.
 *
 * This is the ONLY thing that hides the panel. Origin alone never does.
 */
export async function yieldSidePanelForAdvertisedTab(
  tabId: number | undefined,
  origin: string | undefined
): Promise<void> {
  const sidePanel = perTabSidePanel();
  if (!sidePanel) return;
  if (typeof tabId !== 'number' || tabId < 0) return;
  if (!origin) return;

  try {
    if (!(await isTrustedDashboardOrigin(origin))) {
      log.warn('Ignoring a built-in panel advertisement from a non-Dashboard origin', { origin });
      return;
    }
    await yieldTab(sidePanel, tabId);
  } catch (error) {
    log.debug('Could not yield the side panel for an advertising tab', { tabId, error });
  }
}

/**
 * Bring one tab back into line with the invariant.
 *
 * This only ever RELEASES. A tab that has left the Dashboard gets its panel
 * back; a tab that is ON a Dashboard origin is left exactly as it is, because
 * whether that Dashboard hosts its own panel is not something a URL can answer
 * — only the page's advertisement can, and that arrives on its own channel.
 *
 * Leaving Dashboard tabs alone here is also what keeps the panel from flashing:
 * a tab that is already yielded stays yielded across a reload rather than being
 * released and re-hidden a moment later once the page re-advertises.
 */
export async function reconcileSidePanelForTab(
  tabId: number | undefined,
  url: string | undefined
): Promise<void> {
  const sidePanel = perTabSidePanel();
  if (!sidePanel) return;
  if (typeof tabId !== 'number' || tabId < 0) return;

  try {
    if (await isDashboardTab(url)) return;
    await releaseTab(sidePanel, tabId);
  } catch (error) {
    // A tab can close underneath us, and a browser can refuse an option write.
    // Neither is worth failing anything over: the next navigation reconciles.
    log.debug('Side panel reconcile skipped for tab', { tabId, error });
  }
}

/**
 * Bring every open tab back into line.
 *
 * Two callers, both of which change the answer for tabs nobody is navigating:
 * worker startup, and a change to the configured Dashboard URL — which must
 * release the tabs of an origin that has just stopped being the Dashboard.
 * Neither can yield anything: the new origin's tabs stay as they are until
 * their pages advertise, which is what makes a mis-typed Settings change
 * unable to hide the panel anywhere.
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
