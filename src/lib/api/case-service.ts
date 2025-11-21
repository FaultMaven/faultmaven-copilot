/**
 * Case Service - API calls for case UI data
 */

import type { CaseUIResponse } from '../../types/case';
import { getApiUrl } from '../../config';

/**
 * Gets dual headers for API requests (Authentication + Session)
 * Returns both Authorization and X-Session-Id headers when available
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Get auth token from AuthState
      const result = await browser.storage.local.get(['authState']);
      const authState = result.authState;

      if (authState?.access_token) {
        // Check if token is expired
        if (Date.now() < authState.expires_at) {
          headers['Authorization'] = `Bearer ${authState.access_token}`;
        }
      }

      // Get session ID
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
      }
    }
  } catch (error) {
    console.warn('[CaseService] Failed to get auth/session headers:', error);
  }

  return headers;
}

/**
 * Fetch UI-optimized case data
 */
async function getCaseUI(caseId: string, sessionId: string): Promise<CaseUIResponse> {
  const headers = await getAuthHeaders();
  const apiUrl = await getApiUrl();

  const response = await fetch(`${apiUrl}/api/v1/cases/${caseId}/ui`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch case UI data' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const caseApi = {
  getCaseUI,
};
