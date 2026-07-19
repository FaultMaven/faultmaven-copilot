import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { logoutAuth, authManager, User } from '../../../lib/api';
import { createLogger } from '../../../lib/utils/logger';
import { hasRole, isAdmin } from '../../../lib/utils/roles';
import { EventBus, AuthStateChangedEvent } from '../../../lib/utils/messaging';
import { bumpEpoch } from '../session-epoch';

const log = createLogger('AuthSlice');

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

export const createAuthSlice: StateCreator<any, [], [], AuthSlice> = (set, get) => {
  let unsubscribeEventBus: (() => void) | null = null;
  let handleStorageChange: ((changes: any) => void) | null = null;

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
            set({
              isAuthenticated: event.authState.isAuthenticated,
              currentUser: event.authState.user,
              authError: null
            });
          }
        });
      }

      // 3. Set up Storage listener (if not already set up)
      if (!handleStorageChange) {
        handleStorageChange = (changes: any) => {
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
