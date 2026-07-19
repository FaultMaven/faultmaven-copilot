import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { logoutAuth, authManager, User } from '../../../lib/api';
import { createLogger } from '../../../lib/utils/logger';
import { hasRole, isAdmin } from '../../../lib/utils/roles';
import { EventBus, AuthStateChangedEvent } from '../../../lib/utils/messaging';
import { bumpEpoch, markSessionEnding } from '../session-epoch';
import type { StoreState } from '../store';

// Shape of the browser.storage.onChanged payload we consume (a subset of the
// full listener signature — we only read newValue/oldValue for the authState key).
type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>;

const log = createLogger('AuthSlice');

/**
 * Decide whether an incoming authenticated `auth_state_changed` broadcast requires
 * the panel to reload so it re-hydrates from freshly identity-scoped storage.
 *
 * A login/identity-switch performed in ANOTHER context (dashboard bridge or
 * background OAuth/local) reaches an open panel only as this broadcast — it does
 * not run the panel-login reload (`handleAuthSuccess`). We reload when the broadcast:
 *
 * - ESTABLISHES an identity into a not-yet-authenticated panel (`!wasAuthenticated`).
 *   `AuthScreen` also reloads on this broadcast, but ONLY while it is mounted — not
 *   during the pre-AuthScreen window (capabilities init / `LoadingScreen`), where a
 *   prior user's at-rest residue could already be hydrated into memory by
 *   `useDataRecovery`. Handling it here makes the reload independent of AuthScreen's
 *   mount state.
 * - SWITCHES identity under an already-authenticated panel (a shared-profile A→B
 *   switch), where `AuthScreen` is unmounted and nothing else resets the in-memory
 *   case-state slices.
 *
 * In both cases, without a reload the prior/other user's conversations/titles/active
 * case would be shown to the new user AND re-persisted on the next store write,
 * reversing the background's `enforceUserDataScope` purge (#164). Same-user
 * re-broadcasts (e.g. token refresh) never reload.
 *
 * `enforceUserDataScope` runs before the broadcast, so storage is already clean by
 * the time the panel reloads. The listener also calls `markSessionEnding()` before
 * reloading so the store's `beforeunload` handler cancels (rather than flushes) the
 * pending debounced persist — otherwise that flush would write the prior user's
 * snapshotted residue back over the purge.
 */
export function shouldReloadOnAuthBroadcast(
  wasAuthenticated: boolean,
  priorUserId: string | undefined,
  nextAuthState: { isAuthenticated?: boolean; user?: { user_id?: string } } | null | undefined
): boolean {
  if (!nextAuthState?.isAuthenticated) return false;
  const nextUserId = nextAuthState.user?.user_id;
  if (!nextUserId) return false;
  return !wasAuthenticated || nextUserId !== priorUserId;
}

export interface AuthSlice {
  isAuthenticated: boolean;
  currentUser: User | null;
  loggingIn: boolean;
  authError: string | null;

