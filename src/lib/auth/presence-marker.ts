/**
 * The copilot <-> Dashboard page handshake. Two directions, both of them a
 * cross-repo contract with faultmaven-dashboard; the names below are the
 * interface and must stay stable on both sides.
 *
 * Announce the copilot extension's presence to the dashboard page it is injected
 * on, so the dashboard can show an "open from your toolbar" hint instead of an
 * install CTA (a web page can't open the side panel itself).
 *
 * Contract with the dashboard — keep these names stable:
 * - sets `data-faultmaven-copilot="<version>"` on <html>
 * - dispatches a `faultmaven-copilot:ready` window event
 *
 * (The event only signals readiness; the version is read from the attribute,
 * since CustomEvent.detail can be dropped crossing the content-script → page
 * world boundary.)
 */
export const COPILOT_PRESENCE_ATTR = 'data-faultmaven-copilot';
export const COPILOT_PRESENCE_EVENT = 'faultmaven-copilot:ready';

/**
 * The other direction: the Dashboard page announcing that IT hosts a built-in
 * copilot panel, so the extension's side panel can stand down on that tab
 * rather than sitting beside a second copy of itself.
 *
 * Contract with the dashboard — keep these names stable:
 * - the page sets `data-faultmaven-dashboard-panel="1"` on <html>
 * - the page may post `{ type: 'FM_DASHBOARD_PANEL_AVAILABLE' }` to its own
 *   window when the panel becomes available only after the document loaded
 *
 * SEMANTICS, exactly:
 * - The signal is a CLAIM BY THE PAGE, per document load. It says "this build
 *   renders the copilot panel itself". It is not a claim about the account, the
 *   route, or whether the panel is currently on screen.
 * - Advertising is OPT-IN and silence is the safe answer. A Dashboard that says
 *   nothing — an older self-hosted image, or Cloud before its own panel ships —
 *   keeps the extension's side panel exactly as it is today. Nothing here may
 *   ever be inferred from the origin alone; that is the whole point of the
 *   signal, and the reason a version check or a build-date guess is not an
 *   acceptable substitute.
 * - The ATTRIBUTE is the per-load state and SHOULD be present in the initial
 *   HTML. Setting it late is allowed but leaves a window in which the extension
 *   panel is still shown; a page that only learns late should post the message.
 * - Attribute values `"false"`, `"0"` and the empty string do NOT advertise, so
 *   a Dashboard can render the attribute unconditionally and flip its value.
 *   Any other value (`"1"`, a version string) advertises.
 * - The message carries no payload. It is a nudge to re-read the state, and it
 *   is only honoured on a configured Dashboard origin — the content script
 *   validates `event.origin` and the background worker independently re-checks
 *   the browser-supplied sender origin.
 * - The signal is per TAB and does not outlive it. Navigating that tab off a
 *   Dashboard origin restores the extension's panel.
 *
 * Implemented on the page side by faultmaven-dashboard#120. Until that ships,
 * nothing advertises and this whole path is inert.
 */
export const DASHBOARD_PANEL_ATTR = 'data-faultmaven-dashboard-panel';
export const DASHBOARD_PANEL_MESSAGE = 'FM_DASHBOARD_PANEL_AVAILABLE';

/**
 * Does the page we are injected on currently advertise a built-in panel?
 *
 * Read from the DOM at call time rather than cached: the content script checks
 * it once at document_end and again whenever the page nudges us with
 * DASHBOARD_PANEL_MESSAGE, and the second read is the one that catches a
 * dashboard which only mounts its panel after hydration.
 *
 * Fails closed to `false` — "we could not tell" must mean "keep the extension's
 * panel", never "hide it".
 */
export function dashboardAdvertisesPanel(): boolean {
  try {
    const value = document.documentElement.getAttribute(DASHBOARD_PANEL_ATTR);
    if (value === null) return false;
    return value !== '' && value !== 'false' && value !== '0';
  } catch {
    // No DOM / non-page context — nothing is advertising.
    return false;
  }
}

export function announceCopilotPresence(version: string): void {
  try {
    document.documentElement.setAttribute(COPILOT_PRESENCE_ATTR, version);
    window.dispatchEvent(new CustomEvent(COPILOT_PRESENCE_EVENT));
  } catch {
    // No DOM / non-page context — nothing to announce.
  }
}
