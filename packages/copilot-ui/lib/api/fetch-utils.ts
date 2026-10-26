/**
 * Headers every API request carries, sourced from the host.
 *
 * Both used to be decisions this module made for itself: it asked TokenManager
 * for a bearer, fell back to AuthManager when that returned null, and read the
 * session id straight out of extension storage. All three are properties of the
 * host, not of the API layer, and a second host would have had to be taught
 * about each one.
 */
import { getApiTransport } from "./transport";
import { AuthenticationError, CredentialUnavailableError, SessionSwitchedError } from "../errors/types";
import { createLogger } from "../utils/logger";

const log = createLogger('FetchUtils');

/**
 * Authorization + X-Session-Id, where the host can supply them.
 *
 * A MISSING Authorization header means the host could not say why it has no
 * credential: in practice, not signed in. `client.ts` answers a 401 on a
 * header-less request by keeping both the credential and the stored session
 * and minting nothing, rather than by a hard teardown (#99). `accessToken()`
 * throws when the host cannot produce one, and any throw but the three below
 * is caught here and turned into exactly that state.
 *
 * ⚠️ THREE EXCEPTIONS, each a host saying WHY, and each propagates so the
 * request is never sent:
 *
 * - `AuthenticationError`: the session is OVER. Swallowed, it produced a
 *   header-less request whose 401 took the transient path, a "session expired,
 *   retrying" where the honest answer is a sign-in prompt. The caller gets an
 *   error whose recovery is `show_modal`.
 * - `SessionSwitchedError`: the host's stored session is another user's, and
 *   the request, built for the previous one, must not go out at all.
 * - `CredentialUnavailableError`: the session is KEPT, but there is no
 *   credential right now (a token expired while its renewal endpoint is down).
 *   Swallowed, the request went out header-less and its 401 read as an expired
 *   session: "Sign in first" in a host still signed in (faultmaven#1460). The
 *   caller gets a `NetworkError` and retries; the epoch does not move.
 *
 * Opt-in: a host that throws anything else keeps the old behaviour exactly.
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const transport = getApiTransport();
  let bearer: string | null = null;
  let sessionId: string | null = null;

  try {
    bearer = await transport.accessToken();
  } catch (error) {
    // The session is over — not "no token right now". Do not send the request.
    if (error instanceof AuthenticationError) throw error;
    // The stored session is another user's (copilot#350). Not "no token right
    // now" either: header-less, the request would still go out — a
    // `POST /cases` built for the previous user, answered by the session path.
    // It is not sent.
    if (error instanceof SessionSwitchedError) throw error;
    // The session is kept, with no credential right now (faultmaven#1460).
    // Header-less, its 401 would read as an expired session. It is not sent.
    if (error instanceof CredentialUnavailableError) throw error;
    // See the note above: header-less is the not-signed-in path, not an error
    // to surface here.
    //
    // The mint never goes out header-less: `ClientSessionManager.createSession`
    // refuses to send without a bearer, and `client.ts` answers a header-less
    // 401 without clearing the session or minting. That is what lets the
    // server require auth on `POST /api/v1/sessions` (faultmaven#1460) with no
    // mint -> 401 -> re-mint loop. Other requests still go out header-less.
    log.warn('No access token available - the request goes out unauthenticated', error);
  }

  try {
    sessionId = (await transport.sessionId()) ?? null;
  } catch (error) {
    log.warn('Failed to read the session id', error);
  }

  // One consolidated line: this runs on every request, poll iterations included.
  log.debug('Auth headers prepared', { hasToken: !!bearer, hasSession: !!sessionId });
  return assembleAuthHeaders({ bearer, sessionId });
}

/**
 * The header SET, given values that have already been resolved.
 *
 * Split out because `logoutAuth` in the extension deliberately does not go
 * through `getAuthHeaders` — it must swallow a dead-chain verdict rather than
 * act on it, so it sources its own bearer — and was therefore spelling these
 * three names by hand. That is two places that have to agree on what every
 * authenticated request carries, and a fourth header added here would silently
 * miss the logout. Sourcing stays the caller's problem; assembly is one
 * function.
 *
 * `null` is the answer for "the host could not produce one", and an absent
 * Authorization header is a meaningful state — see the note above.
 */
export function assembleAuthHeaders(
  { bearer, sessionId }: { bearer?: string | null; sessionId?: string | null },
): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  // The FaultMaven troubleshooting session this client holds. It lets the
  // server scope the request to that session; it has nothing to do with an
  // identity provider.
  if (sessionId) headers['X-Session-Id'] = sessionId;
  return headers;
}
