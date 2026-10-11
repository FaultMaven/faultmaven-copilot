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
 * - The teardown, `authManager.clearAllAuthData()` (copilot#346). Inside the
 *   lock it compares the stored credential with the one its verdict judged and
 *   stands down if a newer sign-in replaced it; and a refresh's CAS-and-write can
 *   no longer straddle it and put a signed-out user's credentials back.
 *   `reconcileSession` already holds the lock when it repairs, so it calls the
 *   private `runTeardown` directly — Web Locks are not re-entrant.
 *
 * WHO DOES NOT: readers. `assess()` and the getters only read, and a read that
 * lands either side of a whole write sees a consistent session.
 *
 * Nothing awaited inside the lock may itself take it.
 *
 * BOUNDED WAITS. A caller that must not hang passes `waitMs`: if the lock is
 * not granted in time the work runs WITHOUT it, logged at warn. The teardown
 * does — a sign-out is followed by the broadcast that makes it observable, and
 * a holder wedged on a storage call that never settles must not keep a user
 * signed in (the #335 lesson). Losing exclusion in that pathological case is
 * the smaller failure. Writers wait without a bound: a sign-in that waits is
 * late, not lost.
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

export interface SessionWriteLockOptions {
  /**
   * Give up waiting after this long and run `work` without the lock. For
   * callers that must complete — the teardown — rather than be late.
   */
  waitMs?: number;
}

export function withSessionWriteLock<T>(
  work: () => Promise<T>,
  { waitMs }: SessionWriteLockOptions = {},
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    if (waitMs === undefined) {
      return navigator.locks.request(SESSION_WRITE_LOCK, { mode: 'exclusive' }, work) as Promise<T>;
    }
    return requestWithin(work, waitMs);
  }
  if (!warnedNoLocks) {
    warnedNoLocks = true;
    log.warn('Web Locks unavailable; session writes are serialized within this context only');
  }
  const turn = waitMs === undefined ? fallbackTail : raceWait(fallbackTail, waitMs);
  const run = turn.then(work, work);
  fallbackTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Web Locks with a bounded wait for the GRANT — the work itself is not timed. */
async function requestWithin<T>(work: () => Promise<T>, waitMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let granted = false;
  try {
    return (await navigator.locks.request(
      SESSION_WRITE_LOCK,
      { mode: 'exclusive', signal: controller.signal },
      () => {
        granted = true;
        clearTimeout(timer);
        return work();
      },
    )) as T;
  } catch (error) {
    if (granted) throw error;
    log.warn('Session-write lock not granted in time; proceeding without it', { waitMs });
    return work();
  } finally {
    clearTimeout(timer);
  }
}

/** The fallback's wait, bounded: settles when the tail does or the time is up. */
function raceWait(tail: Promise<unknown>, waitMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn('Session-write lock not granted in time; proceeding without it', { waitMs });
      resolve();
    }, waitMs);
  });
  return Promise.race([tail.then(() => undefined, () => undefined), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
