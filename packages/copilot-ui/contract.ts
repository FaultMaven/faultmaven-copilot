/**
 * The Dashboard-panel advertisement, defined ONCE — and reachable without the
 * panel.
 *
 * `@faultmaven/copilot-ui/contract` is a subpath entry with NO imports, and it
 * must stay that way. The three names below are needed by code that has no
 * business loading the UI: the Dashboard's login page, which decides what to
 * advertise before anyone is signed in, and the extension's content script,
 * which reads the attribute on every page it is injected into. Reached through
 * the package's main entry they arrive with the store, the transport and the
 * persistence layer attached — 776 -> 983 kB on the Dashboard's login bundle,
 * which ADR-016 D3 forbids, and a 4 MB content script here.
 *
 * A test asserts the transitive import graph of this module is exactly itself,
 * so the next edit cannot quietly re-attach it.
 *
 * A page that renders the Copilot panel itself says so, and the extension's
 * side panel stands down on that tab rather than sitting beside a second copy
 * of itself. Three names carry it, and all three are a cross-repo contract:
 * the page writes them, the extension reads them, and a copy in either
 * repository is a copy that can drift while both sides stay green.
 *
 * It lives in the package because the package is the one thing both hosts
 * already share.
 *
 * SEMANTICS, exactly:
 * - The signal is a CLAIM BY THE PAGE, per document load: "this build renders
 *   the copilot panel itself". Not a claim about the account, the route, or
 *   whether the panel is currently on screen.
 * - Advertising is OPT-IN and silence is the safe answer. A Dashboard that says
 *   nothing — an older self-hosted image, or Cloud before its own panel ships —
 *   keeps the extension's side panel exactly as it is. Nothing here may ever be
 *   inferred from the origin alone; that is the whole point of the signal, and
 *   why a version check or a build-date guess is not a substitute.
 * - The ATTRIBUTE is the per-load state and SHOULD be in the initial HTML.
 *   Setting it late is allowed but leaves a window in which the extension panel
 *   is still shown; a page that only learns late should post the message.
 * - Values `"false"`, `"0"` and the empty string do NOT advertise, so a
 *   Dashboard can render the attribute unconditionally and flip its value. Any
 *   other value (`"1"`, a version string) advertises.
 * - The message carries no payload. It is a nudge to re-read the state, and it
 *   is only honoured on a configured Dashboard origin — the content script
 *   validates `event.origin` and the background worker independently re-checks
 *   the browser-supplied sender origin.
 * - The signal is per TAB and does not outlive it. Navigating that tab off a
 *   Dashboard origin restores the extension's panel.
 */

/** Set on `<html>` by a page that renders the panel itself. */
export const DASHBOARD_PANEL_ATTR = 'data-faultmaven-dashboard-panel';

/** Posted by the page to its own window when the panel arrives after load. */
export const DASHBOARD_PANEL_MESSAGE = 'FM_DASHBOARD_PANEL_AVAILABLE';

/**
 * Does the current document advertise a built-in panel?
 *
 * ONE predicate, shared, because "what counts as advertising" is the subtle
 * half of the contract — the empty string and `"false"` do not — and two
 * implementations of that rule are two chances to disagree about whether a
 * user sees one panel or two.
 *
 * Read from the DOM at call time rather than cached: a page that mounts its
 * panel after hydration flips the attribute later, and the second read is the
 * one that catches it.
 *
 * Fails closed to `false`: "we could not tell" must mean "keep the extension's
 * panel", never "hide it".
 */
export function dashboardAdvertisesPanel(doc: Document = document): boolean {
  try {
    const value = doc.documentElement.getAttribute(DASHBOARD_PANEL_ATTR);
    if (value === null) return false;
    return value !== '' && value !== 'false' && value !== '0';
  } catch {
    // No DOM / non-page context — nothing is advertising.
    return false;
  }
}
