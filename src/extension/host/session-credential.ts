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
import { authManager, type TeardownOutcome } from '../auth/auth-manager';
import type { AuthOutcome } from '@faultmaven/copilot-ui/lib/api/transport';
import { SessionEndedError } from '../auth/session-ended-error';
import { SessionSwitchedError } from '@faultmaven/copilot-ui/lib/errors/types';
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
export async function readSessionAccessToken(forUserId: string | null): Promise<string> {
  return readOnce(forUserId, true);
}

/**
 * The credential for a request built for `forUserId`, or a refusal
 * (copilot#350).
 *
 * Another user signing in on this browser profile — the Dashboard bridge, say —
 * lands in storage some milliseconds before the panel hears of it and
 * re-scopes. A request the panel builds in between is still FOR the previous
 * user; handed the new user's bearer, a `POST /cases` would create the previous
 * user's content in the new user's account. So the token is handed out only if
 * the `user` stored beside it — read in the same storage read — is the user the
 * request is for. Otherwise `SessionSwitchedError`: `getAuthHeaders`
 * propagates it, nothing is sent, and NOTHING is torn down — the stored session
 * is the new user's, perfectly good, and the panel applies it when the sign-in's
 * broadcast arrives. A refusal is not a verdict on any credential.
 *
 * Unknown is never the same user (the rule #348's teardown uses): a stored
 * credential that names no user is refused to a panel that has one. Every
 * writer stores `user` beside the token, so this does not happen to a session
 * this extension wrote. `forUserId === null` — a caller acting for no
 * particular user — skips the comparison.
 */
async function readOnce(forUserId: string | null, mayRetry: boolean): Promise<string> {
  try {
    const credential = await tokenManager.getValidCredential();
    if (!credential) throw new Error('No access token available right now.');
    if (forUserId !== null && credential.userId !== forUserId) {
      log.warn('The stored session is not the user this request was built for; not sending it', {
        storedUserKnown: credential.userId !== null,
      });
      throw new SessionSwitchedError();
    }
    return credential.accessToken;
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
      //
      // JUDGED (copilot#346): the verdict is about the credential it was read
      // with, and the user it belonged to. If that user's session now holds a
      // newer credential ('superseded'), this request is answered from it,
      // once. If ANOTHER user's session replaced it ('replaced'), it is left
      // alone and the verdict surfaces: the request was built for the user
      // whose session ended, and sent with the new credential it would land in
      // the new user's account. A second verdict is not retried either.
      let outcome: TeardownOutcome = 'ended';
      try {
        outcome = await authManager.clearAllAuthData({
          accessToken: error.judgedAccessToken,
          userId: error.judgedUserId,
        });
      } catch (teardownError) {
        log.error('Teardown after a session verdict failed', teardownError);
      }
      if (outcome === 'superseded' && mayRetry) return readOnce(forUserId, false);
    }
    throw error;
  }
}

/**
 * The extension's answer to a 401 on a request that carried a credential
 * (`ApiTransport.onUnauthorized`).
 *
 * A teardown, JUDGED against the bearer the rejected request carried and the
 * user the panel built that request for (copilot#346). A 401 arrives a round
 * trip after the token was read, and the stored credential may have changed in
 * that window:
 *
 * - the SAME user's session holds a newer one (a rotation, a re-sign-in): the
 *   teardown stands down and the answer is `'refreshed'`, so the client
 *   retries the request once with it. `'refreshed'` means exactly this — the
 *   same session continuing with a newer credential;
 * - ANOTHER user's session replaced it: the teardown stands down, but the
 *   answer is `'ended'`. Retrying would replay a request built for the first
 *   user — a turn, a `POST /cases` — with the second user's bearer, into the
 *   second user's account. The panel learns of the new identity from the
 *   sign-in itself;
 * - otherwise the judged session is torn down: `'ended'`.
 *
 * `rejectedBearer === null` — a rejection whose bearer the caller cannot name
 * (`HostSession.onUnauthorized()`, which takes none) — tears down
 * unconditionally, as every rejection did before.
 */
export async function endSessionOnRejectedCredential(
  rejectedBearer: string | null,
  requestUserId: string | null,
): Promise<AuthOutcome> {
  const outcome = await authManager.clearAllAuthData(
    rejectedBearer ? { accessToken: rejectedBearer, userId: requestUserId } : undefined,
  );
  return outcome === 'superseded' ? 'refreshed' : 'ended';
}
