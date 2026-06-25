import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { devLogin, logoutAuth, authManager, User } from '../../../lib/api';
import { clientSessionManager } from '../../../lib/session/client-session-manager';
import { AuthenticationError } from '../../../lib/errors/types';
import { createLogger } from '../../../lib/utils/logger';
import { hasRole, isAdmin } from '../../../lib/utils/roles';
import { EventBus, AuthStateChangedEvent } from '../../../lib/utils/messaging';

const log = createLogger('AuthSlice');

export interface AuthSlice {
  isAuthenticated: boolean;
  currentUser: User | null;
  loginUsername: string;
  loggingIn: boolean;
  authError: string | null;

  // Actions
  initializeAuth: () => Promise<void>;
  login: (username: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setLoginUsername: (username: string) => void;
  clearAuthError: () => void;
  checkRole: (role: string) => boolean;
  checkIsAdmin: () => boolean;
}

export const createAuthSlice: StateCreator<any, [], [], AuthSlice> = (set, get) => {
  let unsubscribeEventBus: (() => void) | null = null;
  let handleStorageChange: ((changes: any) => void) | null = null;

  return {
    isAuthenticated: false,
    currentUser: null,
    loginUsername: '',
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
          if (!event.authState) {
            log.warn('Auth state cleared via EventBus - logging out user');
            set({
              isAuthenticated: false,
              currentUser: null,
              loginUsername: '',
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
            log.warn('Auth state cleared via Storage - logging out user');
            set({
              isAuthenticated: false,
              currentUser: null,
              loginUsername: '',
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

    login: async (username: string) => {
      set({ loggingIn: true, authError: null });
      try {
        log.info('Attempting login', { username });
        await devLogin(username);

        // Clear old session
        await clientSessionManager.clearClientId();
        await browser.storage.local.remove(['sessionId']);
        log.info('Cleared old session for authenticated user');

        const user = await authManager.getCurrentUser();
        set({
          isAuthenticated: true,
          currentUser: user,
          loginUsername: '',
          loggingIn: false,
          authError: null
        });

        log.info('Login successful', { user });

        EventBus.emit({
          type: 'auth_state_changed',
          authState: { isAuthenticated: true, user }
        });

        return true;
      } catch (error) {
        const errorMessage = error instanceof AuthenticationError
          ? error.message
          : 'Login failed. Please try again.';

        log.error('Login failed', error);
        set({
          loggingIn: false,
          authError: errorMessage
        });
        return false;
      }
    },

    logout: async () => {
      try {
        log.info('Attempting logout');
        await logoutAuth();

        set({
          isAuthenticated: false,
          currentUser: null,
          loginUsername: '',
          loggingIn: false,
          authError: null
        });

        log.info('Logout successful');

        EventBus.emit({
          type: 'auth_state_changed',
          authState: null
        });
      } catch (error) {
        log.error('Logout failed', error);
        throw error;
      }
    },

    setLoginUsername: (username) => set({ loginUsername: username }),
    clearAuthError: () => set({ authError: null }),

    checkRole: (role) => {
      return hasRole(get().currentUser, role);
    },

    checkIsAdmin: () => {
      return isAdmin(get().currentUser);
    }
  };
};
