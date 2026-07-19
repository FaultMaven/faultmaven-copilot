/**
 * User Data Scope
 *
 * Enforces that the conversation / session / case data at rest in
 * browser.storage.local belongs to the currently-authenticated user, purging a
 * prior user's residue when a DIFFERENT user signs in on a shared browser
 * profile (#144).
 *
 * Background: no path compared the authenticated user against persisted data, so
 * a second user's login on a shared profile let `useDataRecovery` hydrate and
 * auto-reselect the first user's case (#130 restore) and the session layer
 * resume the first user's backend session. Only the in-panel logout purged
 * anything, and it doesn't run when a session simply changes hands.
 */

import { browser } from 'wxt/browser';
import { PersistenceManager } from '../utils/persistence-manager';
import { clientSessionManager } from '../session/client-session-manager';
import { createLogger } from '../utils/logger';

const log = createLogger('UserScope');

/**
 * Records which authenticated user owns the at-rest data currently in
 * browser.storage.local. Compared on every login to detect a hand-off to a
 * different user on the same browser profile.
 */
const DATA_OWNER_KEY = 'faultmaven_data_owner_id';

/**
 * Backend-session pointer keys written by the session layer (session-core
 * `persistSession` / background `handleGetSessionId`). On an identity change we
 * cannot ask the backend to delete the PRIOR user's session — their credential
 * is already gone — so we drop the LOCAL pointer, forcing the new user to mint a
 * fresh session instead of resuming the previous user's (`getAuthHeaders` reads
 * `sessionId` for `X-Session-Id`).
 */
const BACKEND_SESSION_KEYS = ['sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId'];

/**
 * Enforce that all at-rest per-user data belongs to `userId`.
 *
 * Records `userId` as the data owner. When storage already records a DIFFERENT
 * owner — a second user signing in on a shared browser profile — purge the prior
 * user's conversations, titles, case pointer, optimistic state, pins, and
 * backend-session pointer (including the in-memory client id used for session
 * resumption) BEFORE the new session hydrates.
 *
 * MUST be called at every identity-establishment write (OAuth callback,
 * dashboard bridge, local login) BEFORE broadcasting auth / reloading the panel,
 * so the subsequent hydrate and session init read clean storage. It never
 * touches the auth/token keys, so a freshly-written credential for the new user
 * survives the purge regardless of call order relative to the token write.
 *
 * No-op on a fresh profile (no prior owner, no residue) or when the owner is
 * unchanged. When at-rest data exists with NO recorded owner — residue from a
 * session established before this scoping shipped — its provenance can't be
 * verified, so it is purged too: the conversation data is recoverable from the
 * backend, so a legitimate owner re-fetches it, while a prior user's residue is
 * safely cleared. Returns true iff a purge ran.
 */
export async function enforceUserDataScope(userId: string | undefined | null): Promise<boolean> {
  if (!userId) {
    // Never record an empty owner: a later real login would read it as the prior
    // owner and either purge spuriously or skip a needed purge.
    log.warn('enforceUserDataScope called without a userId; skipping');
    return false;
  }

  try {
    const stored = await browser.storage.local.get([
      DATA_OWNER_KEY,
      'conversations',
      'faultmaven_current_case'
    ]);
    const priorOwner = stored[DATA_OWNER_KEY];

    // A prior owner that isn't this user → definite hand-off. No recorded owner
    // but at-rest residue present → unverifiable provenance, purge to be safe
    // (closes the one-transition gap for sessions predating this scoping).
    const differentOwner = priorOwner && priorOwner !== userId;
    const unownedResidue =
      !priorOwner &&
      (!!stored.faultmaven_current_case ||
        (stored.conversations && Object.keys(stored.conversations).length > 0));

    if (differentOwner || unownedResidue) {
      log.info('Purging prior/unowned at-rest data on login', {
        reason: differentOwner ? 'identity_change' : 'unowned_residue'
      });
      // Purge conversations / titles / case pointer / optimistic state. Do NOT
      // preserve pins — they are the prior user's case ids.
      await PersistenceManager.clearAllPersistenceData();
      // Drop the backend-session pointer and reset the in-memory client id so the
      // new user gets a fresh session rather than resuming the prior user's.
      await clientSessionManager.clearClientId();
      await browser.storage.local.remove(BACKEND_SESSION_KEYS);
      await browser.storage.local.set({ [DATA_OWNER_KEY]: userId });
      return true;
    }

    // Same user, or first login on this profile: just (re)record ownership.
    await browser.storage.local.set({ [DATA_OWNER_KEY]: userId });
    return false;
  } catch (error) {
    log.error('Failed to enforce user data scope', error);
    return false;
  }
}
