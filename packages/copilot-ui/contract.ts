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
 * SEMANTICS, exactly (revised by ADR-018 D0 — see the note below):
 * - The signal is a CLAIM BY THE PAGE: "a built-in panel is showing on this
 *   tab right now, for this user, on this route." It WAS a per-document-load
 *   claim about the build; D0 made it live, because a build-level claim cannot
 *   express a per-user preference or a route that mounts no panel.
 * - Advertising is OPT-IN and silence is the safe answer. A Dashboard that says
 *   nothing — an older self-hosted image, or Cloud before its own panel ships —
 *   keeps the extension's side panel exactly as it is. Nothing here may ever be
 *   inferred from the origin alone; that is the whole point of the signal, and
 *   why a version check or a build-date guess is not a substitute.
 * - The ATTRIBUTE is a BUILD CAPABILITY claim — "this deployment could host a
 *   panel" — and must stay answerable at document_start, which is what
 *   distinguishes a build that has the feature from one that predates it. Since
 *   ADR-018 D0 it does NOT, by itself, cause a yield: it cannot express a
 *   per-user preference (not knowable before React) or a route with no panel
 *   (one document serves `/login` and `/cases`).
 * - Values `"false"`, `"0"` and the empty string do NOT advertise, so a
 *   Dashboard can render the attribute unconditionally and flip its value. Any
 *   other value (`"1"`, a version string) advertises.
 * - YIELDING REQUIRES THE LIVE MESSAGE. The page posts
 *   `DASHBOARD_PANEL_MESSAGE` when a panel is actually mounted and showing, and
 *   `DASHBOARD_PANEL_WITHDRAWN_MESSAGE` when it stops. This costs a brief
 *   window on load where the extension's panel is visible before a yield — the
 *   flash the document_end attribute read existed to avoid. Accepted
 *   deliberately: every ambiguous branch fails towards SHOWING the panel, and a
 *   flash is the mild failure while a dark tab with neither surface is the
 *   severe one.
 * - A WITHDRAWAL IS NOT OPTIONAL for a page that has asserted. Without it the
 *   advertisement is monotonic — a page could say "I host a panel" and never
 *   "not any more" — which is what made a Dashboard-side preference impossible:
 *   turning the built-in panel off on an already-yielded tab left the user with
 *   NEITHER surface and no way back but navigating off the origin.
 * - The message carries no payload. It is a nudge to re-read the state, and it
 *   is only honoured on a configured Dashboard origin — the content script
 *   validates `event.origin` and the background worker independently re-checks
 *   the browser-supplied sender origin.
 * - The signal is per TAB and does not outlive it. Navigating that tab off a
 *   Dashboard origin restores the extension's panel.
 */

/** Set on `<html>` by a page that renders the panel itself. */
export const DASHBOARD_PANEL_ATTR = 'data-faultmaven-dashboard-panel';

/**
 * Posted by the page to its own window while a built-in panel is showing.
 *
 * THE thing that yields the extension's side panel since ADR-018 D0. The
 * attribute above no longer does.
 */
export const DASHBOARD_PANEL_MESSAGE = 'FM_DASHBOARD_PANEL_AVAILABLE';

/**
 * Its counterpart: the page has stopped showing a built-in panel.
 *
 * Posted when the preference turns the panel off, when a route that mounts no
 * panel takes over, or on sign-out — anything that makes the assertion above
 * untrue without the document going away. The extension releases the tab.
 *
 * SEQUENCING, because this crosses a release boundary in two repositories: an
 * extension that predates this constant ignores the message and leaves the tab
 * YIELDED, which is the dark-tab failure. A Dashboard must therefore not
 * withdraw until extensions in the field understand it — ADR-018 sequences the
 * extension side (row 4) strictly before the Dashboard side (row 5) for exactly
 * this reason.
 */
export const DASHBOARD_PANEL_WITHDRAWN_MESSAGE = 'FM_DASHBOARD_PANEL_WITHDRAWN';

/**
 * Does this document's BUILD claim it can host a panel?
 *
 * ONE predicate, shared, because "what counts as advertising" is the subtle
 * half of the contract — the empty string and `"false"` do not — and two
 * implementations of that rule are two chances to disagree.
 *
 * NOT a yield trigger since ADR-018 D0. It answers "could this deployment host
 * a panel", which is knowable at document_start; whether one is showing *right
 * now, for this user, on this route* is knowable only to a React tree, and
 * travels as `DASHBOARD_PANEL_MESSAGE`. The extension no longer suppresses its
 * panel on the strength of this alone.
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
