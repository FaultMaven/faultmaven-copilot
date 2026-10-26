import { AuthenticationError, NetworkError } from '../errors/types';
import { getApiTransport } from './transport';
import { bumpEpoch } from '../state/session-epoch';
import { createLogger } from '../utils/logger';

const log = createLogger('APIClient');

/**
 * Handles authentication errors and triggers re-authentication.
 *
 * Its own module so the session mint (`client-session-manager.ts`) takes the
 * same verdict as every other route: `client.ts` imports `session-core.ts`,
 * which imports the mint, so the mint cannot import `client.ts`.
 */
export async function handleAuthError(rejectedBearer: string): Promise<'refreshed' | 'ended'> {
  // The epoch moves only when the session ENDS — below, on 'ended', never
  // before the host has answered. A 401 is not yet a verdict: the host may
  // hold a newer credential for the same session ('refreshed'), and bumping
  // here then discarded that session's own in-flight writes — an optimistic
  // case never reconciled, a turn's result dropped — for a session that
  // carried on (copilot#346 review).
  //
  // What the early bump used to fence — writers landing while the host tears
  // down — belongs to the user being signed out, and the purge that follows
  // removes it: on 'ended' the session's `authState` goes, the panel hears
  // it through `subscribeAuthState`, and `signOutLocally` fences (bumps the
  // epoch, fences the case slot) and purges memory and storage after them.

  // A hard 401 means the credential itself is no longer valid. This module used
  // to clear the token keys here. It does not any more, and the change is the
  // point: it holds no refresh token and cannot mint one, so tearing down a
  // credential it does not own was it acting on someone else's behalf with none
  // of the context — no knowledge of an in-flight rotation, no access to the
  // lock serialising one. It reports, and the host decides.
  const outcome = await getApiTransport().onUnauthorized(rejectedBearer);

  // The host renewed the credential and kept the session. Say so, and let the
  // caller retry: throwing here regardless is what put a blocking "session
  // expired" modal in front of a user whose session had just been renewed.
  if (outcome === 'refreshed') {
    log.info('Host refreshed the credential after a 401; retrying once');
    return 'refreshed';
  }

  // The host could not renew the credential right now and the session goes
  // on (faultmaven#1460). Not a sign-out, so the epoch stays; not a retry,
  // since there is no newer credential. The existing NetworkError, carrying
  // the 401 it was: a received status, so `isAmbiguousFailure` reads a failed
  // turn as not added rather than "may not have been added".
  if (outcome === 'unavailable') {
    log.warn('Host could not renew the credential after a 401; the session continues');
    const refused = Object.assign(new Error('HTTP 401'), { status: 401 });
    throw new NetworkError('The credential could not be renewed right now', refused);
  }

  // Ended. Fence THIS context's in-flight writers now, before the purge
  // notification arrives: their continuations must not land for a session the
  // host has just ended. `signOutLocally` bumps again when it runs; a second
  // bump is harmless.
  bumpEpoch();

  // Trigger re-authentication flow
  // This will be handled by the UI components
  throw new AuthenticationError('Authentication required - please sign in again');
}