  // Actions
  initializeAuth: () => Promise<void>;
  logout: () => Promise<void>;
  checkRole: (role: string) => boolean;
  checkIsAdmin: () => boolean;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => {
  let unsubscribeEventBus: (() => void) | null = null;
  let handleStorageChange: ((changes: StorageChanges) => void) | null = null;

  return {
    isAuthenticated: false,
    currentUser: null,
    loggingIn: false,
    authError: null,

    initializeAuth: async () => {
      // 1. Initial auth check
      try {
        const isAuth = await authManager.isAuthenticated();
        const user = await authManager.getCurrentUser();
        set({ isAuthenticated: isAuth, currentUser: user });
        log.debug('Auth status checked', { isAuthenticated: isAuth, user });
      } catch (error) {
        log.error('Auth check failed', error);
      }

      // 2. Set up EventBus listener (if not already set up)
      if (!unsubscribeEventBus) {
        unsubscribeEventBus = EventBus.on<AuthStateChangedEvent>('auth_state_changed', (event) => {
          // Any broadcast that says "no longer authenticated" ends this context's
          // session. Bump the epoch FIRST (before the set() below) so an in-flight
          // sidepanel writer whose continuation is already queued sees the moved
          // epoch and skips its post-await writes. Covers a hard 401 whose
          // handleAuthError ran in the background context (a different module
          // epoch), bridged here via the broadcast.
          if (!event.authState || !event.authState.isAuthenticated) {
            bumpEpoch();
          }

          if (!event.authState) {
            log.warn('Auth state cleared via EventBus - logging out user');
            set({
              isAuthenticated: false,
              currentUser: null,
              loggingIn: false,
              authError: 'Your session has expired. Please log in again.'
            });
          } else {
            const wasAuthenticated = get().isAuthenticated;
            const priorUserId = get().currentUser?.user_id;

            set({
              isAuthenticated: event.authState.isAuthenticated,
              currentUser: event.authState.user,
              authError: null
            });

            // An externally-broadcast login/identity-switch can leave a prior user's
            // case-state slices in memory (already hydrated by useDataRecovery, or
            // held from a previous authenticated session). Reload so the panel
            // re-hydrates from the storage the background already identity-scoped,
            // instead of showing and re-persisting the prior user's data (#164).
            //
            // markSessionEnding() BEFORE the reload so the store's beforeunload
            // handler CANCELS (not flushes) the pending debounced persist — a flush
            // would write the prior user's snapshotted residue back to storage after
            // the purge and re-home it under the new owner.
            if (
              shouldReloadOnAuthBroadcast(wasAuthenticated, priorUserId, event.authState) &&
              typeof window !== 'undefined'
            ) {
              log.warn('Auth identity established/switched via broadcast — reloading to re-scope in-memory state', {
                wasAuthenticated,
                priorUserId,
                nextUserId: event.authState.user?.user_id
              });
              markSessionEnding();
              window.location.reload();
            }
          }
        });
      }

      // 3. Set up Storage listener (if not already set up)
      if (!handleStorageChange) {
        handleStorageChange = (changes: StorageChanges) => {
          if (changes.authState && !changes.authState.newValue && changes.authState.oldValue) {
            // The authState key was cleared underneath us (logout / hard 401 in
            // another context). Fence the session before reacting so in-flight
            // writers' post-await writes are discarded.
            bumpEpoch();
            log.warn('Auth state cleared via Storage - logging out user');
            set({
              isAuthenticated: false,
              currentUser: null,
              loggingIn: false,
              authError: 'Your session has expired. Please log in again.'
            });
          }
        };

        if (typeof browser !== 'undefined' && browser.storage) {
          browser.storage.onChanged.addListener(handleStorageChange);
        }
      }
    },

    logout: async () => {
      // logoutAuth() ALWAYS destroys the local credential in its finally (tokens
      // cleared); a failed /auth/logout POST (offline / 401) only means the
      // best-effort server-side revocation didn't land. So logout always succeeds
      // LOCALLY — flip to logged-out and broadcast regardless, and never rethrow.
      // Rethrowing before left the app half-logged-out (tokens gone but
      // isAuthenticated still true, no broadcast) AND skipped the caller's local
      // data purge, leaking the prior user's conversations into storage (#143).
      try {
        log.info('Attempting logout');
        await logoutAuth();
        log.info('Logout successful');
      } catch (error) {
        log.warn('Backend logout failed; completing local logout anyway', error);
      } finally {
        set({
          isAuthenticated: false,
          currentUser: null,
          loggingIn: false,
          authError: null
        });

        EventBus.emit({
          type: 'auth_state_changed',
          authState: null
        });
      }
    },

    checkRole: (role) => {
      return hasRole(get().currentUser, role);
    },

    checkIsAdmin: () => {
      return isAdmin(get().currentUser);
    }
  };
};
