import { ownedStorage } from '../owned-storage';
import { clientSessionManager } from "../session/client-session-manager";
import { getEpoch } from '../state/session-epoch';
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

// The tail of the in-context ensure chain (used only when the Web Locks API is
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

async function refreshSessionOnce(
  owner: string,
  epoch: number,
  metadata?: Record<string, any>,
): Promise<void> {
  // The session ended while this waited for the lock: mint nothing for it.
  if (getEpoch() !== epoch) {
    log.info('Session ended while waiting for the session lock; not minting');
    return;
  }

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
  // The session ended while the mint was out (a sign-out purge has run, or is
  // about to): writing it now would put the departed user's session back.
  if (getEpoch() !== epoch) {
    log.info('Session ended during the mint; not persisting it', { sessionId: session.session_id });
    return;
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
 * TokenManager's token-refresh strategy, with an in-context fallback that
 * CHAINS each caller behind the one in flight: a caller for the same owner then
 * costs a storage read, never a second POST, and a caller for another owner
 * mints its own session instead of adopting the one in flight
 * (faultmaven#1460). Residual without Web Locks (Safari before 15.4): a new
 * user's requests can carry the previous user's `X-Session-Id` between mount
 * and persist, since `getAuthHeaders` has no owner to compare; step 4 of
 * faultmaven#1460 ties a session to its bearer on the server.
 *
 * Fenced by the session epoch, captured before the lock: a sign-out while this
 * waits for the lock sends no POST, and one while the mint is out persists
 * nothing. Same-context only: a mint that resolves here before this context
 * hears of a sign-out in another is persisted, then removed by that notice's
 * purge, and the server session it minted (with the bearer) is reaped at TTL.
 */
export async function refreshSession(owner?: string, metadata?: Record<string, any>): Promise<void> {
  if (!owner) return underSessionLock(async () => {});

  const epoch = getEpoch();

  // Web Locks API: true cross-context mutex.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SESSION_LOCK, { mode: 'exclusive' }, () =>
      refreshSessionOnce(owner, epoch, metadata),
    );
  }

  // Fallback: in-context serialization (single JS context only).
  const run = (refreshPromise ?? Promise.resolve())
    .catch(() => {})
    .then(() => refreshSessionOnce(owner, epoch, metadata));
  refreshPromise = run;
  try {
    await run;
  } finally {
    if (refreshPromise === run) refreshPromise = null;
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
