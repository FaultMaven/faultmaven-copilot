import { browser } from 'wxt/browser';
import { authManager } from '../auth/auth-manager';
import { AuthenticationError, SessionExpiredError } from '../errors/types';
import { getAuthHeaders } from './fetch-utils';
import { createSession } from './session-core';
import { createLogger } from '../utils/logger';

const log = createLogger('APIClient');

/**
 * Handles authentication errors and triggers re-authentication
 */
async function handleAuthError(): Promise<void> {
  // Clear stored auth data
  await authManager.clearAuthState();

  // Trigger re-authentication flow
  // This will be handled by the UI components
  throw new AuthenticationError('Authentication required - please sign in again');
}

/**
 * Handle session expiration by clearing stale session and triggering refresh
 */
async function handleSessionExpired(): Promise<void> {
  // Clear stale session from storage
  if (typeof browser !== 'undefined' && browser.storage) {
    await browser.storage.local.remove(['sessionId', 'sessionCreatedAt', 'sessionResumed']);
  }

  log.warn('Session expired - cleared from storage');
  throw new SessionExpiredError('Session expired - please refresh');
}

/**
 * Wrapper for authenticated fetch with automatic session refresh on expiration
 *
 * Session Expiration Handling (Option C):
 * 1. If backend returns 401 with SESSION_EXPIRED error code
 * 2. Clear stale session_id from storage
 * 3. Call createSession() to get fresh session (uses client_id for resumption)
 * 4. Retry the request once with new session_id
 */
export async function authenticatedFetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await authenticatedFetch(url, options);
  } catch (error) {
    // If session expired, refresh and retry once
    if (error instanceof SessionExpiredError ||
        (error instanceof Error && error.name === 'SessionExpiredError')) {
      log.info('Session expired, attempting refresh and retry...');

      try {
        // Get fresh session (this will call createSession which uses client_id)
        const newSession = await createSession();
        log.info('Fresh session obtained:', newSession.session_id);

        // Retry the request with the same options
        return await authenticatedFetch(url, options);
      } catch (refreshError) {
        log.error('Session refresh failed:', refreshError);
        throw refreshError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    const headers = await getAuthHeaders();

    // IMPORTANT: For binary data (FormData, Blob, File, ArrayBuffer), we must NOT set Content-Type
    const isBinaryData = options.body instanceof FormData ||
                        options.body instanceof Blob ||
                        options.body instanceof File ||
                        options.body instanceof ArrayBuffer ||
                        (options.body && (options.body as any) instanceof Uint8Array);

    if (isBinaryData) {
      delete (headers as any)['Content-Type'];
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });

    // Handle 401 errors - distinguish between auth failure and session expiration
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({ detail: 'Unauthorized' }));

      // Check if this is a session expiration (backend returns specific error code)
      if (errorData.code === 'SESSION_EXPIRED' ||
          errorData.detail?.toLowerCase().includes('session expired') ||
          errorData.detail?.toLowerCase().includes('session not found')) {
        await handleSessionExpired();
        throw new SessionExpiredError('Session expired'); // Fallback in case handleSessionExpired doesn't throw
      }

      // Otherwise it's an authentication failure
      await handleAuthError();
      throw new AuthenticationError('Authentication required');
    }

    // Enrich non-OK responses with HTTP status for error classification
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const error: any = new Error(errorData.detail || `HTTP ${response.status}`);
      error.name = 'HTTPError';
      error.status = response.status;
      error.response = { data: errorData };
      throw error;
    }

    return response;
  } catch (error) {
    // If already thrown from above (HTTP error), re-throw as-is
    if (error instanceof Error && 'status' in error) {
      throw error;
    }

    // Network errors (ECONNREFUSED, timeout, etc.) - wrap with context
    const networkError = error instanceof Error ? error : new Error(String(error));
    networkError.name = 'NetworkError';

    // Add HTTP status if available for better classification
    if ('status' in (error as any)) {
      (networkError as any).status = (error as any).status;
    }

    throw networkError;
  }
}
