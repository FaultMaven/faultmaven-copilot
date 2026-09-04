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
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const transport = getApiTransport();
  let hasToken = false;
  let hasSession = false;

  try {
    headers['Authorization'] = `Bearer ${await transport.accessToken()}`;
    hasToken = true;
  } catch (error) {
    // See the note above: header-less is the transient path, not an error to
    // surface here.
    log.warn('No access token available - the request goes out unauthenticated', error);
  }

  try {
    const sessionId = await transport.sessionId();
    if (sessionId) {
      headers['X-Session-Id'] = sessionId;
      hasSession = true;
    }
  } catch (error) {
    log.warn('Failed to read the session id', error);
  }

  // One consolidated line: this runs on every request, poll iterations included.
  log.debug('Auth headers prepared', { hasToken, hasSession });
  return headers;
}
