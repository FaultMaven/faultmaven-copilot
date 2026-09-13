import { getApiTransport } from '../transport';
import { getAuthHeaders } from "../fetch-utils";
import { createSession } from "../session-core";
import { createHttpErrorFromResponse } from "../../errors/http-error";
import { fetchWithTimeout } from "../../utils/fetch-timeout";

// Re-export creation function
export { createSession };

export async function heartbeatSession(sessionId: string): Promise<void> {
  // Keep-alive ping. Deliberately does NOT use authenticatedFetch: that wrapper
  // treats a 401 as a hard auth failure, so a missed heartbeat during a
  // token/session hiccup would bounce the user to the login screen. Here we
  // attach auth headers directly and surface any failure to the caller, which
  // swallows it.
  //
  // ⚠️ It is no longer true that this cannot mutate auth state. `getAuthHeaders`
  // asks the HOST for a bearer, and a host may answer that the session is over —
  // the extension's does, and acts on it. That is intended: the distinction that
  // matters is transient vs definitive, not which request noticed. A hiccup
  // still changes nothing; a chain the backend has definitively rejected ends
  // the session, and the heartbeat is as good a place to learn that as any.
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(`${await getApiTransport().baseUrl()}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers,
    credentials: 'include'
  });
  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }
}
