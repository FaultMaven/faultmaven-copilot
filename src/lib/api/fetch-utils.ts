import config, { getApiUrl } from "../../config";
import { authManager } from "../auth/auth-manager";
import { tokenManager } from "../auth/token-manager";
import { browser } from "wxt/browser";
import { APIError, Session } from "./types";
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

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Try to get OAuth token from TokenManager first (with auto-refresh)
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        // Use warn level for visibility in production builds
        log.warn('TokenManager returned:', { hasToken: !!accessToken });
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        } else {
          // TokenManager returned null - try fallback
          log.warn('TokenManager returned null, trying AuthManager fallback');
          const authState = await authManager.getAuthState();
          log.warn('AuthManager fallback:', { hasAuthState: !!authState, hasToken: !!authState?.access_token });
          if (authState?.access_token) {
            headers['Authorization'] = `Bearer ${authState.access_token}`;
          }
        }
      } catch (tokenError) {
        log.warn('TokenManager failed, falling back to AuthManager:', tokenError);

        // Fall back to legacy auth for backward compatibility
        const authState = await authManager.getAuthState();
        if (authState?.access_token) {
          headers['Authorization'] = `Bearer ${authState.access_token}`;
        }
      }

      // Get session ID (Manifest V3 Service Worker safe - fetched from storage every time)
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
      }
    }
  } catch (error) {
    // Ignore storage errors - API calls will proceed without auth/session
    log.warn('Failed to get auth/session headers:', error);
  }

  return headers;
}

/**
 * Create a new session directly (bypassing client resumption)
 * Use this when you explicitly want a fresh session
 */
export async function createFreshSession(metadata?: Record<string, any>): Promise<Session> {
  const url = new URL(`${await getApiUrl()}/api/v1/sessions/`);

  const requestBody = metadata ? { metadata } : {};

  // Include auth headers so backend can associate session with authenticated user
  const authHeaders = await getAuthHeaders();

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeaders,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to create session: ${response.status}`);
  }

  return response.json();
}
