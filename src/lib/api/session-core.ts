import { browser } from 'wxt/browser';
import { clientSessionManager } from "../session/client-session-manager";
import { createLogger } from "../utils/logger";
import { Session } from "./types";

const log = createLogger('SessionCore');

/**
 * Create a new session with client-based resumption support
 * Uses ClientSessionManager for automatic session resumption across browser restarts
 */
export async function createSession(metadata?: Record<string, any>): Promise<Session> {
  // Use ClientSessionManager for client-based session management
  const sessionResponse = await clientSessionManager.createSessionWithRecovery(metadata);

  // Return session in the expected format
  return {
    session_id: sessionResponse.session_id,
    created_at: sessionResponse.created_at,
    status: sessionResponse.status as 'active' | 'idle' | 'expired',
    last_activity: sessionResponse.last_activity,
    metadata: sessionResponse.metadata,
    user_id: sessionResponse.user_id,
    session_type: sessionResponse.session_type,
    client_id: sessionResponse.client_id,
    session_resumed: sessionResponse.session_resumed,
    message: sessionResponse.message
  };
}

/**
 * Persist a freshly created session so `getAuthHeaders` attaches `X-Session-Id`
 * on subsequent requests. Mirrors the keys the session slice writes.
 */
async function persistSession(session: Session): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage) {
    await browser.storage.local.set({
      sessionId: session.session_id,
      sessionCreatedAt: Date.now(),
      sessionResumed: session.session_resumed || false,
      clientId: session.client_id
    });
  }
}

// In-context single-flight guard (used only when the Web Locks API is
// unavailable, e.g. in unit tests). See refreshSession().
let refreshPromise: Promise<void> | null = null;

async function refreshSessionOnce(metadata?: Record<string, any>): Promise<void> {
  // Re-check: a concurrent request (or another extension context) may have
  // already refreshed the session while we waited for the lock/promise. If a
  // fresh sessionId is already in storage, don't POST a redundant one.
  if (typeof browser !== 'undefined' && browser.storage) {
    const existing = await browser.storage.local.get(['sessionId']);
    if (existing.sessionId) {
      log.debug('Session already refreshed by a concurrent caller; skipping create');
      return;
    }
  }

  const session = await createSession(metadata);
  if (!session.session_id) {
    throw new Error('Invalid session response: missing session_id');
  }
  await persistSession(session);
  log.info('Session refreshed and persisted', { sessionId: session.session_id });
}

/**
 * Refresh the session after a 401 SESSION_EXPIRED, then PERSIST the new
 * session_id so the retried request — and every request after it — carries
 * `X-Session-Id`. Without persisting, the retry path re-created a session but
 * left storage empty, so subsequent requests went out session-less.
 *
 * Single-flighted so N parallel failing requests trigger ONE `/sessions` POST
 * instead of a thundering herd with racing storage writes. Uses the Web Locks
 * API for cross-context coordination (MV3 service worker + sidepanel), matching
 * TokenManager's token-refresh strategy, with an in-context promise fallback.
 */
export async function refreshSession(metadata?: Record<string, any>): Promise<void> {
  // Web Locks API: true cross-context mutex.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(
      'faultmaven-session-refresh',
      { mode: 'exclusive' },
      () => refreshSessionOnce(metadata)
    );
  }

  // Fallback: in-context deduplication (single JS context only).
  if (refreshPromise) {
    log.debug('Session refresh already in progress, waiting...');
    return refreshPromise;
  }
  refreshPromise = refreshSessionOnce(metadata);
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
