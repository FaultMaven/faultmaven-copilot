import { browser } from 'wxt/browser';
import { authManager } from '../auth/auth-manager';
import { AuthenticationError, SessionExpiredError, UserFacingError } from '../errors/types';
import { getAuthHeaders } from './fetch-utils';
import { refreshSession } from './session-core';
import { bumpEpoch } from '../state/session-epoch';
import { createLogger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch-timeout';

const log = createLogger('APIClient');

// Default request timeout. Bounds hung connections (network stalls with no RST)
// that would otherwise leave a promise pending forever — which is especially
// damaging on the token-refresh / poll paths. Generous enough for the 10 MB
// max file upload on a slow link; callers may override per request.
//
// Sized as the MIDDLE rung of the turn timeout ladder: server per-turn ceiling
// (240s) < this client timeout (300s) < ingress proxy-read (600s). Keeping the
// client ABOVE the server ceiling means a slow investigation turn surfaces the
// server's real error/partial instead of a bare client-side "Request timed out"
// abort. It was previously 120_000, equal to the old server ceiling — the two
// raced, and the client usually won, producing exactly that opaque timeout.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Prepares a request body for JSON serialization.
 *
 * Converts undefined values to null to ensure consistent backend behavior.
 * This addresses the TypeScript-to-REST semantic mismatch where JSON.stringify
 * silently strips undefined values, which can cause unexpected backend defaults.
 *
 * Design rationale:
 * - undefined → null: Explicitly tells backend "this field is empty"
 * - Missing field: Use optional types (field?: T) and don't include in object
 * - null: Preserved as-is
 * - Other values: Preserved as-is
 *
 * @param body - The request body object to serialize
 * @returns JSON string with undefined values converted to null
 */
export function prepareBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;

  return JSON.stringify(body, (_key, value) => {
    // Convert undefined to null for explicit backend signaling
    return value === undefined ? null : value;
  });
}

/**
 * Handles authentication errors and triggers re-authentication
 */
async function handleAuthError(): Promise<void> {
  // A hard 401 ends the session. Fence it synchronously (before the await below)
  // so any in-flight background writer in THIS context whose continuation is
  // already queued skips its post-await writes rather than repopulating state
  // we're about to tear down. When handleAuthError runs in the background
  // context instead, this bumps the background epoch; the sidepanel bumps its
  // own epoch off the resulting `{ isAuthenticated: false }` broadcast/storage
  // change (see auth-slice).
  bumpEpoch();

  // A hard 401 auth failure (not a recoverable SESSION_EXPIRED) means the
  // credential itself is no longer valid — clear ALL local auth data, including
  // the token keys, so a stale refresh_token can't silently re-authenticate.
  await authManager.clearAllAuthData();

  // Trigger re-authentication flow
  // This will be handled by the UI components
  throw new AuthenticationError('Authentication required - please sign in again');
}

/**
 * Handle session expiration by clearing the stale session and triggering refresh.
 *
 * `sentSessionId` is the session id the failing request actually carried (its
 * `X-Session-Id`). When provided we **compare-and-remove**: only clear storage
 * if it still holds that same id. A late 401 from a request carrying an OLD
 * session id must not wipe a sessionId that a concurrent refresh already rotated
 * to a fresh one (#104) — clearing the fresh id would send subsequent requests
 * out header-less and trigger a redundant second `/sessions` POST.
 */
