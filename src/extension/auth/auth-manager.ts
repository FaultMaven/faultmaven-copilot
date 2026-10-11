import { browser } from 'wxt/browser';
import { AuthState, User } from '@faultmaven/copilot-ui/lib/api/types';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { tokenManager } from './token-manager';
import { AUTH_STATE_KEY, CREDENTIAL_KEYS } from './storage-keys';
import { withSessionWriteLock } from './session-write-lock';

const log = createLogger('AuthManager');

/**
 * The credential a teardown's verdict was about: the access token a dead chain
 * was read with, or the bearer a 401 rejected (copilot#346).
 */
export interface JudgedCredential {
  accessToken: string;
}

/**
 * `'ended'` — the session was torn down. `'superseded'` — a newer session had
 * replaced the judged credential, and was left alone.
 */
export type TeardownOutcome = 'ended' | 'superseded';

/** How long a teardown waits for the session-write lock before going without. */
export const TEARDOWN_LOCK_WAIT_MS = 2_000;

/**
 * Auth manager for centralized authentication state
 */
class AuthManager {
  async saveAuthState(authState: AuthState): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.set({ [AUTH_STATE_KEY]: authState });
    }
  }

  async getAuthState(): Promise<AuthState | null> {
    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        const result = await browser.storage.local.get([AUTH_STATE_KEY]);
        const authState = result[AUTH_STATE_KEY];

        if (!authState) return null;

        // A READ, not a repair. Answering "nobody is signed in" is this
        // method's whole contract; tearing down is not. It used to do both, and
        // that made every caller destructive — `extension-reload.ts` asks this
        // to decide whether the extension reloaded, and `options/main.tsx` asks
        // it to render a name. Neither should be able to sign the user out.
        //
        // The credential stack is the authority on liveness, so ask it rather
        // than re-deriving from `authState.expires_at` — the same number it
        // already owns, stored twice by every writer. A third reader of one fact
        // is how the divergence started.
        if (!(await tokenManager.isAuthenticated())) return null;

        return authState;
      }
    } catch (error) {
      log.warn('Failed to get auth state:', error);
    }
    return null;
  }

  /**
   * The identity half of a teardown: the `authState` row and the case cache,
   * leaving the credential keys. Its one legitimate caller is
   * `clearAllAuthData()`, which is built out of it — on its own it leaves a live
   * Bearer that TokenManager can re-mint from. See src/extension/auth/CLAUDE.md,
   * "Auth teardown".
   */
  async clearAuthState(): Promise<void> {
    if (typeof browser === 'undefined' || !browser.storage) return;
    // Row first — its removal is what makes the sign-out observable — but the
    // cache purge runs either way: stopping on a failed row-removal would leave
    // the previous user's case list at rest on a shared machine.
    // `fence()` is synchronous and cannot throw: it moves the cache generation
    // and queues the removal without waiting on it, so a storage call that
    // never settles cannot hold the teardown back from its broadcast. Only the
    // storage write needs catching here.
    try {
      await browser.storage.local.remove([AUTH_STATE_KEY]);
    } catch (error) {
      log.error('Could not remove authState during teardown', error);
    }
    caseCacheManager.fence();
  }

  /**
   * Full local auth teardown for logout and hard (401) auth failures: clears the
   * composite `authState` (+ case cache) AND every token key managed by
   * TokenManager (`access_token`, `refresh_token`, `refresh_expires_at`, …).
   *
   * clearAuthState() alone is NOT sufficient for logout: it leaves the token
   * keys, and TokenManager will silently re-mint a session from the surviving
   * `refresh_token` — the previous user stays authenticated on a shared
   * machine. (It is TokenManager that re-mints, not `getAuthHeaders`: that
   * reads only `transport.accessToken()` and never touches `authState`.)
   */
  async clearAllAuthData(judged?: JudgedCredential): Promise<TeardownOutcome> {
    // SINGLE-FLIGHTED HERE, not at one call site. Several places tear a session
    // down — the act-site on a session verdict, `onUnauthorized` on a hard 401,
    // `logoutAuth`, the options page — and the first two fire once per failing
    // request. The panel routinely has a heartbeat, a turn poll and a case
    // fetch in flight, so a revoked credential otherwise means three teardowns,
    // three cache purges and three sign-out notifications.
    //
    // Keyed by WHAT is being torn down: N verdicts about the same credential
    // join one teardown, but a deliberate sign-out never joins a conditional
    // teardown that may stand down — it would inherit a "superseded" that was
    // never about it. Per-JS-context; the lock below is what is cross-context.
    const key = judged ? `judged:${judged.accessToken}` : 'unconditional';
    const inFlight = this.teardownsInFlight.get(key);
    if (inFlight) return inFlight;
    const run = this.runTeardownLocked(judged).finally(() => {
      this.teardownsInFlight.delete(key);
    });
    this.teardownsInFlight.set(key, run);
    return run;
  }

  private teardownsInFlight = new Map<string, Promise<TeardownOutcome>>();

  /**
   * The teardown inside the session-write lock (copilot#346).
   *
   * Held so a sign-in and a refresh's compare-and-swap-and-write each land
   * wholly before or wholly after it: a refresh can no longer put a signed-out
   * user's credentials back, and the verdict check below is made against the
   * storage the teardown then removes.
   *
   * A JUDGED teardown — one acting on a verdict about a particular credential:
   * a dead chain, or a 401 for the bearer a request carried — stands down when
   * the stored access token is no longer that one. A sign-in (or a refresh)
   * replaced it after the verdict was formed, and the verdict is not about the
   * session that exists now. An unconditional teardown — the user signing out
   * — removes whatever is there.
   *
   * The wait for the lock is BOUNDED (`TEARDOWN_LOCK_WAIT_MS`): past it, the
   * teardown runs without the lock rather than wait on a holder wedged on a
   * storage call. Every caller broadcasts or answers right after this, and a
   * sign-out that never completes is the worse failure (#335).
   *
   * Never rejects: `runTeardown` cannot, and the comparison read is guarded —
   * if it fails, the teardown proceeds, which is what it did before it could
   * compare at all.
   */
  private runTeardownLocked(judged?: JudgedCredential): Promise<TeardownOutcome> {
    return withSessionWriteLock(
      async () => {
        if (judged && (await this.replacedSince(judged))) {
          log.info('A newer session replaced the credential this teardown was about; standing down');
          return 'superseded' as const;
        }
        await this.runTeardown();
        return 'ended' as const;
      },
      { waitMs: TEARDOWN_LOCK_WAIT_MS },
    );
  }

  /** Is the stored access token a DIFFERENT one from the credential judged? */
  private async replacedSince(judged: JudgedCredential): Promise<boolean> {
    try {
      const stored = await browser.storage.local.get(['access_token']);
      const current = stored.access_token;
      return typeof current === 'string' && current !== judged.accessToken;
    } catch (error) {
      log.warn('Could not compare the stored credential before teardown; tearing down', error);
      return false;
    }
  }

  /**
   * NEVER REJECTS, and that is a contract, not laziness.
   *
   * Every caller does something load-bearing immediately afterwards:
   * `logoutAuth` broadcasts `auth_state_changed`, `LocalAuthClient.signOut`
   * broadcasts too, and `onUnauthorized` must return an `AuthOutcome` because
   * `client.ts` awaits it unguarded and turns anything else into an
   * `UnknownError` — so the sign-in prompt never appears. A teardown that threw
   * suppressed exactly the notification that makes the sign-out observable,
   * which is this area's original bug pointed the other way.
   *
   * Storage failing is real and is logged at error; there is nothing a caller
   * could usefully do with it that is worth losing the broadcast for.
   */
  private async runTeardown(): Promise<void> {
    // `clearAuthState()` swallows its own storage failure and cannot reject.
    //
    // ⚠️ Known gap, deliberately not papered over: if that removal fails, the
    // credentials go but the row stays, and nothing observes the difference —
    // `subscribeExtensionAuthState` watches the row and the broadcast, and a
    // failed removal fires neither. Broadcasting from here does NOT fix it:
    // `runtime.sendMessage` is not delivered to the sender's own context, and
    // the act-site runs in the panel, so it would reach every context except
    // the one that needs it. The repair is `reconcileSession()` on the next
    // panel start, which sweeps BOTH splits this can leave — a row with no
    // credential, and credentials with no row.
    await this.clearAuthState();

    try {
      await tokenManager.clearTokens();
    } catch (error) {
      log.error('Credential teardown failed', error);
    }

  }

  /**
   * Repair a session that storage can no longer support, and say so.
   *
   * The EXPLICIT counterpart to the getters above: an `authState` row with no
   * live credential behind it reads as signed in to everything that looks, and
   * nothing else removes it — a pre-fix build left exactly that state, and an
   * upgrading user carries it across. Reconciling inside `getAuthState()`
   * instead is what made a read destructive; it belongs in a call that says
   * what it does, made once, where the host already owns the teardown.
   */
  async reconcileSession(): Promise<AuthState | null> {
    if (typeof browser === 'undefined' || !browser.storage) return null;

    // The look AND the act happen inside the session-write lock, which every
    // sign-in writer also holds (copilot#342). Without it this was
    // check-then-act against a concurrent sign-in: the look saw no row, the
    // sign-in landed, and the act found credentials — a session seconds old,
    // swept as an orphan, and the user who had just signed in on the Dashboard
    // was shown the sign-in screen. Atomic sign-in writes narrowed that and one
    // snapshot here narrows it further; neither closes it, because a write can
    // still land between the look and the `remove()`. Exclusion does: a
    // sign-in now lands wholly before the look or wholly after the act.
    //
    // The repair below calls `runTeardown` directly: the public
    // `clearAllAuthData()` takes this same lock, and Web Locks are not
    // re-entrant — see session-write-lock.ts.
    return withSessionWriteLock(() => this.reconcileSessionLocked());
  }

  private async reconcileSessionLocked(): Promise<AuthState | null> {
    let authState: AuthState | null = null;
    let live: boolean;
    try {
      // ONE read for the row and the credential keys, so the decision below is
      // made on a single state of storage rather than on two.
      const stored = await browser.storage.local.get([AUTH_STATE_KEY, ...CREDENTIAL_KEYS]);
      authState = (stored[AUTH_STATE_KEY] as AuthState | undefined) ?? null;

      if (!authState) {
        // No row — but credentials can OUTLIVE it, and that is the mirror of the
        // original bug rather than the ordinary signed-out state. `runTeardown`
        // removes the row first and can then fail on the credentials (swallowed,
        // by design, so the broadcast still runs), leaving a bearer at rest that
        // nothing will ever remove: the panel shows the sign-in screen, so no
        // later request reaches the credential stack to notice.
        // PRESENCE, not liveness. The orphan this sweeps exists precisely
        // because the chain was ruled DEAD — that verdict is what ran the
        // teardown whose credential half then failed. Gating on
        // `isAuthenticated()` therefore asks the one question guaranteed to
        // answer false, and the sweep never fired. (The first test for this
        // staged a LIVE orphan, so it passed and proved nothing.)
        // ANY credential key, not just the access token: a partially-failed
        // teardown can leave `refresh_token` behind on its own, and gating on
        // the access token alone left it at rest forever with nothing that
        // would ever remove it.
        if (CREDENTIAL_KEYS.some((k) => stored[k] !== undefined)) {
          log.warn('Credentials outlived their session row; clearing them');
          await tokenManager.clearTokens();
        }
        return null;
      }
      // Asked DIRECTLY, not via getAuthState(), which folds "the read threw"
      // into the same `null` as "no live session" — reconciling on that
      // conflation turns a storage error into a sign-out of a live session.
      //
      // ⚠️ Covers a THROW, not a read that succeeds and resolves empty. If
      // storage spuriously reports no credential where one exists, this sweeps
      // it. Nothing local can tell that apart from a genuine orphan, so it is a
      // limit rather than a guarantee — do not read the line above as "a repair
      // can never sign anyone out".
      live = await tokenManager.isAuthenticated();
    } catch (error) {
      log.warn('Could not establish whether the stored session is live; leaving it alone', error);
      return null;
    }

    if (live) {
      // A row with no `user` is structurally unusable (copilot#185): every
      // reader refuses it, so the panel shows the sign-in screen while the
      // credential and the broken row sit at rest with nothing to remove them.
      if (authState.user) return authState;
      log.warn('Stored session has no user; clearing it');
    } else {
      log.warn('Stored session has no live credential behind it; clearing it');
    }

    // `runTeardown`, not `clearAllAuthData()`: this already holds the
    // session-write lock, Web Locks are not re-entrant, and the verdict above
    // was formed inside it — there is nothing newer for it to be stale against.
    await this.runTeardown();
    return null;
  }

  /**
   * Map a known-good `authState` to the panel's user shape.
   *
   * Split out of `getCurrentUser()` so a caller that already holds the state —
   * startup, via `reconcileSession()` — does not re-read storage to get it.
   */
  userFromAuthState(authState: AuthState | null): User | null {
    if (!authState) return null;

    // A stored authState with no `user` is structurally invalid — it can only
    // come from a writer that persisted an unvalidated payload. Treat it as "no
    // session" rather than dereferencing it (copilot#185).
    if (!authState.user) {
      log.warn('Stored authState has no user; treating as unauthenticated');
      return null;
    }

    return {
      user_id: authState.user.user_id,
      username: authState.user.username,
      email: authState.user.email,
      display_name: authState.user.display_name,
      is_dev_user: authState.user.is_dev_user,
      is_active: authState.user.is_active,
      roles: authState.user.roles || []
    };
  }

  async isAuthenticated(): Promise<boolean> {
    const authState = await this.getAuthState();
    // Must agree with getCurrentUser(): a stored authState with no `user` is
    // not a usable session. Returning true here while getCurrentUser() returns
    // null puts the store in {isAuthenticated: true, currentUser: null}, and
    // SidePanelApp gates only on isAuthenticated — so the signed-in UI renders
    // with no identity and the login prompt never appears (copilot#185).
    return authState !== null && !!authState.user;
  }

  /**
   * Get current authenticated user with roles
   * @returns User object or null if not authenticated
   */
  async getCurrentUser(): Promise<User | null> {
    return this.userFromAuthState(await this.getAuthState());
  }
}

// Global auth manager instance
export const authManager = new AuthManager();
