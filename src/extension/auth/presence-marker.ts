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
 * The other direction — the Dashboard page announcing that IT hosts a built-in
 * copilot panel — is DEFINED IN THE PACKAGE, because both repositories need
 * the same three names and the same rule about what counts as advertising.
 * Re-exported here so this module stays the extension's one door to the
 * handshake, in both directions.
 */
export {
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
  dashboardAdvertisesPanel,
} from '@faultmaven/copilot-ui';

export function announceCopilotPresence(version: string): void {
  try {
    document.documentElement.setAttribute(COPILOT_PRESENCE_ATTR, version);
    window.dispatchEvent(new CustomEvent(COPILOT_PRESENCE_EVENT));
  } catch {
    // No DOM / non-page context — nothing to announce.
  }
}
