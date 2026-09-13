/**
 * Best-effort server-side revocation of the refresh token on logout (RFC 7009).
 *
 * `POST /api/v1/auth/logout` revokes only the *access* token. Without this the
 * refresh token stays valid server-side and remains mintable via /oauth/token
 * until its natural expiry (~7 days), even though clearAllAuthData() destroys
 * the in-browser copy. This closes that gap so "logout means logout" server-side
 * too.
 *
 * Its own module because it has TWO callers by design: `logoutAuth`, which hands
 * it to the background worker, and the worker's message handler, which runs it.
 * See `requestRefreshTokenRevoke` for why the hand-off exists.
 */
import { browser } from 'wxt/browser';
import { getAuthConfig } from './auth-config';
import { getHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { fetchWithTimeout } from '@faultmaven/copilot-ui/lib/utils/fetch-timeout';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('RevokeRefreshToken');

// OAuth client identity for this extension (matches TokenManager's refresh grant
// and dashboard-oauth's authorization request).
const OAUTH_CLIENT_ID = 'faultmaven-copilot';

// Best-effort revoke should never stall logout; bound it well under any UI wait.
const REVOKE_TIMEOUT_MS = 10_000;

/** The runtime message that carries the hand-off. */
export const REVOKE_REFRESH_TOKEN_ACTION = 'revokeRefreshToken';

/**
 * The OAuth `/oauth/revoke` endpoint is mounted only in OAuth (cloud) mode, so
 * this is scoped to non-local deployments. Every failure path — endpoint absent,
 * network error, 4xx/5xx, missing token — is swallowed: revocation is a
 * hardening nicety and must never block or fail the logout the user requested.
 */
export async function revokeRefreshTokenBestEffort(refreshToken: string | null): Promise<void> {
  try {
    // Local/self-hosted mode does not mount /oauth/revoke. getAuthConfig() has a
    // network → last-known-good → 'local' fallback ladder, so an undeterminable
    // mode conservatively skips the call rather than firing a doomed request.
    const authConfig = await getAuthConfig();
    if (authConfig.provider === 'local') {
      return;
    }

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
 * Ask the BACKGROUND WORKER to make the call, rather than making it here.
 *
 * `logoutAuth` runs in the side panel, and the revoke is deliberately not
 * awaited — awaiting it stalled the panel that asked for the sign-out for as
 * long as the network took (~20s worst case). But an un-awaited fetch belongs to
 * the document that started it: the panel a user closes right after signing out
 * takes the revoke down with it, and the refresh token then lives out its
 * natural ~7 days server-side. Both properties are wanted, and the worker is the
 * context that has them — it outlives the panel, and nothing there is waiting.
 *
 * `runtime.sendMessage` reaches extension pages and the worker, never content
 * scripts, so the token does not enter any page's world. The worker gates on
 * `sender.id` before dispatching.
 *
 * Falls back to running it in-context when the message cannot be delivered —
 * no worker, a test environment, or `logoutAuth` called FROM the worker, where
 * Chrome does not deliver a runtime message to the sender's own listener. That
 * fallback is what keeps this strictly better than the direct call rather than a
 * new way to lose the revoke.
 *
 * Never rejects: it is the same best-effort contract as the call it delegates.
 */
export async function requestRefreshTokenRevoke(refreshToken: string | null): Promise<void> {
  if (!refreshToken) return;

  try {
    await browser.runtime.sendMessage({
      action: REVOKE_REFRESH_TOKEN_ACTION,
      refreshToken,
    });
    return;
  } catch (error) {
    log.debug('Could not hand the revoke to the worker; making the call here', error);
  }

  await revokeRefreshTokenBestEffort(refreshToken);
}
