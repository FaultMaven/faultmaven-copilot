import config, { getApiUrl } from "../../config";
import { authManager } from "../auth/auth-manager";
import { browser } from "wxt/browser";
import { APIError, Session } from "./types";

/**
 * Gets dual headers for API requests (Authentication + Session)
 * Returns both Authorization and X-Session-Id headers when available
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Get auth token from AuthState
      const authState = await authManager.getAuthState();
      if (authState?.access_token) {
        headers['Authorization'] = `Bearer ${authState.access_token}`;
      }

      // Get session ID (keeping existing logic for compatibility)
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
      }
    }
  } catch (error) {
    // Ignore storage errors - API calls will proceed without auth/session
    console.warn('[API] Failed to get auth/session headers:', error);
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

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to create session: ${response.status}`);
  }

  return response.json();
}
