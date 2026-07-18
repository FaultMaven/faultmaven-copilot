import { browser } from 'wxt/browser';
import config, { getApiUrl } from "../../../config";
import { authManager } from "../../auth/auth-manager";
import { getAuthConfig } from "../../auth/auth-config";
import { tokenManager } from "../../auth/token-manager";
import { authenticatedFetch, prepareBody } from "../client";
import { APIError, AuthState, AuthTokenResponse, UserProfile } from "../types";
import { createHttpErrorFromResponse } from "../../errors/http-error";
import { fetchWithTimeout } from "../../utils/fetch-timeout";
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('AuthService');

// OAuth client identity for this extension (matches TokenManager's refresh grant
// and dashboard-oauth's authorization request).
const OAUTH_CLIENT_ID = 'faultmaven-copilot';

// Best-effort revoke should never stall logout; bound it well under any UI wait.
const REVOKE_TIMEOUT_MS = 10_000;

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
      `${await getApiUrl()}/api/v1/auth/oauth/revoke`,
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

export async function devLogin(
  username: string,
  email?: string,
  displayName?: string
): Promise<AuthTokenResponse> {
  try {
    const response = await fetchWithTimeout(`${await getApiUrl()}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: prepareBody({
        username,
        email,
        display_name: displayName
      }),
      credentials: 'include'
    });

    if (!response.ok) {
      throw await createHttpErrorFromResponse(response);
    }

    const authResponse = await response.json();

    // Store auth state using AuthManager
    const authState: AuthState = {
      access_token: authResponse.access_token,
      token_type: authResponse.token_type,
      expires_at: Date.now() + (authResponse.expires_in * 1000),
      user: authResponse.user
    };

    await authManager.saveAuthState(authState);

    return authResponse;
  } catch (error) {
    // Wrap network errors with better messaging
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError: any = new Error('Unable to connect to server');
      networkError.name = 'NetworkError';
      networkError.originalError = error;
      throw networkError;
    }
    throw error;
  }
}

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function logoutAuth(): Promise<void> {
  try {
    // Revoke the refresh token server-side while the local copy still exists
    // (the finally block below destroys it). /auth/logout only revokes the
    // access token; this is best-effort and never throws.
    await revokeRefreshTokenBestEffort();

    const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });

    if (!response.ok) {
      throw await createHttpErrorFromResponse(response);
    }
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
}
