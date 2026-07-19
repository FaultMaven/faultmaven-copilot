/**
 * Session Epoch
 *
 * A module-level, monotonically-increasing counter that identifies the current
 * authenticated session. It is bumped whenever the session ends — user logout
 * (`handleLogout`) or a hard auth failure (`client.ts handleAuthError`) — and,
 * cross-context, whenever the sidepanel observes an `{ isAuthenticated: false }`
 * broadcast/storage change (see `auth-slice`).
 *
 * ## Why this exists
 *
 * Module singletons (`idMappingManager`, `pendingOpsManager`) and the
 * post-`await` continuations of background writers have no notion of "the
 * session/user changed underneath me." A `createCase` that was already in flight
 * at logout can resolve *after* the purge and re-write `faultmaven_current_case`,
 * id-mappings, and conversations back into the just-cleared store/storage. On
 * OAuth/cloud with a shared browser profile that is a cross-user state leak: the
 * next user's login auto-reselects the prior user's case (via the #130 restore).
 *
 * ## Why an epoch and not the alternatives
 *
 * - **Abort-only is insufficient:** a `createCase` that resolved a microtask
 *   before logout already has its continuation queued — only a *post-await* check
 *   can stop it, and that check *is* the epoch (`createCase` isn't signal-threaded
 *   today anyway).
 * - **Re-reading `isAuthenticated` after the await is insufficient:** on
 *   logout→quick-relogin the flag is `true` again, so a stale writer leaks the
 *   *old* session's case into the *new* login. A monotonic epoch distinguishes
 *   sessions; a boolean can't. The epoch check is also synchronous — it adds no
 *   new `await`/race window.
 *
 * ## Guard pattern
 *
 * A background writer captures the epoch before its first `await`, then bails
 * (skipping every store/storage/singleton write) if the epoch has since moved:
 *
 * ```ts
 * const epoch = getEpoch();
 * const value = await someRequest();
 * if (epoch !== getEpoch()) return; // session ended mid-flight — discard
 * writeToStore(value);
 * ```
 *
 * Deliberately **not** storage-backed: a persisted epoch would make every guard
 * async and reintroduce the very race it closes.
 *
 * ## Also here: the session-teardown flag
 *
 * This module additionally hosts `markSessionEnding()` / `isSessionEnding()` — a
 * sibling teardown signal for purge-coupled reloads (see their own docs). It lives
 * here rather than in `store.ts` because it is set by the reload paths (auth-slice,
 * `handleAuthSuccess`) and read by `store.ts`'s `beforeunload` handler; a
 * zero-dependency module both can import keeps that cycle-free.
 */

let epoch = 0;

/** The current session epoch. Cheap, synchronous, safe to read before any write. */
export function getEpoch(): number {
  return epoch;
}

let sessionEnding = false;

/**
 * Mark that the current session is ending or handing off (logout / identity switch)
 * and a page reload is imminent.
 *
 * The persistence layer's `beforeunload` handler (`store.ts`) checks this to CANCEL
 * rather than flush the pending debounced persist. A flush here would write the
 * ending session's in-memory state back to `browser.storage.local` — and that state
 * can be a prior user's at-rest residue (hydrated by `useDataRecovery`) that the
 * background just purged, re-homing it under the new owner after the purge (#164).
 * `handleLogout` already cancels the debounce before its purge; the reload paths
 * (auth-slice identity switch, `handleAuthSuccess`) mark this instead, since the
 * flush they must suppress runs at `beforeunload`, after their code has returned.
 *
 * One-shot for the page's lifetime; a reload starts a fresh module with it false.
 */
export function markSessionEnding(): void {
  sessionEnding = true;
}

/** Whether a teardown/hand-off reload is in progress (see `markSessionEnding`). */
export function isSessionEnding(): boolean {
  return sessionEnding;
}

/**
 * End the current session epoch and begin a new one. Call this the moment a
 * session ends (logout / hard auth failure) so any in-flight background writer's
 * captured epoch no longer matches and its post-`await` writes are discarded.
 * Returns the new epoch.
 */
export function bumpEpoch(): number {
  epoch += 1;
  return epoch;
}
