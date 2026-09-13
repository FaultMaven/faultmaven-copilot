/**
 * The credential chain is definitively dead — not merely unavailable right now.
 *
 * `getValidAccessToken()` used to answer `null` for both, and that collapse is
 * the root of this whole area: a caller that cannot tell "the backend revoked
 * us" from "a renewal blip, retry shortly" cannot act, so the teardown had to
 * happen inside TokenManager — inside the refresh lock, inside the refresh
 * verdict, and during logout's own authenticated call.
 *
 * With the two distinguishable, TokenManager reports and the host acts:
 * `null` stays the transient answer (#99 — the request goes out header-less and
 * recovers), and this says the session is over.
 *
 * Extends the SHARED `AuthenticationError` on purpose. That is the package's
 * existing vocabulary for "this session is over, sign in again" — category
 * `authentication`, recovery `show_modal` — and it is what lets `getAuthHeaders`
 * tell a dead chain from a renewal blip without knowing anything about the
 * extension. A host that throws a plain error keeps the old behaviour, so the
 * distinction is opt-in and the Dashboard host is unaffected.
 */
import { AuthenticationError } from '@faultmaven/copilot-ui/lib/errors/types';

export class SessionEndedError extends AuthenticationError {
  constructor(reason: string) {
    super(`Session ended: ${reason}`);
  }
}
