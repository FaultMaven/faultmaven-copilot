/**
 * The session-write lock: one exclusive section for the code that WRITES a
 * session into storage and the code that DECIDES a stored session is debris.
 *
 * Why it exists (copilot#342). `authManager.reconcileSession()` looks at storage
 * and, finding credentials with no `authState` row, sweeps them as the remains
 * of a half-failed teardown. A sign-in writes the row and the credentials
 * together (one `set()`), but the sweep is check-then-act: it can look, see
 * nothing, let a sign-in land, look again or act, and destroy the session the
 * sign-in just created. Making the write atomic narrowed that; it could not
 * close it, because the sweep's own look and act were still two steps. Reading
 * everything in one snapshot narrows it further and still does not close it — a
 * write can land between the snapshot and the `remove()`.
 *
 * What closes it is mutual exclusion: the sweep looks AND acts inside this lock,
 * and every sign-in writes inside it, so a sign-in lands entirely before the
 * look or entirely after the act.
 *
 * WHO HOLDS IT — and why the list is what it is:
 * - The three sign-in writers: `handleStoreAuth` (Dashboard bridge, worker), the
 *   OAuth code exchange (worker) and `LocalAuthClient.storeTokens` (panel). A
 *   sign-in is the write the sweep must never interleave with; which door it
 *   came through does not change what the sweep would do to it.
 * - `reconcileSession`'s look-and-sweep.
 * - The refresh's compare-and-swap and rotated-token write
 *   (`TokenManager.performRefreshOnce`). The same check-then-act shape against
 *   the same writers: without the lock a sign-in landing between the CAS and the
 *   write is overwritten with the pre-flight identity. The network call stays
 *   OUTSIDE; only the CAS and the `set()` are held.
 *
 * WHO DOES NOT, deliberately:
 * - `clearAllAuthData()`, the teardown. `reconcileSession` calls it while holding
 *   this lock, and Web Locks are not re-entrant, so a teardown that took it
 *   would deadlock the repair. Its other callers act on a verdict about a
 *   credential they already read (a 401, a dead chain, a sign-out); a sign-in
 *   landing just before one of those is a different race — the verdict being
 *   stale — that a lock around the write alone would not fix.
 * - Readers. `assess()` and the getters only read, and a read that lands either
 *   side of a whole write sees a consistent session.
 *
 * Nothing awaited inside the lock may itself take it.
 *
 * Cross-context by construction: the worker and every extension page share one
 * origin, and Web Locks are scoped to the origin (`navigator.locks` exists in
 * Chromium's MV3 service worker and pages, and in Firefox 96+ windows, which is
 * what the MV2 background page is). Where the API is missing, the fallback
 * serializes within ONE JavaScript context only — the same degradation the
 * refresh lock accepts — which still covers two writers in the same context.
 */
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('SessionWriteLock');

export const SESSION_WRITE_LOCK = 'faultmaven-session-write';

// In-context fallback: a promise chain. Each holder runs after the previous one
// settles, whether it resolved or rejected, so one failed holder cannot poison
// the next.
let fallbackTail: Promise<unknown> = Promise.resolve();
let warnedNoLocks = false;

export function withSessionWriteLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SESSION_WRITE_LOCK, { mode: 'exclusive' }, work) as Promise<T>;
  }
  if (!warnedNoLocks) {
    warnedNoLocks = true;
    log.warn('Web Locks unavailable; session writes are serialized within this context only');
  }
  const run = fallbackTail.then(work, work);
  fallbackTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
