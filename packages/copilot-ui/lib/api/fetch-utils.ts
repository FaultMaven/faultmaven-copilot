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
import { AuthenticationError } from "../errors/types";
import { createLogger } from "../utils/logger";

const log = createLogger('FetchUtils');

/**
 * Authorization + X-Session-Id, where the host can supply them.
 *
 * A MISSING Authorization header is a meaningful state, not a failure to
 * handle: `client.ts` routes a 401 on a header-less request to the transient
 * session path rather than to a hard teardown, which is what stops a blip at
 * the token endpoint from destroying a credential the next request could have
 * used (#99). `accessToken()` throws when the host cannot produce one, so that
 * throw is caught here and turned into exactly that state.
 *
 * ⚠️ WITH ONE EXCEPTION, and it is the whole distinction. A host that throws
 * `AuthenticationError` is not saying "not right now" — it is saying the session
 * is OVER. Swallowing that produced a header-less request whose 401 took the
 * recoverable path: a doomed `POST /sessions` and a "session expired, retrying"
 * where the honest answer is a sign-in prompt. It propagates, so the request is
 * never sent and the caller gets an error whose recovery is `show_modal`.
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
    // See the note above: header-less is the transient path, not an error to
    // surface here.
  // ‼ LOAD-BEARING, and not only here. Contract 7.0.0 closed four session
  // routes that admitted an anonymous caller, and deliberately left
  // `POST /api/v1/sessions` — the mint — open, citing THIS behaviour: the
  // client goes out header-less when the token read stumbles, and `client.ts`
  // treats a 401 on a credential-less request as the RECOVERABLE path and
  // re-mints. Compose the two and requiring auth on the mint is a
  // mint -> 401 -> re-mint loop in the field. The stated order is "client
  // tolerant first, confirmed deployed, server after" (faultmaven #1460).
  //
  // So making this throw, or routing the mint through `authenticatedFetch`,
  // is not a local cleanup: it silently removes the premise blocking a
  // server-side change, and the anonymous-mint surface on self-hosted stays
  // open for exactly as long as this client does not move.
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
