// src/lib/side-panel-yield.ts
import { browser } from 'wxt/browser';
import { isTrustedDashboardOrigin } from './auth/trusted-origin';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

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
 * page is CURRENTLY SHOWING a built-in panel, the extension's panel is not
 * visible. On every other tab — including a Dashboard that does NOT advertise —
 * it behaves exactly as before.
 *
 * "CURRENTLY SHOWING", not "is a build that could" (ADR-018 D0). The claim used
 * to be a property of the deployment, readable from `DASHBOARD_PANEL_ATTR` in
 * the initial HTML. That could never express a per-user preference — not
 * knowable before React — or a route that mounts no panel, since one document
 * serves `/login` and `/cases`. Worse, it was MONOTONIC: a page could assert
 * and never retract, so turning the built-in panel off on an already-yielded
 * tab left the user with NEITHER surface. Three things follow, and all of them
 * are this module's job:
 *
 *  1. Only the live `DASHBOARD_PANEL_MESSAGE` yields.
 *  2. A `DASHBOARD_PANEL_WITHDRAWN_MESSAGE` releases.
 *  3. A tab loading a NEW DOCUMENT releases, because the assertion belonged to
 *     the document that is going away — the fresh one must say so again.
 *
 * (3) reintroduces a brief flash on reload, which the old document_end read
 * existed to avoid. Accepted deliberately, and consistent with the posture
 * below: a flash is the mild failure, a dark tab the severe one.
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

/**
 * Work queued per tab, so two messages about one tab cannot interleave.
 *
 * THE RACE THIS CLOSES, which is the dark tab this whole module exists to
 * prevent. The yield and the release are both read-modify-write sequences on
 * the same per-tab options, and the background dispatches them without
 * awaiting. Their awaits are not the same length: the yield first resolves
 * `isTrustedDashboardOrigin`, which for a SELF-HOSTED origin reads
 * `browser.storage.local`, while the release awaits only `getOptions`. So an
 * advertise immediately followed by a withdrawal — a route redirect, a sign-out
 * just after load, a preference toggled twice — interleaved like this:
 *
 *   1. yield starts, awaits the storage read
 *   2. release starts, reads options, sees `enabled !== false`, returns
 *      WITHOUT writing, because the yield has not landed yet
 *   3. yield resumes and writes `enabled: false`
 *
 * Final state: the tab is yielded and the page is showing no panel. Neither
 * surface, and nothing left to release it — the withdrawal was already spent.
 *
 * Ordering follows ARRIVAL, which is what makes the outcome correct rather than
 * merely deterministic: the withdrawal queued behind the yield sees the yield's
 * write and undoes it.
 *
 * In-memory and per-worker, which is all it needs to be. It orders operations
 * that are in flight together; nothing is remembered across an MV3 eviction,
 * and nothing needs to be — the browser's own per-tab options are the state.
 */
const tabWork = new Map<number, Promise<void>>();

function onTab(tabId: number, work: () => Promise<void>): Promise<void> {
  // The stored promise is always the CAUGHT one, so a failed operation cannot
  // reject the chain and strand every later operation for that tab.
  const previous = tabWork.get(tabId) ?? Promise.resolve();
  const next = previous.then(work);
  const quiet = next.catch(() => {});
  tabWork.set(tabId, quiet);
  void quiet.then(() => {
    // Only if nothing else queued behind us, or we would drop a live chain.
    if (tabWork.get(tabId) === quiet) tabWork.delete(tabId);
  });
  return next;
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
  // SOLE-WRITER INVARIANT, and callers lean on it. `yieldTab` above is the only
  // thing in this extension that writes `enabled: false`, so "the options say
  // false" means "this rule hid it" and nothing else. That is what lets the
  // release paths skip an origin check without being able to un-hide a panel
  // somebody else disabled. Anything that ever disables a panel for another
  // reason — a privacy mode, a per-tab mute — breaks that reading and has to
  // come with a way to tell the two apart.
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

  await onTab(tabId, async () => {
    try {
      if (!(await isTrustedDashboardOrigin(origin))) {
        log.warn('Ignoring a built-in panel advertisement from a non-Dashboard origin', { origin });
        return;
      }
      await yieldTab(sidePanel, tabId);
    } catch (error) {
      log.debug('Could not yield the side panel for an advertising tab', { tabId, error });
    }
  });
}

/**
 * Give one tab its panel back.
 *
 * ONE function for both reasons it happens — the page withdrew, or the document
 * it asserted for is being replaced. They had identical bodies, and finding a
 * bug in one of two identical bodies is how it gets fixed in one of them.
 * `reason` exists only so the log says which.
 *
 * DELIBERATELY NOT ORIGIN-GATED, which is where this differs from the yield
 * path. The asymmetry is this module's whole posture in one place:
 *
 *  - Hiding the panel on a tab that has none of its own is the SEVERE failure,
 *    so the yield refuses anything it cannot attribute to a Dashboard.
 *  - Showing the panel is the MILD failure, so the release must not carry a
 *    check that can strand a tab dark. An origin this worker cannot resolve is
 *    not a reason to keep someone's only surface hidden.
 *
 * Nothing is lost by that, and the reason is `releaseTab`'s sole-writer
 * invariant above: only this rule ever writes `enabled: false`, so a release
 * can only ever undo this rule's own work. The content script additionally
 * refuses to forward from an untrusted origin, and the background rejects
 * senders that are not this extension.
 */
export async function releaseSidePanelForTab(
  tabId: number | undefined,
  reason: 'withdrawn' | 'navigating'
): Promise<void> {
  const sidePanel = perTabSidePanel();
  if (!sidePanel) return;
  if (typeof tabId !== 'number' || tabId < 0) return;

  await onTab(tabId, async () => {
    try {
      await releaseTab(sidePanel, tabId);
    } catch (error) {
      // A tab can close underneath us, and a browser can refuse an option
      // write. Neither is worth failing anything over.
      log.debug('Side panel release skipped', { tabId, reason, error });
    }
  });
}

/**
 * Bring one tab back into line with the invariant.
 *
 * Runs on EVERY tab update and at worker startup, and only ever RELEASES.
 *
 * `documentReplaced` is what a navigation adds. Without it, a tab on a
 * Dashboard origin is left exactly as it is — whether that Dashboard is
 * *showing* a panel is not something a URL can answer, only the page's own
 * message can, and releasing on the stream of title/favicon/SPA-route updates
 * a page emits would undo a live yield seconds after the page asked for it. A
 * worker restart would do the same to every already-correct tab, with no page
 * left to re-assert.
 *
 * With it, a Dashboard tab IS released: the assertion belonged to the document
 * going away, and the same URL may mount no panel this time because the user
 * changed the preference or signed out in between (ADR-018 D0).
 *
 * Folded in here rather than given its own listener so one update means one
 * read-modify-write. Two passes over every tab on every page load in the
 * browser doubled the side-panel API traffic and put two concurrent
 * read-modify-writes on the same key — the very shape the queue above exists to
 * stop.
 */
export async function reconcileSidePanelForTab(
  tabId: number | undefined,
  url: string | undefined,
  { documentReplaced = false }: { documentReplaced?: boolean } = {}
): Promise<void> {
  const sidePanel = perTabSidePanel();
  if (!sidePanel) return;
  if (typeof tabId !== 'number' || tabId < 0) return;

  await onTab(tabId, async () => {
    try {
      if ((await isDashboardTab(url)) && !documentReplaced) return;
      await releaseTab(sidePanel, tabId);
    } catch (error) {
      log.debug('Side panel reconcile skipped for tab', { tabId, error });
    }
  });
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
