import { browser } from 'wxt/browser';
import config from "@faultmaven/copilot-ui/config";
import { getHostEndpoints } from "@faultmaven/copilot-ui/lib/host-endpoints";
import { authManager } from "./auth-manager";
import { tokenManager } from "./token-manager";
import { authenticatedFetchWithRetry, prepareBody } from "@faultmaven/copilot-ui/lib/api/client";
import { assembleAuthHeaders } from "@faultmaven/copilot-ui/lib/api/fetch-utils";
import { requestRefreshTokenRevoke } from "./revoke-refresh-token";
import { UserProfile } from "@faultmaven/copilot-ui/lib/api/types";
import type { components } from "@faultmaven/copilot-ui/types/api.generated";
import { createHttpErrorFromResponse } from "@faultmaven/copilot-ui/lib/errors/http-error";
import { fetchWithTimeout } from "@faultmaven/copilot-ui/lib/utils/fetch-timeout";
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { EventBus } from '../messaging';

const log = createLogger('AuthService');

// The logout POST itself, bounded so a hanging server cannot stall a sign-out.
const LOGOUT_TIMEOUT_MS = 10_000;

/** What a sign-out actually achieved, as far as this client can verify. */
export interface LogoutOutcome {
  /** True only when the server confirmed every session for the account ended.
   *  False covers "the server said it did not take" and "we never got an
   *  answer" alike, because they mean the same thing to the user: another
   *  client — typically the Dashboard, on its own token chain — may still be
   *  signed in as them. */
  allSessionsEnded: boolean;
}

/**
 * Read the signed-in account's profile from `/auth/me`.
 *
 * Uses `authenticatedFetchWithRetry`, not the bare `authenticatedFetch`. A 401
 * SESSION_EXPIRED inside the bare helper *removes* `sessionId` from storage and
 * throws — so a caller that swallows the rejection (this is read for display,
 * see AccountRow) would leave the panel with no persisted session id and no
 * refresh, and the next real request would have to 401 its way to a new one.
 * The retry wrapper runs the single-flighted `refreshSession()` and persists the
 * replacement, which is the only thing that makes a swallowed failure harmless.
 */
export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetchWithRetry(`${await getHostEndpoints().apiUrl()}/api/v1/auth/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function logoutAuth(): Promise<LogoutOutcome> {
  // Pessimistic until the server says otherwise. Every path that fails to
  // produce a confirmation — offline, a non-2xx, a body that will not parse, a
  // backend predating the field — leaves this false, which is what the user is
  // told. Never inferred from the request merely having been sent.
  let allSessionsEnded = false;

  try {
    // Deliberately NOT `authenticatedFetch`, and deliberately NOT the raw token
    // either — the credential stack is asked directly, and its verdict is
    // swallowed here.
    //
    // Through `getAuthHeaders` the host ACTS on a dead-chain verdict, tearing
    // the session down mid-logout, inside this try, before the broadcast below;
    // everything that used to guard against that (capturing the refresh token up
    // front, re-reading it afterwards, preferring one copy over the other)
    // existed only because the call path was wrong.
    //
    // But reading the STORED token alone was the other extreme: after a laptop
    // sleep the access token is expired, the POST 401s, and the user is told we
    // could not confirm their other sessions ended — on a sign-out that could
    // have refreshed first and actually written the account-wide revocation.
    // Asking `getValidAccessToken` refreshes a healthy near-expiry session, and
    // catching its verdict here means a dead one still cannot tear anything
    // down. Falling back to whatever is stored keeps the request authenticated
    // where it can be; an expired bearer is no worse than none.
    const bearer = await tokenManager
      .getValidAccessToken()
      .catch(() => null)
      .then((token) => token ?? tokenManager.peekAccessToken().catch(() => null));
    // try/catch, not `.catch()`. A storage accessor can throw SYNCHRONOUSLY (an
    // invalidated MV3 context, a test double), and `.catch()` guards the promise
    // rather than the call — the throw would escape past the POST below, so the
    // account-wide revocation would never be written even though the bearer was
    // already in hand. Read directly, as everything else in `auth/` does.
    let stored: Record<string, unknown> = {};
    try {
      stored = await browser.storage.local.get(['sessionId']);
    } catch {
      /* No session id to send; the logout POST is still worth making. */
    }
    const sessionId = typeof stored?.sessionId === 'string' ? stored.sessionId : undefined;

    const response = await fetchWithTimeout(
      `${await getHostEndpoints().apiUrl()}/api/v1/auth/logout`,
      {
        method: 'POST',
        credentials: 'include',
        // The same assembler every other request goes through. Only the
        // SOURCING differs here — see the note on the bearer above — and
        // spelling the header names again by hand is how this path would drift
        // from the one it is deliberately bypassing.
        headers: assembleAuthHeaders({ bearer, sessionId }),
      },
      LOGOUT_TIMEOUT_MS
    );

    if (!response.ok) {
      throw await createHttpErrorFromResponse(response);
    }

    // `=== true` is load-bearing at runtime even though the field is typed
    // non-optional: a body that will not parse, or one from a backend older
    // than the field, reads as unconfirmed — which is exactly what it is.
    const body = (await response
      .json()
      .catch(() => null)) as components['schemas']['LogoutResponse'] | null;
    allSessionsEnded = body?.all_sessions_ended === true;
  } finally {
    // READ the token, TEAR DOWN, BROADCAST, then revoke — in that order.
    //
    // Nothing above this can destroy the credential any more (the POST no longer
    // goes through the credential machinery), so one read is enough.
    const refreshToken = await tokenManager.getRefreshToken().catch(() => null);

    // Never rejects, so the broadcast below always runs.
    await authManager.clearAllAuthData();

    // Tell the other contexts BEFORE the best-effort revoke. That revoke
    // resolves an auth config and then waits on the network — up to ~20s on a
    // flaky connection — and nothing about it is needed for the sign-out to be
    // observable. Behind it, the panel's own sign-out handler and every other
    // context stall for that whole window.
    //
    // Through the typed door: the payload shape is the contract the panel reads,
    // and spelling it by hand is how a raw token payload once went out as an
    // auth state whose `isAuthenticated` was undefined. EventBus.emit already
    // swallows "no listener".
    await EventBus.emit({ type: 'auth_state_changed', authState: null });

    // Last, and NOT awaited. It resolves an auth config and then waits on the
    // network — ~20s worst case — and `logoutAuth` is awaited by
    // `ExtensionApp.signOut`, whose own `finally` clears the identity and drops
    // the spinner. Awaiting it here stalled the panel that asked for the
    // sign-out, which is the very thing moving it after the broadcast was meant
    // to prevent.
    //
    // Which is why it is HANDED OFF rather than started here: an un-awaited
    // fetch belongs to the document that made it, and this one runs in the side
    // panel — a user who signs out and closes the panel would take the revoke
    // with them. The worker outlives the panel and has nobody waiting on it.
    // Never rejects.
    void requestRefreshTokenRevoke(refreshToken);
  }

  return { allSessionsEnded };
}
