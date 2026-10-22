import { ownedStorage } from '../owned-storage';
import { clientSessionManager } from "../session/client-session-manager";
import { createLogger } from "../utils/logger";
import { Session } from "./types";

const log = createLogger('SessionCore');

/**
 * Create a new session with client-based resumption support
 * Uses ClientSessionManager for automatic session resumption across browser restarts
 */
export async function createSession(
  expectedOwner: string,
  metadata?: Record<string, any>,
): Promise<Session> {
  // Use ClientSessionManager for client-based session management
  const sessionResponse = await clientSessionManager.createSessionWithRecovery(expectedOwner, metadata);

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
/**
 * The keys a FaultMaven session occupies.
 *
 * `clientId` is separated because it deliberately OUTLIVES a session: a fresh
 * `/sessions` POST presents it to resume rather than start cold, so clearing a
 * stale session must not take it.
 */
const SESSION_KEYS = ['sessionId', 'sessionUserId', 'sessionCreatedAt', 'sessionResumed'] as const;
const CLIENT_KEY = 'clientId';

async function persistSession(session: Session): Promise<void> {
  await ownedStorage.set({
    sessionId: session.session_id,
    // Whose session it is: one minted for nobody, or for another user, is
    // never reused or heartbeated (faultmaven#1460).
    sessionUserId: session.user_id,
    sessionCreatedAt: Date.now(),
    sessionResumed: session.session_resumed || false,
    [CLIENT_KEY]: session.client_id
  });
}

/**
 * Discard the stored session. THE single clear, as `persistSession` is the
 * single write.
 *
 * Three places used to remove these keys with three slightly different key
 * lists — the client's 401 path, the session slice's teardown, and the
 * extension transport — so which keys survived a clear depended on who cleared.
 * `includeClientId` is the one real distinction, named rather than implied by
 * whichever list the caller happened to copy.
 */
export interface ClearPersistedSessionOptions {
  /**
   * Take `clientId` too. It OUTLIVES a session by default — a fresh
   * `/sessions` POST presents it to resume rather than start cold — so only a
   * caller ending the identity, not the session, asks for this.
   */
  includeClientId?: boolean;
}

export async function clearPersistedSession(
  { includeClientId = false }: ClearPersistedSessionOptions = {}
): Promise<void> {
  const keys: string[] = [...SESSION_KEYS];
  if (includeClientId) keys.push(CLIENT_KEY);
  await ownedStorage.remove(keys);
}

// In-context single-flight guard (used only when the Web Locks API is
// unavailable, e.g. in unit tests). See refreshSession().
let refreshPromise: Promise<void> | null = null;

const SESSION_LOCK = 'faultmaven-session-refresh';

/**
 * `task` under the session lock: the Web Lock across contexts, or, without
 * Web Locks, after any in-context refresh in flight.
 */
async function underSessionLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SESSION_LOCK, { mode: 'exclusive' }, task);
  }
  if (refreshPromise) await refreshPromise.catch(() => {});
  return task();
}

async function refreshSessionOnce(owner: string, metadata?: Record<string, any>): Promise<void> {
  // Re-check: a concurrent request (or another extension context) may have
  // already refreshed the session while we waited for the lock/promise. If a
  // session OWNED by this user is already in storage, don't POST another.
  // One minted for nobody, for another user, or stored before owners were
  // recorded is replaced — by `persistSession` overwriting it, never by a
  // clear: a failed mint leaves it stored, since it may be another user's
  // perfectly good session (another account signed in on this browser).
  const existing = (await ownedStorage.get(['sessionId', 'sessionUserId'])) as
    { sessionId?: string; sessionUserId?: string };
  if (existing.sessionId && existing.sessionUserId === owner) {
    log.debug('Session already refreshed by a concurrent caller; skipping create');
    return;
  }

  const session = await createSession(owner, metadata);
  if (!session.session_id) {
    throw new Error('Invalid session response: missing session_id');
  }
  await persistSession(session);
  log.info('Session refreshed and persisted', { sessionId: session.session_id });
}

/**
 * Ensure a session owned by `owner` (the panel's signed-in user): a no-op when
 * storage holds one; otherwise mint it, then PERSIST the new session_id so
 * every request after it carries `X-Session-Id`.
 *
 * With no `owner` it never mints and never clears: it only waits for any
 * ensure in flight, so a caller that retries after it (`client.ts`'s retry
 * wrapper) carries that ensure's session (faultmaven#1460).
 *
 * Single-flighted so N parallel callers trigger ONE `/sessions` POST instead
 * of a thundering herd with racing storage writes. Uses the Web Locks API for
 * cross-context coordination (MV3 service worker + sidepanel), matching
 * TokenManager's token-refresh strategy, with an in-context promise fallback.
 */
export async function refreshSession(owner?: string, metadata?: Record<string, any>): Promise<void> {
  if (!owner) return underSessionLock(async () => {});

  // Web Locks API: true cross-context mutex.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SESSION_LOCK, { mode: 'exclusive' }, () =>
      refreshSessionOnce(owner, metadata),
    );
  }

  // Fallback: in-context deduplication (single JS context only).
  if (refreshPromise) {
    log.debug('Session refresh already in progress, waiting...');
    return refreshPromise;
  }
  refreshPromise = refreshSessionOnce(owner, metadata);
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Discard the stored session only if it is still `sessionId`: the one a 401
 * or a dead heartbeat was about. Under the session lock, so a session another
 * caller has just stored is never the one cleared (#104).
 */
export async function clearPersistedSessionIf(sessionId: string): Promise<void> {
  await underSessionLock(async () => {
    const stored = (await ownedStorage.get(['sessionId'])) as { sessionId?: string };
    if (stored.sessionId === sessionId) await clearPersistedSession();
  });
}
