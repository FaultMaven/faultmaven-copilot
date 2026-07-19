import { getApiUrl } from "../../../config";
import { getAuthHeaders } from "../fetch-utils";
import { createSession } from "../session-core";
import { createHttpErrorFromResponse } from "../../errors/http-error";
import { fetchWithTimeout } from "../../utils/fetch-timeout";

// Re-export creation function
export { createSession };

export async function heartbeatSession(sessionId: string): Promise<void> {
  // Keep-alive ping. Deliberately does NOT use authenticatedFetch: that wrapper
  // clears auth state (a logout) as a side effect on a 401 BEFORE it throws, so a
  // missed heartbeat during a token/session hiccup would bounce the user to the
  // login screen. Here we attach auth headers directly and surface any failure to
  // the caller (which swallows it) WITHOUT mutating stored auth state.
  const headers = await getAuthHeaders();
  const response = await fetchWithTimeout(`${await getApiUrl()}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers,
    credentials: 'include'
  });
  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }
}
