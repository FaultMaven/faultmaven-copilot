import { StateCreator } from 'zustand';
import { createLogger } from '../../../lib/utils/logger';
import { bumpEpoch, clearSessionEnding, markSessionEnding } from '../session-epoch';
import { PersistenceManager } from '../../utils/persistence-manager';
import { clearPersistedSession } from '../../api/session-core';
import { clientSessionManager } from '../../session/client-session-manager';
import { idMappingManager, pendingOpsManager } from '../../optimistic';
import type { StoreState } from '../store';
import type { HostUser } from '../../../shared/host';

const log = createLogger('AuthSlice');

/**
 * Decide whether an incoming authenticated auth-state change requires the panel
 * to reload so it re-hydrates from freshly identity-scoped storage.
 *
 * A login or identity switch performed in ANOTHER context reaches an open panel
 * only as this notification. We reload when it:
 *
 * - ESTABLISHES an identity where there was none, which is the pre-panel window
 *   the extension's own sign-in screen cannot cover, because it is not mounted
 *   during startup;
 * - SWITCHES identity under an already-signed-in panel (a shared-profile A→B
 *   switch), where nothing else resets the in-memory case-state slices.
 *
 * In both cases, without a reload the prior user's conversations / titles /
 * active case would be shown to the new user AND re-persisted on the next store
 * write, reversing the identity purge that ran before the notification (#164).
 * Same-user notifications (e.g. a token refresh) never reload.
 *
 * `markSessionEnding()` runs before the reload so the store's `beforeunload`
 * handler CANCELS (rather than flushes) the pending debounced persist —
 * otherwise that flush would write the prior user's snapshotted residue back
 * over the purge.
 */
export function shouldReloadOnAuthChange(
  priorUser: HostUser | null,
  nextUser: HostUser | null,
): boolean {
  if (!nextUser) return false;
  return !priorUser || priorUser.id !== nextUser.id;
}

export interface AuthSlice {
  /** Who the host says is signed in. `null` means nobody. */
  currentUser: HostUser | null;

  /**
   * The identity as the host established it, without reacting to a change.
   * Used at startup, where there is no prior identity to have changed from.
   */
  setSignedInUser: (user: HostUser | null) => void;
  /**
   * The identity CHANGED somewhere else. Fences the session on a sign-out and
   * reloads on an identity switch; see `shouldReloadOnAuthChange`.
   *
   * The panel wires this to `HostSession.subscribeAuthState`. WHICH mechanisms
   * carry that fact — a runtime broadcast, a storage key being cleared, another
   * tab's auth layer — is the host's business; this slice names none of them,
   * and so names no credential key either.
   */
  applyHostAuthState: (user: HostUser | null) => void;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  /**
   * The session is over. Leave nothing of it behind.
   *
   * This used to bump the epoch and null the identity, and that was enough only
   * because the extension reaches sign-out through a screen that ALSO purges. A
   * host whose sign-out arrives as a notification — the web host's account
   * menu, another tab, a hard 401 — left the previous user's conversations,
   * titles, pins, active case and session id in storage and in memory. The next
   * user hydrated them and sent the previous user's `X-Session-Id`.
   *
   * So the reaction to "nobody is signed in" is now the same teardown the
   * extension's identity-change purge performs, wherever it arrives from.
   */
  const signOutLocally = () => {
    // 1. Fence FIRST, synchronously, before anything awaits: an in-flight writer
    //    whose continuation is already queued sees the moved epoch and skips its
    //    post-await writes rather than repopulating what we are clearing.
    bumpEpoch();

    // 2. A queued debounced persist holds a SNAPSHOT of the pre-purge state and
    //    would write it back AFTER the clear below. The store's own guard skips
    //    it while a session is ending, which is exactly what this is.
    markSessionEnding();

    // 3. In-memory. These are module singletons that outlive a session, so the
    //    previous user's id-mappings and pending operations would otherwise leak
    //    into the next one.
    idMappingManager.clear();
    pendingOpsManager.clear();
    set({
      currentUser: null,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      pendingOperations: {},
      caseEvidence: {},
      pinnedCases: new Set<string>(),
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: true,
    });

    // 4. Persisted, and the heartbeat with it. Each step in its own catch: a
    //    throw in one must not skip the others, which is how a failed backend
    //    call used to leave a full set of local residue behind.
    void (async () => {
      try {
        // Stops the keep-alive interval as well as clearing the session keys.
        await get().clearSession();
      } catch (error) {
        log.warn('Session teardown failed during sign-out; continuing the purge', error);
      }
      try {
        // No `preservePinnedCases`: pins are case ids belonging to the user who
        // just left, so they go with the rest. This is what the extension's
        // identity-change purge does.
        await PersistenceManager.clearAllPersistenceData();
      } catch (error) {
        log.warn('Persistence purge failed during sign-out', error);
      }
      try {
        // Belt and braces on the session keys: `clearSession` above clears them
        // too, and a throw before it got there is the case this covers.
        await clearPersistedSession({ includeClientId: true });
      } catch (error) {
        log.warn('Session-key clear failed during sign-out', error);
      }
      try {
        // A DIFFERENT key from the `clientId` above: this is the one
        // ClientSessionManager owns and PRESENTS to resume a session. Left
        // behind, the next user's first `/sessions` POST offers the previous
        // user's client id and resumes their session.
        await clientSessionManager.clearClientId();
      } catch (error) {
        log.warn('Client-id clear failed during sign-out', error);
      }
      log.info('Signed out: persisted state and in-memory state cleared');
    })();
  };

  return {
    currentUser: null,

    setSignedInUser: (user) => {
      if (!user) {
        signOutLocally();
        return;
      }
      // A session exists again, so persistence is live again. Without this the
      // flag set by the previous sign-out would latch for the life of a page
      // that never reloads, and nothing would be written for the new user.
      clearSessionEnding();
      set({ currentUser: user });
    },

    applyHostAuthState: (user) => {
      if (!user) {
        log.warn('Auth state cleared by the host - signing out');
        signOutLocally();
        return;
      }

      const priorUser = get().currentUser;
      clearSessionEnding();
      set({ currentUser: user });

      if (shouldReloadOnAuthChange(priorUser, user) && typeof window !== 'undefined') {
        log.warn('Identity established or switched elsewhere — reloading to re-scope in-memory state', {
          priorUserId: priorUser?.id,
          nextUserId: user.id,
        });
        markSessionEnding();
        window.location.reload();
      }
    },

  };
};