async function handleSessionExpired(sentSessionId?: string): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage) {
    if (sentSessionId) {
      const { sessionId: storedSessionId } = await browser.storage.local.get(['sessionId']);
      if (storedSessionId && storedSessionId !== sentSessionId) {
        log.info('Late 401 for a superseded session — leaving the fresh session intact', {
          sentSessionId,
          storedSessionId
        });
        throw new SessionExpiredError('Session expired - please refresh');
      }
    }
    // Clear stale session from storage (storage still holds the failed id, or we
    // couldn't identify it — clear to force a fresh refresh either way).
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
 * 3. refreshSession() gets a fresh session (uses client_id for resumption),
 *    single-flighted across concurrent requests/contexts, and PERSISTS the new
 *    session_id to storage
 * 4. Retry the request once — getAuthHeaders now reads the persisted session_id
 *    and attaches X-Session-Id
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
        // Single-flighted refresh: N parallel 401s trigger ONE /sessions POST,
        // and the new session_id is persisted so the retry carries X-Session-Id.
        await refreshSession();

        // Retry the request with the same options
        return await authenticatedFetch(url, options);
      } catch (refreshError) {
        // Covers both a failed refresh and a retry that 401s again (no second
        // retry — the error propagates rather than looping).
        log.error('Session refresh/retry failed:', refreshError);
        throw refreshError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
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

    const mergedHeaders = {
      ...headers,
      ...(options.headers || {})
    };

    // Did we actually attach a credential? getAuthHeaders returns no
    // Authorization header when getValidAccessToken yields null — which happens
    // during a transient refresh-endpoint outage where TokenManager DELIBERATELY
    // preserves the tokens (mid-session resilience). A 401 on such a header-less
    // request means "we had no token", not "the token is invalid" (see #99).
    const sentAuthHeader = Object.keys(mergedHeaders).some(
      (k) => k.toLowerCase() === 'authorization' && !!(mergedHeaders as any)[k]
    );

    // The session id this request actually carried — used for the compare-and-
    // remove in handleSessionExpired so a late 401 can't wipe a fresher session (#104).
    const sentSessionKey = Object.keys(mergedHeaders).find(
      (k) => k.toLowerCase() === 'x-session-id'
    );
    const sentSessionId = sentSessionKey ? (mergedHeaders as any)[sentSessionKey] : undefined;

    const response = await fetchWithTimeout(url, {
      ...options,
      headers: mergedHeaders
    }, timeoutMs);

    // Handle 401 errors - distinguish between auth failure and session expiration
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({ detail: 'Unauthorized' }));

      // Treat as a recoverable session condition when EITHER the backend flags
      // session expiry OR we sent no credential at all. Routing the header-less
      // case here (instead of through handleAuthError) preserves the still-valid
      // refresh_token: a transient refresh blip must not force a full logout by
      // destroying the credential the next request could have refreshed (#99).
      if (!sentAuthHeader ||
          errorData.code === 'SESSION_EXPIRED' ||
          errorData.detail?.toLowerCase().includes('session expired') ||
          errorData.detail?.toLowerCase().includes('session not found')) {
        if (!sentAuthHeader) {
          log.warn('401 on a request with no Authorization header — treating as transient (token preserved), not a hard auth failure');
        }
        await handleSessionExpired(sentSessionId);
        throw new SessionExpiredError('Session expired'); // Fallback in case handleSessionExpired doesn't throw
      }

      // A 401 on a request that DID carry a credential means the credential is
      // no longer valid → full teardown (clears tokens; see handleAuthError).
      await handleAuthError();
      throw new AuthenticationError('Authentication required');
    }

    // Handle 429 Rate Limit - extract retry-after and throw special error
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

      const errorData = await response.json().catch(() => ({ detail: 'Rate limit exceeded' }));
      const error: any = new Error(errorData.detail || `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`);
      error.name = 'RateLimitError';
      error.status = 429;
      error.retryAfter = retryAfterSeconds;
      error.response = { data: errorData };

      log.warn(`Rate limit exceeded, retry after ${retryAfterSeconds}s`);
      throw error;
    }

    // Enrich non-OK responses with HTTP status for error classification
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const error: any = new Error(errorData.detail || `HTTP ${response.status}`);
      error.name = 'HTTPError';
      error.status = response.status;
      error.response = { data: errorData };
      // Preserve the backend's typed error code so the classifier can map it
      // independently of status (e.g. x-error-code: QUOTA_EXHAUSTED → billing).
      // Guard against responses/mocks that omit a real Headers object.
      if (response.headers && typeof response.headers.get === 'function') {
        const errCode = response.headers.get('x-error-code');
        if (errCode) error.headers = { 'x-error-code': errCode };
      }
      throw error;
    }

    return response;
  } catch (error) {
    // Timeout (from fetchWithTimeout) or caller-initiated cancellation →
    // propagate as-is rather than masking it as a generic network failure.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw error;
    }
    if (options.signal?.aborted) {
      throw error;
    }

    // Already-classified errors (AuthenticationError, SessionExpiredError, …
    // thrown from the auth/session branches above) must propagate with their
    // real name/category intact. Rebranding them as 'NetworkError' below would
    // make a hard 401 look retryable — the async-turn poll loop keys its
    // terminal check on err.name, so a mislabelled auth failure would be
    // retried instead of aborted.
    if (error instanceof UserFacingError) {
      throw error;
    }

    // If already thrown from above (HTTP error), re-throw as-is
    if (error instanceof Error && 'status' in error) {
      throw error;
    }

    // Network errors (ECONNREFUSED, etc.) - wrap with context
    const networkError = error instanceof Error ? error : new Error(String(error));
    networkError.name = 'NetworkError';

    // Add HTTP status if available for better classification
    if ('status' in (error as any)) {
      (networkError as any).status = (error as any).status;
    }

    throw networkError;
  }
}
