import { authManager } from "../auth/auth-manager";
import { tokenManager } from "../auth/token-manager";
import { browser } from "wxt/browser";
import { createLogger } from "../utils/logger";

const log = createLogger('FetchUtils');

/**
 * Gets dual headers for API requests (Authentication + Session)
 * Returns both Authorization and X-Session-Id headers when available
 *
 * IMPORTANT: Uses TokenManager for OAuth tokens with auto-refresh.
 * Falls back to legacy AuthManager for backward compatibility.
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  // getAuthHeaders runs on every request (including each poll iteration), so the
  // happy path stays log-quiet: a single consolidated debug line at the end
  // records the auth source, and only genuinely notable states (no token, or a
  // TokenManager failure forcing fallback) warn. See the structured-logging
  // standard in CLAUDE.md.
  let authSource: 'token-manager' | 'auth-manager' | 'auth-manager-fallback' | 'none' = 'none';
  let hasSession = false;

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Try to get OAuth token from TokenManager first (with auto-refresh)
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
          authSource = 'token-manager';
        } else {
          // TokenManager returned null - try fallback
          const authState = await authManager.getAuthState();
          if (authState?.access_token) {
            headers['Authorization'] = `Bearer ${authState.access_token}`;
            authSource = 'auth-manager';
          }
        }
      } catch (tokenError) {
        // Fall back to legacy auth for backward compatibility
        const authState = await authManager.getAuthState();
        if (authState?.access_token) {
          headers['Authorization'] = `Bearer ${authState.access_token}`;
          authSource = 'auth-manager-fallback';
        }
        log.warn('TokenManager failed, fell back to AuthManager', tokenError);
      }

      // Get session ID (Manifest V3 Service Worker safe - fetched from storage every time)
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
        hasSession = true;
      }

      if (authSource === 'none') {
        log.warn('No JWT token available - session will be created as anonymous');
      } else {
        log.debug('Auth headers prepared', { authSource, hasSession });
      }
    }
  } catch (error) {
    // Ignore storage errors - API calls will proceed without auth/session
    log.warn('Failed to get auth/session headers:', error);
  }

  return headers;
}
