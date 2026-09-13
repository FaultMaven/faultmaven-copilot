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
 *
 * From `/contract`, not from the package's main entry: this module is imported
 * by the auth-bridge CONTENT SCRIPT, and the main entry brings the panel — the
 * store, the transport, the markdown renderer — with it.
 *
 * `DASHBOARD_PANEL_ATTR` and `dashboardAdvertisesPanel` are re-exported but the
 * extension no longer ACTS on them (ADR-018 D0): the attribute is a build
 * capability claim, and only the live message pair yields and releases. They
 * stay part of this door because the contract still carries them and the
 * Dashboard still renders the attribute — dropping them here would hide half
 * the handshake from the one module that is supposed to describe all of it.
 */
export {
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
  DASHBOARD_PANEL_WITHDRAWN_MESSAGE,
  dashboardAdvertisesPanel,
} from '@faultmaven/copilot-ui/contract';

import {
  CAPABILITY_PANEL_WITHDRAW,
  COPILOT_CAPABILITIES_ATTR,
} from '@faultmaven/copilot-ui/contract';

export { CAPABILITY_PANEL_WITHDRAW, COPILOT_CAPABILITIES_ATTR };

/**
 * Everything THIS BUILD implements, in the order the contract declares them.
 *
 * A BUILD CONSTANT, not a runtime probe. Each entry is a promise about code
 * that is compiled into this artefact, so it is knowable at build time and must
 * be kept true by hand — `presence-marker.test.ts` asserts each token against
 * the handler that makes it true, because a token advertising something absent
 * is worse than saying nothing (the consumer trusts it).
 *
 * Add to this list in the same commit that adds the behaviour, never earlier.
 */
export const COPILOT_CAPABILITIES: readonly string[] = [CAPABILITY_PANEL_WITHDRAW];

export function announceCopilotPresence(version: string): void {
  try {
    // CAPABILITIES FIRST, version second. A consumer that checks capabilities
    // before presence — which ADR-019 D3 requires, so that a build mid-write is
    // never mistaken for "no extension at all" — sees a complete answer at
    // every instant if the list lands first. Written the other way round there
    // is a window in which the version is readable and the list is not, which
    // is precisely the state that reads as "an old build".
    document.documentElement.setAttribute(
      COPILOT_CAPABILITIES_ATTR,
      COPILOT_CAPABILITIES.join(' '),
    );
    document.documentElement.setAttribute(COPILOT_PRESENCE_ATTR, version);
    window.dispatchEvent(new CustomEvent(COPILOT_PRESENCE_EVENT));
  } catch {
    // No DOM / non-page context — nothing to announce.
  }
}
