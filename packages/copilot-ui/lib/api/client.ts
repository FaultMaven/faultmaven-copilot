import { CredentialUnavailableError, SessionExpiredError, UserFacingError } from '../errors/types';
import { getAuthHeaders } from './fetch-utils';
import { clearPersistedSessionIf, refreshSession } from './session-core';
import { handleAuthError } from './auth-verdict';
import { createLogger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch-timeout';
import { errorBodyText } from '../errors/error-body';

const log = createLogger('APIClient');

// Default request timeout. Bounds hung connections (network stalls with no RST)
// that would otherwise leave a promise pending forever — which is especially
// damaging on the credential-renewal / poll paths. Generous enough for the 10 MB
// max file upload on a slow link; callers may override per request.
//
// Every request but a turn. `POST /cases/{id}/turns` does not use this: its
// timeout is derived from the response bound the API publishes on
// `/meta/capabilities` (`lib/utils/turn-timing.ts`), so a client timeout is
// never shorter than a turn the server is still allowed to finish.
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
 * Handle session expiration by clearing the stale session.
 *
 * `sentSessionId` is the session id the failing request actually carried (its
 * `X-Session-Id`), and only that id is cleared (`clearPersistedSessionIf`,
 * under the session lock). A late 401 from a request carrying an OLD session
 * id must not wipe a sessionId that a concurrent refresh already rotated to a
 * fresh one (#104) — clearing the fresh id would send subsequent requests out
 * session-less.
 */
async function handleSessionExpired(sentSessionId?: string): Promise<void> {
  // This is the FaultMaven session, not the credential: clearing it is a thing
  // the shared UI legitimately does.
  if (sentSessionId) await clearPersistedSessionIf(sentSessionId);

  log.warn('Session expired - cleared');
  throw new SessionExpiredError('Session expired - please refresh');
}

/**
 * Wrapper for authenticated fetch with automatic session refresh on expiration
 *
 * Session Expiration Handling (Option C):
 * 1. If backend returns 401 with SESSION_EXPIRED error code, or the request
 *    went out with no credential
 * 2. Clear the stale session_id from storage (the expiry case only)
 * 3. refreshSession() with no owner waits for any session ensure in flight and
 *    mints nothing: minting is the session slice's, for the panel's user
 *    (faultmaven#1460)
 * 4. Retry the request once — getAuthHeaders reads whatever session_id is
 *    persisted now and attaches X-Session-Id
 */
export async function authenticatedFetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  try {
    return await authenticatedFetch(url, options, timeoutMs);
  } catch (error) {
    // If session expired, refresh and retry once
    if (error instanceof SessionExpiredError ||
        (error instanceof Error && error.name === 'SessionExpiredError')) {
      log.info('Session expired, attempting refresh and retry...');

      try {
        // No owner: waits for an ensure in flight, so the retry carries its
        // X-Session-Id, and never mints itself.
        await refreshSession();

        // Retry the request with the same options
        return await authenticatedFetch(url, options, timeoutMs);
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

/**
 * The one retry after a host said it refreshed the credential.
 *
 * A separate entry point rather than a flag, because what must NOT happen is a
 * second trip through the 401 branch: asking the host again for a request
 * still rejected with a freshly minted bearer would hammer its refresh path.
 */
async function authenticatedFetchAfterRefresh(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(
    url,
    { ...options, headers: { ...headers, ...(options.headers || {}) } },
    timeoutMs,
  );

  // Still rejected, with a credential the host renewed moments ago. It
  // surfaces rather than going back round to the host. Not as a sign-out: the
  // host kept the session, and only it may end one (faultmaven#1460).
  if (response.status === 401) {
    throw new CredentialUnavailableError('The renewed credential was refused');
  }
  return response;
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
    // Authorization header when the host could not produce a token and could
    // not say why: in practice, not signed in. A 401 on such a header-less
    // request means "we had no token", not "the token is invalid" (see #99). A
    // host that KEPT the session through a renewal outage says so with
    // `CredentialUnavailableError`, and that request is never sent
    // (faultmaven#1460).
    const sentAuthKey = Object.keys(mergedHeaders).find(
      (k) => k.toLowerCase() === 'authorization' && !!(mergedHeaders as any)[k]
    );
    const sentAuthHeader = sentAuthKey !== undefined;
    // The bearer itself, for the host: a 401 is a verdict on THIS token, and
    // the host may hold a newer one by the time it lands (copilot#346).
    const sentBearer = sentAuthKey
      ? String((mergedHeaders as any)[sentAuthKey]).replace(/^Bearer\s+/i, '')
      : '';

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

      // The backend flags session expiry: clear the session and re-mint.
      if (errorData.code === 'SESSION_EXPIRED' ||
          errorData.detail?.toLowerCase().includes('session expired') ||
          errorData.detail?.toLowerCase().includes('session not found')) {
        await handleSessionExpired(sentSessionId);
        throw new SessionExpiredError('Session expired'); // Fallback in case handleSessionExpired doesn't throw
      }

      // We sent no credential, so the 401 is about that, not about the token
      // or the session. Both stay: a renewal blip must not destroy the
      // credential the next request could have used (#99), and the session is
      // not what was refused. The retry wrapper retries once and mints
      // nothing (faultmaven#1460).
      if (!sentAuthHeader) {
        log.warn('401 on a request with no Authorization header — treating as transient (token and session preserved), not a hard auth failure');
        throw new SessionExpiredError('No credential was sent');
      }

      // A 401 on a request that DID carry a credential. Whether that ends the
      // session is the HOST's call, not ours — it owns the token chain and may
      // have renewed it already. 'ended' and 'unavailable' throw inside, so
      // this is 'refreshed': retry once. `getAuthHeaders` now reads the
      // renewed bearer, and a second 401 surfaces without asking the host
      // again, and without a sign-out the host never declared.
      await handleAuthError(sentBearer);
      return await authenticatedFetchAfterRefresh(url, options, timeoutMs);
    }

    // Handle 429 Rate Limit - extract retry-after and throw special error
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

      const errorData = await response.json().catch(() => ({ detail: 'Rate limit exceeded' }));
      const error: any = new Error(errorBodyText(errorData) || `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`);
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
      const error: any = new Error(errorBodyText(errorData) || `HTTP ${response.status}`);
      error.name = 'HTTPError';
      error.status = response.status;
      error.response = { data: errorData };
      // Preserve the backend's typed error code so the classifier can map it
      // independently of status (e.g. x-error-code: QUOTA_EXHAUSTED → billing),
      // and the version pair a CASE_VERSION_CONFLICT carries.
      // Guard against responses/mocks that omit a real Headers object.
      if (response.headers && typeof response.headers.get === 'function') {
        const signals: Record<string, string> = {};
        for (const name of ['x-error-code', 'x-expected-version', 'x-actual-version']) {
          const value = response.headers.get(name);
          if (value) signals[name] = value;
        }
        if (Object.keys(signals).length > 0) error.headers = signals;
        // Retry-After in seconds, on every non-OK as on the 429 above: a 409
        // TURN_IN_PROGRESS names the seconds left on the running turn, and a
        // coded 504 (REQUEST_TIMEOUT, LLM_TIMEOUT) carries one too.
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
        if (Number.isFinite(retryAfterSeconds)) error.retryAfter = retryAfterSeconds;
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
