/**
 * The extension's answer to "give me a bearer" — and the one place a dead
 * session is acted on.
 *
 * Lives here rather than inline in `ExtensionApp` because it is a contract two
 * test harnesses also have to model, and they had each grown their own copy:
 * one still carried an `authManager` fallback the real host never had, and both
 * missed the act-site entirely, so the seam this design turns on was verified
 * against a host that did not exist. One implementation, imported by all three.
 */

import { tokenManager } from '../auth/token-manager';
import { authManager } from '../auth/auth-manager';
import { SessionEndedError } from '../auth/session-ended-error';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('SessionCredential');

/**
 * Read a bearer for the shared panel.
 *
 * TokenManager reports; this acts. `null` from it means "nothing usable right
 * now" — transient, so throwing a plain error sends the request out header-less
 * and its 401 takes the recoverable session path (#99). `SessionEndedError`
 * means the chain is definitively dead, and the teardown belongs here rather
 * than inside TokenManager, where it ran inside the refresh lock and inside the
 * refresh verdict.
 *
 * `clearAllAuthData()` single-flights and never rejects, so N requests learning
 * the chain is dead at once produce one teardown, and a storage failure can
 * never replace the verdict rethrown below.
 *
 * Throws rather than resolving null: a null would put the panel back in the
 * business of deciding what an absent credential means, which is the decision
 * this boundary exists to keep on the host's side.
 */
export async function readSessionAccessToken(): Promise<string> {
  try {
    const token = await tokenManager.getValidAccessToken();
    if (!token) throw new Error('No access token available right now.');
    return token;
  } catch (error) {
    if (error instanceof SessionEndedError) {
      // Guarded even though `clearAllAuthData()` is contracted not to reject:
      // an unguarded await inside this catch throws a storage error out of here
      // instead of the verdict, and losing the verdict loses the reason.
      //
      // The rethrow is load-bearing: `SessionEndedError` extends the package's
      // `AuthenticationError`, which `getAuthHeaders` propagates instead of
      // swallowing. So the request is never sent and the caller gets an error
      // whose recovery is a sign-in prompt — where swallowing it produced a
      // header-less request, a doomed `POST /sessions`, and "session expired,
      // retrying" for a session that is not coming back.
      try {
        await authManager.clearAllAuthData();
      } catch (teardownError) {
        log.error('Teardown after a session verdict failed', teardownError);
      }
    }
    throw error;
  }
}
