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
  /** Origin the API lives at, e.g. `https://api.faultmaven.ai`. No trailing slash. */
  baseUrl(): Promise<string>;
  /** A currently-valid bearer. Throws when the session has ended. */
  accessToken(): Promise<string>;
  /** The FaultMaven session id for `X-Session-Id`, or null before one exists. */
  sessionId(): Promise<string | null>;
  /**
   * Discard the stored FaultMaven session so the next request mints a fresh one.
   *
   * Clearing only — there is deliberately no setter. The session is CREATED by
   * `session-core`, and a second writer for the same key is the shape this
   * migration exists to retire.
   */
  clearSession(): Promise<void>;
  /**
   * The API rejected our credential. The host decides what that means.
   *
   * Awaited by the caller: the teardown this replaced completed before the
   * error was thrown, and a fire-and-forget clear would race the next request
   * into reading a credential that was on its way out.
   */
  onUnauthorized(): void | Promise<void>;
}

let transport: ApiTransport | null = null;

/** Install the host's transport. Called once, above the shared UI. */
export function setApiTransport(next: ApiTransport): void {
  transport = next;
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
