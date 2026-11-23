/**
 * How the API layer reaches the network, supplied by the host.
 *
 * The API functions are free functions — `submitTurn`, `getCaseUI`, dozens more
 * — called from hooks, callbacks and background continuations. They cannot read
 * React context, so the host installs its answers here once and every request
 * uses them.
 *
 * What this removes is not indirection but AUTHORITY. Before it, the client
 * asked `TokenManager` for a bearer, fell back to `AuthManager`, read the
 * session id out of extension storage, and on a hard 401 cleared the credential keys
 * itself. Every one of those is a decision about a credential the shared UI does
 * not own, and each is a place a second host would have had to be taught about.
 * Now the shared UI states what it needs — a base URL, a bearer, a session id —
 * and reports a rejected credential back to whoever issued it.
 *
 * A module singleton, like `authManager` and `tokenManager` before it, and set
 * once at mount. Reads before it is set THROW: an unconfigured transport is a
 * wiring bug, and a request that silently went out unauthenticated — or to the
 * wrong origin — is exactly the failure this file exists to make impossible.
 */

export interface ApiTransport {
  /**
   * ABSOLUTE origin the API lives at, e.g. `https://api.faultmaven.ai`. No
   * trailing slash.
   *
   * Absolute is a requirement, not a convention. Request sites build URLs with
   * `new URL(`${baseUrl}/api/v1/…`)`, which THROWS on a relative value — and a
   * same-origin deployment configures the empty string, which is the most
   * natural way to say "wherever this page is served from". The result was a
   * transcript that rendered empty, a case list that never arrived and a
   * capabilities probe that hit the SPA rewrite and fell back to a fabricated
   * feature set, with nothing thrown where anyone could see it.
   *
   * A host serving the API from its own origin answers `window.location.origin`.
   */
  baseUrl(): Promise<string>;
  /**
   * A currently-valid bearer. A throw says why there is none, and
   * `getAuthHeaders` tells three apart, sending nothing on any of them:
   *
   *   `AuthenticationError`         the session has ended; a sign-in prompt.
   *   `SessionSwitchedError`        the stored session is another user's.
   *   `CredentialUnavailableError`  this user's session is KEPT, or the host
   *                could not read whether it is, but there is no credential
   *                right now (a token expired while its renewal endpoint is
   *                down, or a storage read failed; faultmaven#1460). Nothing
   *                moves the epoch, and the caller sees the `NetworkError`
   *                copy. Each attempt makes one host read and sends no
   *                request: per action, up to `resilientOperation`'s 3
   *                attempts, 1 s and 2 s apart; a keyed turn and its poll,
   *                one per credential wait (5 s doubling to 60 s, ±20 %)
   *                within the turn's deadline, about 14 over the 660 s fallback
   *                with no upload before a 202, about 16 for an outage after one
   *                (the POST, about 13 polls, 2 capped re-sends), about 20 when
   *                the outage spans the 202 (the poll starts its own wait
   *                sequence), about 23 if a capped re-send gets through and is
   *                polled again, about 26 if both do (faultmaven#2348); the
   *                session ensure on its
   *                backoff (15 s doubling to 60 s: at most 3 in its first
   *                minute, then about 1 a minute); the heartbeat one per beat
   *                (10 min). A read costs the host's renewal. The Dashboard's
   *                is one attempt: 3 per action, up to about 26 per keyed
   *                turn over the 660 s fallback with no upload. The extension's
   *                is TokenManager's 3-attempt ladder: 9 refresh POSTs per
   *                action, up to about 78 per keyed turn over that fallback (each
   *                keyed-turn count is one read per credential wait within the
   *                turn's deadline, so another deadline (`deriveTurnTiming`,
   *                lib/utils/turn-timing.ts: a published bound, an upload) fits
   *                more reads or fewer), up to about 2.5 min before the toast
   *                if the endpoint hangs; the ensure about 9 in its first
   *                minute, then about 3 a minute per panel; the heartbeat 3
   *                per beat. A beat not sent refreshes
   *                no server TTL, so a session idle past it (30 min by default)
   *                lapses, and the first beat after the outage answers 404 and
   *                re-ensures at once. A plain throw instead is no cheaper
   *                choice for a kept session: it reads as signed out: the
   *                blocking sign-in modal, with no retry (below).
   *
   * Any other throw means signed out: the request goes out with no bearer,
   * and its 401 is the not-signed-in path, `AuthenticationError`, with nothing
   * cleared and no epoch moved (faultmaven#2167). A host throws
   * `CredentialUnavailableError` for anything transient.
   */
  accessToken(): Promise<string>;
  /** The FaultMaven session id for `X-Session-Id`, or null before one exists. */
  sessionId(): Promise<string | null>;
  /**
   * Discard the stored FaultMaven session.
   *
   * No longer called by the package: a stale session is cleared by
   * `session-core`'s `clearPersistedSessionIf`, under the session lock
   * (faultmaven#1460). Kept until it is retired from the host contract
   * (faultmaven#2166).
   */
  clearSession(): Promise<void>;
  /**
   * The API rejected our credential. The host decides what that means, and
   * SAYS which it decided.
   *
   *   'refreshed'  the SAME session continues — same user — with a newer
   *                credential. The client retries the request once with it and
   *                the user sees nothing, and the session epoch does not move.
   *                Never answer it for a credential that belongs to someone
   *                else: the retry replays a request built for the rejected
   *                session (a turn, a `POST /cases`) into that account.
   *   'ended'      the session is over. The client fences this context's
   *                in-flight writers (moves the epoch) and surfaces it.
   *   'unavailable' the host could not renew the credential NOW and has NOT
   *                ended the session (its renewal answered 5xx, or the browser
   *                is offline). The fetch layer does not retry the request,
   *                the epoch does not move and no sign-out shows: it fails
   *                with `CredentialUnavailableError`, a `NetworkError`
   *                ("Connection Problem", `retry_with_backoff`). The cost is
   *                one renewal per request attempt, times the caller's own
   *                retries: `resilientOperation` within its attempt budget (3
   *                by default, a keyed turn's included), a query's one retry,
   *                and the session ensure on its backoff (15 s doubling to
   *                60 s). The async-turn poll asks once per credential wait
   *                (5 s doubling to 60 s, ±20 %) within its budget: about 13
   *                over 600 s (faultmaven#2348). Nothing is
   *                duplicated: a 401 committed nothing (faultmaven#1460). A
   *                host that cannot tell a transient failure from a
   *                definitive one never answers it.
   *
   * The answer is load-bearing. Without it the client threw
   * `AuthenticationError` after the callback regardless, so a host that
   * successfully refreshed still got a blocking "session expired" modal whose
   * only action wiped the panel while the surrounding app stayed signed in.
   *
   * Awaited: the teardown this replaced completed before the error was thrown,
   * and a fire-and-forget clear would race the next request into reading a
   * credential that was on its way out.
   *
   * `rejectedBearer` is the token the rejected request CARRIED. By the time
   * the 401 is back, the host may already hold a newer credential (a sign-in
   * in the meantime); a host that tears down must tear down this one's
   * session, not that one's (copilot#346). A host with no use for it ignores
   * it.
   */
  onUnauthorized(rejectedBearer: string): AuthOutcome | Promise<AuthOutcome>;
}

