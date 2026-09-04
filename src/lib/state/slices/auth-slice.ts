import { StateCreator } from 'zustand';
import { createLogger } from '../../../lib/utils/logger';
import { bumpEpoch, markSessionEnding } from '../session-epoch';
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
  const signOutLocally = () => {
    // Bump the epoch FIRST, before the set() below, so an in-flight writer whose
    // continuation is already queued sees the moved epoch and skips its
    // post-await writes. Covers a hard 401 whose teardown ran in the background
    // context (a different module epoch) and reached us as a notification.
    bumpEpoch();
    set({ currentUser: null });
  };

  return {
    currentUser: null,

    setSignedInUser: (user) => {
      if (!user) {
        signOutLocally();
        return;
      }
      set({ currentUser: user });
    },

    applyHostAuthState: (user) => {
      if (!user) {
        log.warn('Auth state cleared by the host - signing out');
        signOutLocally();
        return;
      }

      const priorUser = get().currentUser;
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
