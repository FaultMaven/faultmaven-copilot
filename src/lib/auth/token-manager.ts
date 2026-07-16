/**
 * TokenManager
 *
 * Handles OAuth token lifecycle including automatic refresh before expiry.
 * Ensures only one refresh happens at a time using a refresh promise.
 *
 * Manifest V3 Service Worker Safe:
 * - Fetches tokens from chrome.storage.local on every call
 * - No in-memory state that would be lost on worker restart
 */

import { browser } from 'wxt/browser';
import { getApiUrl } from '../../config';
import { createLogger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch-timeout';
import { retryWithBackoff, isRetryableError } from '../utils/retry';
import { getAuthConfig } from './auth-config';

const log = createLogger('TokenManager');

interface StoredTokens {
  access_token: string;
  token_type: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  session_id: string;
  user: any;
}

export class TokenManager {
  private refreshPromise: Promise<void> | null = null;

  // Refresh resilience (see performRefreshOnce / getValidAccessToken). A
  // transient failure is retried a few times before giving up, and giving up
  // does NOT clear tokens. Retry/backoff is delegated to the shared
  // `retryWithBackoff` util; only the per-attempt HTTP timeout lives here.
  private static readonly REFRESH_MAX_ATTEMPTS = 3;
  private static readonly REFRESH_BACKOFF_MS = 1000; // initial; exponential ×2
  private static readonly REFRESH_TIMEOUT_MS = 15_000;

  /**
   * Get a valid access token, auto-refreshing if needed.
   * This is the main entry point for getting tokens.
   *
   * @returns Valid access token or null if not authenticated
   */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.getStoredTokens();

    if (!tokens) {
      log.debug('No tokens stored');
      return null;
    }

    // Check if access token is expired or expiring soon (< 5 minutes)
    const now = Date.now();
    const timeUntilExpiry = tokens.expires_at - now;
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (timeUntilExpiry > FIVE_MINUTES) {
      // Token is still valid
      return tokens.access_token;
    }

    log.info('Access token expired or expiring soon, refreshing...');

    // Check if refresh token is expired
    if (tokens.refresh_expires_at <= now) {
      log.warn('Refresh token expired, user must re-authenticate');
      await this.clearTokens();
      return null;
    }

    // Refresh the token. Each attempt re-acquires the cross-context lock and does
    // ONE network call (performRefreshOnce); the backoff sleep between attempts
    // happens HERE, outside the lock, so a transient backend outage can't pin the
    // 'faultmaven-token-refresh' mutex and stall every other context for the whole
    // retry ladder. Only retryable (transient) failures are retried — a definitive
    // rejection (4xx except 408/429) stops immediately after clearing tokens.
    try {
      await retryWithBackoff(() => this.refreshAccessToken(), {
        maxAttempts: TokenManager.REFRESH_MAX_ATTEMPTS,
        initialDelay: TokenManager.REFRESH_BACKOFF_MS,
        shouldRetry: (err) => isRetryableError(err),
      });

      // Get the new token
      const newTokens = await this.getStoredTokens();
      return newTokens?.access_token || null;
    } catch (error: any) {
      if (isRetryableError(error)) {
        // Refresh failed TRANSIENTLY (network / timeout / 5xx) and tokens were
        // deliberately PRESERVED. If the current access token still has any life
        // left, use it — the request can still succeed and the next call retries
        // the refresh once the backend recovers. This is the fix for spurious
        // mid-session logouts: a single blip on the periodic refresh of an active
        // session no longer clears tokens and bounces the user to the login screen.
        if (timeUntilExpiry > 0) {
          log.warn('Token refresh temporarily failed; using still-valid access token');
          return tokens.access_token;
        }
        // Access token already hard-expired AND refresh is transiently down:
        // preserve tokens (do not log out) and let a later call retry.
        log.warn('Token refresh temporarily failed and access token expired; preserving tokens for retry');
        return null;
      }
      // DEFINITIVE failure: performRefreshOnce already cleared tokens; re-auth needed.
      log.error('Failed to refresh token', error);
      return null;
    }
  }

  /**
   * Refresh the access token using the refresh token.
   * Uses Web Locks API for cross-context coordination (background + sidepanel).
   * Falls back to in-context deduplication when Web Locks is unavailable.
   */
  private async refreshAccessToken(): Promise<void> {
    // Web Locks API: true cross-context mutex (MV3 service worker + sidepanel)
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(
        'faultmaven-token-refresh',
        { mode: 'exclusive' },
        async () => {
          // Re-check: another context may have refreshed while we waited for the lock
          const tokens = await this.getStoredTokens();
          if (tokens && (tokens.expires_at - Date.now()) > 5 * 60 * 1000) {
            log.debug('Token already refreshed by another context');
            return;
          }
          await this.performRefreshOnce();
        }
      );
    }

    // Fallback: in-context deduplication (single JS context only)
    if (this.refreshPromise) {
      log.debug('Refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefreshOnce();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform ONE token-refresh attempt. Retries/backoff are the caller's job
   * (getValidAccessToken wraps this in retryWithBackoff), so this method holds
   * the cross-context lock for a single network call at most.
   *
   * Failure taxonomy — the fix for spurious mid-session logouts:
   *   DEFINITIVE (4xx except 408/429 — e.g. 401 InvalidGrantError, 400 malformed,
   *     403 disabled account): the refresh token is genuinely invalid/revoked;
   *     retrying can't help, so clear tokens → re-auth. The ONLY case that logs
   *     out. Thrown with `.status` so isRetryableError() classifies it non-retryable.
   *   TRANSIENT (network error, client timeout, 5xx/429, or a 2xx that isn't a
   *     well-formed token payload): the refresh token is almost certainly still
   *     valid. Thrown as-is / with a retryable `.status` and, crucially, WITHOUT
   *     clearing tokens — the caller retries and, if still failing, keeps the
   *     current tokens rather than bouncing the user to the login screen.
   */
  private async performRefreshOnce(): Promise<void> {
    const tokens = await this.getStoredTokens();

    if (!tokens || !tokens.refresh_token) {
      // Nothing to refresh with — definitive; ensure a clean unauthenticated state.
      await this.clearTokens();
      const err: any = new Error('No refresh token available');
      err.status = 401;
      throw err;
    }

    const apiUrl = await getApiUrl();

    // Mode-aware refresh endpoint. Bridge/standalone sessions run in LOCAL mode,
    // where the OAuth token endpoint (/oauth/token) is NOT mounted — refreshing
    // there 404s and forces a re-login. Local mode exposes POST /auth/refresh
    // ({refresh_token} -> {access_token, token_type, expires_in, refresh_token};
    // no refresh_expires_in). OAuth/cloud mode uses the RFC 6749 refresh grant.
    const isLocal = await this.isLocalAuthMode();
    log.info('Refreshing access token...', { mode: isLocal ? 'local' : 'oauth' });

    const { url, body } = isLocal
      ? {
          url: `${apiUrl}/api/v1/auth/refresh`,
          body: { refresh_token: tokens.refresh_token },
        }
      : {
          url: `${apiUrl}/api/v1/auth/oauth/token`,
          body: {
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: 'faultmaven-copilot',
          },
        };

    // Network/timeout errors from fetchWithTimeout propagate as-is; isRetryableError
    // treats TimeoutError/NetworkError (and unknown errors) as retryable.
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      TokenManager.REFRESH_TIMEOUT_MS
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({} as any));
      const err: any = new Error(
        `Token refresh failed: ${body.detail || body.error_description || body.error || response.status}`
      );
      err.status = response.status;
      // Definitive (4xx except 408/429) → clear tokens so the user re-authenticates.
      // Transient (5xx/429/408) → keep tokens; the caller will retry.
      if (!isRetryableError(err)) {
        log.warn(`Token refresh rejected (${response.status}); clearing tokens`);
        await this.clearTokens();
      }
      throw err;
    }

    // Validate the payload BEFORE overwriting good tokens. A 2xx that isn't a
    // well-formed token response (e.g. an ingress interstitial / cached proxy
    // body) must not clobber storage with `access_token: undefined` /
    // `expires_at: NaN`. Treat it as retryable so we retry instead of corrupting.
    // Note: `refresh_expires_in` is OAuth-only — local /auth/refresh omits it, so
    // it is NOT part of the well-formed-payload check.
    const newTokens = await response.json().catch(() => null);
    if (
      !newTokens ||
      typeof newTokens.access_token !== 'string' ||
      typeof newTokens.refresh_token !== 'string' ||
      typeof newTokens.expires_in !== 'number'
    ) {
      const err: any = new Error('Token refresh returned an invalid token payload');
      err.status = 502; // synthetic, retryable
      throw err;
    }

    // Store new tokens (refresh token is rotated)
    const now = Date.now();
    await browser.storage.local.set({
      access_token: newTokens.access_token,
      token_type: newTokens.token_type,
      expires_at: now + (newTokens.expires_in * 1000),
      refresh_token: newTokens.refresh_token,
      // Keep existing session_id and user
      session_id: tokens.session_id,
      user: tokens.user
    });
    if (typeof newTokens.refresh_expires_in === 'number') {
      await browser.storage.local.set({
        refresh_expires_at: now + (newTokens.refresh_expires_in * 1000),
      });
    } else {
      // Local mode has no refresh expiry. Drop any stale refresh_expires_at so a
      // past value can't be read as an expired refresh window on the next check.
      await browser.storage.local.remove(['refresh_expires_at']);
    }
    log.info('Access token refreshed successfully', { mode: isLocal ? 'local' : 'oauth' });
  }

  /**
   * Which refresh endpoint to use. The auth mode is established at login and
   * cached (in-memory + storage, surviving SW restarts), so this is a cheap
   * lookup during refresh. getAuthConfig() has its own fallback ladder
   * (network → last-known-good storage → 'local'), so it effectively never
   * throws; the catch here is a last-resort guard only.
   */
  private async isLocalAuthMode(): Promise<boolean> {
    try {
      const config = await getAuthConfig();
      return config.provider === 'local';
    } catch (error) {
      log.warn('Could not resolve auth mode for refresh; defaulting to OAuth', error);
      return false;
    }
  }

  /**
   * Get tokens from storage.
   * Manifest V3 Service Worker safe - fetches from storage every time.
   */
  private async getStoredTokens(): Promise<StoredTokens | null> {
    const storage = await browser.storage.local.get([
      'access_token',
      'token_type',
      'expires_at',
      'refresh_token',
      'refresh_expires_at',
      'session_id',
      'user'
    ]);

    if (!storage.access_token) {
      return null;
    }

    return storage as StoredTokens;
  }

  /**
   * Clear all tokens from storage.
   */
  async clearTokens(): Promise<void> {
    log.info('Clearing all tokens');
    await browser.storage.local.remove([
      'access_token',
      'token_type',
      'expires_at',
      'refresh_token',
      'refresh_expires_at',
      'session_id',
      'user'
    ]);
  }

  /**
   * Check if user is authenticated (has valid tokens).
   */
  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.getStoredTokens();

    if (!tokens) {
      return false;
    }

    // A still-valid access token means authenticated.
    if (tokens.expires_at > Date.now()) {
      return true;
    }

    // Otherwise we're authenticated iff we hold a usable refresh token. Local
    // sessions have NO refresh_expires_at (no refresh window) — a present
    // refresh_token is sufficient; the backend is the authority on its validity.
    // (Without this, local sessions read as unauthenticated and the keep-alive
    // heartbeat never runs.)
    if (!tokens.refresh_token) {
      return false;
    }
    return typeof tokens.refresh_expires_at !== 'number' || tokens.refresh_expires_at > Date.now();
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
