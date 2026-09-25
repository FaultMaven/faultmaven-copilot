/**
 * TokenManager
 *
 * Handles OAuth token lifecycle including automatic refresh before expiry.
 * Ensures only one refresh happens at a time using a refresh promise.
 *
 * Manifest V3 Service Worker Safe:
 * - Fetches tokens from chrome.storage.local on every call
 * - No in-memory state that would be lost on worker restart
 */

import { browser } from 'wxt/browser';
import { getHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { fetchWithTimeout } from '@faultmaven/copilot-ui/lib/utils/fetch-timeout';
import { retryWithBackoff, isRetryableError } from '@faultmaven/copilot-ui/lib/utils/retry';
import { errorBodyText } from '@faultmaven/copilot-ui/lib/errors/error-body';
import { getAuthConfig } from './auth-config';
import { SessionEndedError } from './session-ended-error';
import { AUTH_STATE_KEY, CREDENTIAL_KEYS, isUsableDuration, timestampOrNull, type CredentialKey } from './storage-keys';

const log = createLogger('TokenManager');

/**
 * What the stored credential is good for, decided ONCE.
 *
 * Every reader used to answer this for itself from the raw keys, and they
 * disagreed: an unmeasurable expiry was "present it and let the backend rule"
 * in one reader and "not valid" in another, and `getAuthState()` escalated the
 * disagreement into a full teardown of a working credential. A discriminated
 * union is not decoration here — it is the only way there stops being a second
 * opinion to have.
 *
 * `refreshable` carries `spendableToken` because the question is genuinely
 * two-dimensional: a refresh can be worth attempting while the access token is
 * still usable if that attempt fails.
 */
export type CredentialState =
  | { kind: 'absent' }
  | { kind: 'usable'; accessToken: string }
  | { kind: 'refreshable'; refreshToken: string; spendableToken: string | null }
  | { kind: 'dead'; reason: string };

interface StoredTokens {
  access_token: string;
  token_type: string;
  /**
   * Optional because storage routinely lacks them: the bridge and local login
   * remove the refresh pair when a response carries none, and `handleStoreAuth`
   * validates only `access_token` and `user.user_id`, so `expires_at` can be
   * absent too. Required typing is what let `tokens.refresh_expires_at <= now`
   * compile. Read them through `timestampOrNull`, never `typeof`.
   */
  //
  // `| null` is not pedantry: Chrome flattens a NaN write to null, and the
  // docblock above names that as a value this really stores. Typing it away
  // would let a future `tokens.expires_at ?? 0` compile and reintroduce exactly
  // the coercion `timestampOrNull` exists to stop.
  expires_at?: number | null;
  refresh_token?: string;
  refresh_expires_at?: number | null;
  session_id: string;
  user: any;
}

export class TokenManager {
  private refreshPromise: Promise<void> | null = null;

  // Refresh resilience (see performRefreshOnce / getValidAccessToken). A
  // transient failure is retried a few times before giving up, and giving up
  // does NOT clear tokens. Retry/backoff is delegated to the shared
  // `retryWithBackoff` util; only the per-attempt HTTP timeout lives here.
  private static readonly REFRESH_MAX_ATTEMPTS = 3;
  private static readonly REFRESH_BACKOFF_MS = 1000; // initial; exponential ×2
  private static readonly REFRESH_TIMEOUT_MS = 15_000;

  /**
   * How much access-token life makes it worth sending a request at all.
   *
   * A token about to expire is not a usable credential: the request goes out
   * with an Authorization header, and a 401 that CARRIES one routes to the hard
   * teardown rather than the transient session path. So near-expiry is worse
   * than no token, which merely goes out header-less and recovers.
   */
  private static readonly USABLE_TOKEN_MARGIN_MS = 5_000;

  /**
   * How much life left makes a token worth refreshing proactively.
   *
   * One constant: `refreshAccessToken`'s post-lock re-check asks the same
   * question, and the two disagreeing would leave a token that `assess()` calls
   * refreshable but the lock calls fresh — a refresh that can never run.
   */
  private static readonly REFRESH_WHEN_WITHIN_MS = 5 * 60 * 1000;

  /**
   * Decide what the stored credential is good for. The ONE place that produces
   * a VERDICT — applies the margin, rules on a missing expiry, weighs
   * refreshability. (The post-lock re-check below reads `expires_at` too, but
   * only to answer "did another context already do this"; it decides nothing.)
   *
   * Pure: it never writes and never tears anything down, so every reader can
   * call it — including the ones whose contract is a question, not an action.
   */
  private async assess(): Promise<CredentialState> {
    const tokens = await this.getStoredTokens();
    if (!tokens) return { kind: 'absent' };

    const now = Date.now();
    const expiry = timestampOrNull(tokens.expires_at);
    const refreshWindow = timestampOrNull(tokens.refresh_expires_at);
    const windowOpen = !(refreshWindow !== null && refreshWindow <= now);
    // PROACTIVE refresh only. A closed window is a reason not to spend the
    // access token's remaining life on a refresh — it is NOT, on its own, a
    // reason to declare the session dead; see the terminal branch below.
    const canRefresh = !!tokens.refresh_token && windowOpen;

    // UNMEASURABLE EXPIRY. Refreshability is decided FIRST, because the two
    // answers here are not the same and getting the order wrong is worse than
    // the coercion bug this replaced.
    //
    //   - With a refresh token: REFRESHABLE. The refresh writes a real
    //     `expires_at`, so the state heals permanently on the next call. Calling
    //     it `usable` instead means no refresh is ever attempted: the stale
    //     token is presented until the backend 401s, and a 401 that carries a
    //     bearer is the HARD teardown — destroying a valid refresh token that
    //     would have renewed the session. The writers below now produce this
    //     shape deliberately (no expiry beats a NaN one), so it must heal.
    //   - Without one: USABLE. We cannot rule on the token and the backend can;
    //     presenting it converges, whereas calling it dead destroys a session
    //     that may be fine.
    if (expiry === null) {
      // PRESENCE, not `canRefresh`. `canRefresh` additionally requires an open
      // window, so a held refresh token past its window fell through to
      // `usable` — the stale token presented forever, no refresh ever
      // attempted, and the first 401 carrying it routing to the HARD teardown
      // that destroys the credential the backend would still have honoured.
      // The terminal branch below already answers `refreshable` for exactly
      // that shape; this early return must not disagree with it.
      return tokens.refresh_token
        ? {
            kind: 'refreshable',
            refreshToken: tokens.refresh_token as string,
            // NOT spendable as a fallback. We cannot say how old this token is,
            // so if the refresh fails, going header-less is right: presenting an
            // unvouchable bearer whose 401 CARRIES a credential routes to the
            // hard teardown — destroying the refresh token that would have
            // renewed the session once the outage ended. `usable` below is the
            // different case: there, header-less is not an option.
            spendableToken: null,
          }
        : { kind: 'usable', accessToken: tokens.access_token };
    }

    if (expiry - now > TokenManager.REFRESH_WHEN_WITHIN_MS) {
      return { kind: 'usable', accessToken: tokens.access_token };
    }

    // Below the margin a token is worth no more than none: the request would go
    // out carrying a bearer, and a 401 that carries one is a hard teardown
    // rather than the recoverable path.
    const spendableToken =
      expiry - now > TokenManager.USABLE_TOKEN_MARGIN_MS ? tokens.access_token : null;

    if (canRefresh) {
      return {
        kind: 'refreshable',
        refreshToken: tokens.refresh_token as string,
        spendableToken,
      };
    }

    // Spend what is left before anything else — we get here inside the
    // proactive-refresh window, not at expiry, so minutes can remain.
    if (spendableToken) return { kind: 'usable', accessToken: spendableToken };

    // Nothing left to present. A refresh token we HOLD is still worth
    // presenting, even past the window we recorded for it: the backend is the
    // authority on its own credential. Declaring death locally here was a hole
    // — a window that lapses while the backend is merely DOWN made `assess()`
    // answer `dead` on every later read, so a session deliberately preserved
    // through the outage was torn down by the very next credential read,
    // including the one inside that request's own recovery path. Presenting it
    // costs one doomed request when the window really has closed, after which
    // `invalid_grant` ends the session for real.
    if (tokens.refresh_token) {
      return { kind: 'refreshable', refreshToken: tokens.refresh_token, spendableToken: null };
    }

    // The only death this side can declare: nothing to present, and nothing to
    // present it WITH. Every other verdict belongs to the backend.
    return { kind: 'dead', reason: 'no refresh token and the access token is spent' };
  }

  /**
   * Get a valid access token, auto-refreshing if needed.
   *
   * THREE outcomes, and the distinction between the last two is the point:
   *   - a token           — spend it
   *   - `null`            — nothing usable RIGHT NOW. Transient: the request
   *                         goes out header-less, its 401 routes to the
   *                         recoverable session path, a later call retries (#99)
   *   - SessionEndedError — the chain is definitively dead. The HOST tears down
   *                         (ExtensionApp.accessToken); this class only reports
   *
   * Answering `null` for both of the last two is what once forced the teardown
   * in here, where it ran inside the refresh lock and inside the refresh verdict.
   * Note the host's act-site still sits on logout's own authenticated call —
   * moving the owner does not move the call path; see `logoutAuth`.
   */
  async getValidAccessToken(): Promise<string | null> {
    const state = await this.assess();

    switch (state.kind) {
      case 'absent':
        log.debug('No tokens stored');
        return null;
      case 'usable':
        return state.accessToken;
      case 'dead':
        throw new SessionEndedError(state.reason);
      case 'refreshable':
        break;
    }

    log.info('Access token expired or expiring soon, refreshing...');


    // Backoff sleeps happen HERE, outside the cross-context lock, so a backend
    // outage cannot pin the mutex for the whole ladder.
    try {
      await retryWithBackoff(() => this.refreshAccessToken(), {
        maxAttempts: TokenManager.REFRESH_MAX_ATTEMPTS,
        initialDelay: TokenManager.REFRESH_BACKOFF_MS,
        // A session verdict is never retryable. Saying so explicitly rather than
        // giving the error a fake `.status`: isRetryableError defaults to TRUE
        // for anything without one, so a bare throw would spin the ladder on a
        // revoked credential and then land in the transient arm, preserving the
        // dead chain — the whole failure being fixed.
        shouldRetry: (err) => !(err instanceof SessionEndedError) && isRetryableError(err),
      });
    } catch (error: any) {
      if (error instanceof SessionEndedError) throw error;
      // Non-retryable but not a session verdict (a malformed payload, say) falls
      // through to the shared exit like every other arm: the access token may
      // still have minutes on it, and returning null here would send the request
      // header-less and burn a session round trip for nothing.
      log[isRetryableError(error) ? 'warn' : 'error']('Token refresh failed', error);
    }

    // ONE exit for both outcomes, deliberately. Re-assess rather than reasoning
    // from the pre-flight snapshot: the ladder can burn ~48s, long enough for
    // the token to expire and for another context to rotate it — and the
    // early-return paths inside performRefreshOnce (the backstop, the
    // compare-and-swap decline) resolve without having refreshed anything at
    // all. Whatever is in storage now gets the same margin as everything else.
    const after = await this.assess();
    switch (after.kind) {
      case 'usable':
        return after.accessToken;
      case 'refreshable':
        // Still refreshable and we just failed: spend the token if it is worth
        // spending, otherwise go out header-less and let a later call retry.
        return after.spendableToken;
      case 'dead':
        // Reachable only if the credential vanished mid-flight; a transient
        // failure leaves the refresh token in place, so the re-assessment above
        // answers `refreshable` and returns its (possibly null) spendable token
        // rather than ending anything. That is what makes outage protection
        // DURABLE — an earlier version special-cased it here and the protection
        // lasted exactly one call, because the next read re-derived `dead`.
        throw new SessionEndedError(after.reason);
      case 'absent':
        return null;
    }
  }

  /**
   * Refresh the access token using the refresh token.
   * Uses Web Locks API for cross-context coordination (background + sidepanel).
   * Falls back to in-context deduplication when Web Locks is unavailable.
   */
  private async refreshAccessToken(): Promise<void> {
    // Web Locks API: true cross-context mutex (MV3 service worker + sidepanel)
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(
        'faultmaven-token-refresh',
        { mode: 'exclusive' },
        async () => {
          // Re-check: another context may have refreshed while we waited for the lock
          const tokens = await this.getStoredTokens();
          const lockedExpiry = tokens ? timestampOrNull(tokens.expires_at) : null;
          if (lockedExpiry !== null && lockedExpiry - Date.now() > TokenManager.REFRESH_WHEN_WITHIN_MS) {
            log.debug('Token already refreshed by another context');
            return;
          }
          await this.performRefreshOnce();
        }
      );
    }

    // Fallback: in-context deduplication (single JS context only)
    if (this.refreshPromise) {
      log.debug('Refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefreshOnce();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform ONE token-refresh attempt. Retries/backoff are the caller's job
   * (getValidAccessToken wraps this in retryWithBackoff), so this method holds
   * the cross-context lock for a single network call at most.
   *
   * Failure taxonomy:
   *   DEFINITIVE (4xx except 408/429): the refresh token is genuinely revoked.
   *     Throws SessionEndedError — unless the compare-and-swap finds the chain
   *     has been replaced since this attempt read it, in which case the verdict
   *     belongs to someone else's session and it returns instead.
   *   TRANSIENT (network, timeout, 5xx/429, or a 2xx that isn't a well-formed
   *     token payload): thrown with a retryable `.status` and WITHOUT clearing
   *     anything, so a blip does not bounce the user to the login screen.
   */
  private async performRefreshOnce(): Promise<void> {
    const tokens = await this.getStoredTokens();

    if (!tokens || !tokens.refresh_token) {
      // Backstop, deliberately not a teardown: getValidAccessToken already
      // handled the ordinary no-refresh-token session, so reaching here means a
      // sign-in landed while we queued for the lock. Return so the caller
      // re-reads rather than failing their brand-new session's request.
      log.info('No refresh token by the time the lock was held; leaving the session alone');
      return;
    }

    const apiUrl = await getHostEndpoints().apiUrl();

    // Mode-aware refresh endpoint. Bridge/standalone sessions run in LOCAL mode,
    // where the OAuth token endpoint (/oauth/token) is NOT mounted — refreshing
    // there 404s and forces a re-login. Local mode exposes POST /auth/refresh
    // ({refresh_token} -> {access_token, token_type, expires_in, refresh_token};
    // no refresh_expires_in). OAuth/cloud mode uses the RFC 6749 refresh grant.
    const isLocal = await this.isLocalAuthMode();
    log.info('Refreshing access token...', { mode: isLocal ? 'local' : 'oauth' });

    const { url, body } = isLocal
      ? {
          url: `${apiUrl}/api/v1/auth/refresh`,
          body: { refresh_token: tokens.refresh_token },
        }
      : {
          url: `${apiUrl}/api/v1/auth/oauth/token`,
          body: {
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: 'faultmaven-copilot',
          },
        };

    // Network/timeout errors from fetchWithTimeout propagate as-is; isRetryableError
    // treats TimeoutError/NetworkError (and unknown errors) as retryable.
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      TokenManager.REFRESH_TIMEOUT_MS
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({} as any));
      const err: any = new Error(
        `Token refresh failed: ${errorBodyText(body) || body.error_description || body.error || response.status}`
      );
      err.status = response.status;
      // Definitive (4xx except 408/429) → end the session so the user
      // re-authenticates. Transient (5xx/429/408) → keep tokens; caller retries.
      if (!isRetryableError(err)) {
        // Compare-and-swap: a sign-in completing mid-flight rotates the
        // credential, so this rejection is a verdict on a chain that is no
        // longer ours. Return (not throw) so the caller re-reads and hands back
        // the new token instead of failing the request.
        if (!(await this.credentialStillOurs(tokens.refresh_token))) {
          // RETURN, not throw. Throwing propagates a non-retryable 400 to
          // getValidAccessToken's DEFINITIVE arm, which answers null — so the
          // user who just signed in gets a session-expired on this request
          // while their brand-new credential sits unread in storage. Returning
          // reports success, and the caller re-reads storage and hands back the
          // new access token. Declining the teardown is only half the guard.
          log.info('A newer credential replaced this one mid-refresh; using it instead');
          return;
        }
        throw new SessionEndedError(`refresh rejected with ${response.status}`);
      }
      throw err;
    }

    // Validate the payload BEFORE overwriting good tokens. A 2xx that isn't a
    // well-formed token response (e.g. an ingress interstitial / cached proxy
    // body) must not clobber storage with `access_token: undefined` /
    // `expires_at: NaN`. Treat it as retryable so we retry instead of corrupting.
    // Note: `refresh_expires_in` is OAuth-only — local /auth/refresh omits it, so
    // it is NOT part of the well-formed-payload check.
    const newTokens = await response.json().catch(() => null);
    if (
      !newTokens ||
      typeof newTokens.access_token !== 'string' ||
      typeof newTokens.refresh_token !== 'string' ||
      !isUsableDuration(newTokens.expires_in)
    ) {
      const err: any = new Error('Token refresh returned an invalid token payload');
      err.status = 502; // synthetic, retryable
      throw err;
    }

    // Compare-and-swap, for a worse failure than the rejection path's: every
    // field below comes from the PRE-FLIGHT snapshot — `session_id`, `user`,
    // `authState.user` — so writing after a different user signed in stamps the
    // previous identity over storage their sign-in just re-seeded.
    //
    // ⚠️ NARROWED, NOT CLOSED. This is check-then-act, and the sign-in side
    // holds no lock: `handleStoreAuth`, the OAuth exchange and
    // `LocalAuthClient.storeTokens` all write storage directly. A sign-in
    // landing between this check and the write below still loses. Everything
    // that follows is therefore ONE `set()` — the three separate writes it
    // replaces could interleave with a sign-in and leave the worse split of B's
    // credentials paired with A's `authState`.
    if (!(await this.credentialStillOurs(tokens.refresh_token))) {
      log.info('A newer credential replaced this one mid-refresh; discarding the rotated tokens');
      return;
    }

    const now = Date.now();
    const expiresAt = now + newTokens.expires_in * 1000;
    const rotated: Partial<Record<CredentialKey, any>> & { authState?: any } = {
      access_token: newTokens.access_token,
      token_type: newTokens.token_type,
      expires_at: expiresAt,
      refresh_token: newTokens.refresh_token,
      // Keep existing session_id and user
      session_id: tokens.session_id,
      user: tokens.user,
      // The composite row, kept in sync so authManager's getters do not go
      // stale. NOT request auth — `fetch-utils.ts` reads only
      // `transport.accessToken()` and never mentions authState.
      [AUTH_STATE_KEY]: {
        access_token: newTokens.access_token,
        token_type: newTokens.token_type,
        expires_at: expiresAt,
        user: tokens.user,
      },
    };

    const hasRefreshWindow = isUsableDuration(newTokens.refresh_expires_in);
    if (hasRefreshWindow) {
      rotated.refresh_expires_at = now + newTokens.refresh_expires_in * 1000;
    }

    await browser.storage.local.set(rotated);

    if (!hasRefreshWindow) {
      // Local mode has no refresh expiry. Drop any stale value so it cannot be
      // read as a closed window — after the write, so a failure here cannot
      // leave the new credential unwritten.
      await browser.storage.local.remove(['refresh_expires_at']);
    }

    log.info('Access token refreshed successfully', { mode: isLocal ? 'local' : 'oauth' });
  }

  /**
   * Which refresh endpoint to use. The auth mode is established at login and
   * cached (in-memory + storage, surviving SW restarts), so this is a cheap
   * lookup during refresh. getAuthConfig() has its own fallback ladder
   * (network → last-known-good storage → 'local'), so it effectively never
   * throws; the catch here is a last-resort guard only.
   */
  private async isLocalAuthMode(): Promise<boolean> {
    try {
      const config = await getAuthConfig();
      return config.provider === 'local';
    } catch (error) {
      log.warn('Could not resolve auth mode for refresh; defaulting to OAuth', error);
      return false;
    }
  }

  /**
   * Get tokens from storage.
   * Manifest V3 Service Worker safe - fetches from storage every time.
   */
  private async getStoredTokens(): Promise<StoredTokens | null> {
    const storage = await browser.storage.local.get([...CREDENTIAL_KEYS]);

    if (!storage.access_token) {
      return null;
    }

    return storage as StoredTokens;
  }

  /**
   * The stored access token AS-IS — no refresh, no verdict, no teardown.
   *
   * The FALLBACK for callers that must not let a verdict escape. `logoutAuth`
   * asks `getValidAccessToken()` first — so a healthy near-expiry session still
   * refreshes and the sign-out can actually be confirmed — and falls back here
   * when that answers nothing or reports a dead chain. Sending a possibly-expired
   * bearer is fine: server-side logout is best-effort and the local teardown
   * runs regardless.
   */
  async peekAccessToken(): Promise<string | null> {
    const { access_token } = await browser.storage.local.get(['access_token']);
    return typeof access_token === 'string' ? access_token : null;
  }

  /** Is ANY credential key still at rest? Used by the orphan sweep. */
  async hasAnyCredential(): Promise<boolean> {
    const stored = await browser.storage.local.get([...CREDENTIAL_KEYS]);
    return CREDENTIAL_KEYS.some((k) => stored[k] !== undefined);
  }

  /**
   * The one place the refresh token is read from storage on its own. Array
   * form, like getStoredTokens: a bare string returns `{}` against the storage
   * adapters used elsewhere, which would silently disable the compare-and-swap.
   */
  async getRefreshToken(): Promise<string | null> {
    const { refresh_token } = await browser.storage.local.get(['refresh_token']);
    return typeof refresh_token === 'string' ? refresh_token : null;
  }

  /**
   * Does storage still hold the chain this attempt started on?
   *
   * Compares against absence too: a bridge sign-in with no refresh material
   * removes the key, and `null` is a perfectly good "not ours any more".
   */
  private async credentialStillOurs(presented: string | undefined): Promise<boolean> {
    const current = await this.getRefreshToken();
    return current === (presented ?? null);
  }

  /**
   * Remove the credential keys. Exactly that, and nothing else.
   *
   * ⚠️ Not a teardown: `authManager.clearAllAuthData()` is, and is built out of
   * this. Widening it to cover `authState` would put a second, partial
   * definition beside the real one. See src/extension/auth/CLAUDE.md,
   * "Auth teardown".
   */
  async clearTokens(): Promise<void> {
    log.info('Clearing credential keys');
    await browser.storage.local.remove([...CREDENTIAL_KEYS]);
  }

  /**
   * Is there a session here at all?
   *
   * The same verdict `getValidAccessToken` acts on — which is the point. These
   * two answering independently is how `{access_token, no expires_at, no
   * refresh_token}` came to be "present it" for one and "not valid" for the
   * other, and how `getAuthState()` escalated that into destroying a working
   * credential.
   */
  async isAuthenticated(): Promise<boolean> {
    const state = await this.assess();
    return state.kind === 'usable' || state.kind === 'refreshable';
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
