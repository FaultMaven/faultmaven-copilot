import { browser } from 'wxt/browser';
import config from "../../../config";
import { getHostEndpoints } from "../../host-endpoints";
import { authManager } from "../../auth/auth-manager";
import { getAuthConfig } from "../../auth/auth-config";
import { tokenManager } from "../../auth/token-manager";
import { authenticatedFetch, authenticatedFetchWithRetry, prepareBody } from "../client";
import { UserProfile } from "../types";
import type { components } from "~/types/api.generated";
import { createHttpErrorFromResponse } from "../../errors/http-error";
import { fetchWithTimeout } from "../../utils/fetch-timeout";
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('AuthService');

// OAuth client identity for this extension (matches TokenManager's refresh grant
// and dashboard-oauth's authorization request).
const OAUTH_CLIENT_ID = 'faultmaven-copilot';

// Best-effort revoke should never stall logout; bound it well under any UI wait.
const REVOKE_TIMEOUT_MS = 10_000;

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
 * Best-effort server-side revocation of the refresh token on logout (RFC 7009).
 *
 * `POST /api/v1/auth/logout` revokes only the *access* token. Without this the
 * refresh token stays valid server-side and remains mintable via /oauth/token
 * until its natural expiry (~7 days), even though clearAllAuthData() destroys the
 * in-browser copy. This closes that gap so "logout means logout" server-side too.
 *
 * The OAuth `/oauth/revoke` endpoint is mounted only in OAuth (cloud) mode, so
 * this is scoped to non-local deployments. Every failure path — endpoint absent,
 * network error, 4xx/5xx, missing token — is swallowed: revocation is a
 * hardening nicety and must never block or fail the logout the user requested.
 */
async function revokeRefreshTokenBestEffort(): Promise<void> {
  try {
    // Local/self-hosted mode does not mount /oauth/revoke. getAuthConfig() has a
    // network → last-known-good → 'local' fallback ladder, so an undeterminable
    // mode conservatively skips the call rather than firing a doomed request.
    const authConfig = await getAuthConfig();
    if (authConfig.provider === 'local') {
      return;
    }

    const refreshToken = await tokenManager.getRefreshToken();
    if (!refreshToken) {
      return;
    }

    const response = await fetchWithTimeout(
      `${await getHostEndpoints().apiUrl()}/api/v1/auth/oauth/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: OAUTH_CLIENT_ID,
        }),
      },
      REVOKE_TIMEOUT_MS
    );

    if (!response.ok) {
      log.warn('Refresh-token revoke returned non-OK; continuing logout', {
        status: response.status,
      });
    }
  } catch (error) {
    log.warn('Refresh-token revoke failed; continuing logout', error);
  }
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
    // Revoke the refresh token server-side while the local copy still exists
    // (the finally block below destroys it). /auth/logout only revokes the
    // access token; this is best-effort and never throws.
    await revokeRefreshTokenBestEffort();

    const response = await authenticatedFetch(`${await getHostEndpoints().apiUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });

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
    // Clear ALL local auth data (authState + tokens) regardless of response
    // status. clearAuthState() alone would leave the token keys behind, so the
    // "logged out" user would keep a live Bearer and silently auto-refresh.
    await authManager.clearAllAuthData();

    // Broadcast auth state change to other tabs
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          type: 'auth_state_changed',
          authState: null
        });
      } catch (error) {
        // Ignore messaging errors - not critical for logout
        log.warn('Failed to broadcast logout', error);
      }
    }
  }

  return { allSessionsEnded };
}