/** What the host did about a rejected credential. */
export type AuthOutcome = 'refreshed' | 'ended' | 'unavailable';

let transport: ApiTransport | null = null;

/**
 * Is this a usable origin for building request URLs?
 *
 * `new URL(value)` with no base succeeds only for an absolute URL, which is
 * exactly the property the request sites need.
 */
function isAbsoluteOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Install the host's transport. Called once, above the shared UI.
 *
 * The installed transport is WRAPPED so that `baseUrl()` is checked on every
 * read. Not checked eagerly here, because `baseUrl()` is async: an eager check
 * could only reject a promise nobody awaits, which is an unhandled rejection in
 * one host and a silent no-op in another. Checking at the point of use turns
 * the failure into a thrown error at the request site that caused it, naming
 * the value and the fix.
 */
export function setApiTransport(next: ApiTransport): void {
  transport = {
    ...next,
    async baseUrl() {
      const value = await next.baseUrl();
      if (!isAbsoluteOrigin(value)) {
        throw new Error(
          `The host's apiUrl() returned ${JSON.stringify(value)}, which is not an ` +
            `absolute origin. Request URLs are built with new URL(), which cannot ` +
            `resolve a relative value — a same-origin deployment should answer ` +
            `window.location.origin rather than "" or a path.`,
        );
      }
      return value;
    },
  };
}

/** Test seam: drop the installed transport so a leak between tests is loud. */
export function clearApiTransport(): void {
  transport = null;
}

export function getApiTransport(): ApiTransport {
  if (!transport) {
    throw new Error(
      'No ApiTransport installed. The host must call setApiTransport() before the shared UI issues a request.',
    );
  }
  return transport;
}

/** Whether a transport is installed, for callers that must degrade rather than throw. */
export function hasApiTransport(): boolean {
  return transport !== null;
}
