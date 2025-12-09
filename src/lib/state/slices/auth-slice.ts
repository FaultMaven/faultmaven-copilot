import { StateCreator } from 'zustand';
import { AuthState, User, authManager, devLogin, logoutAuth } from '../../api';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthSlice');

export interface AuthSlice {
  // State
  isAuthenticated: boolean;
  user: User | null;
  authState: AuthState | null;
  authError: string | null;
  isLoggingIn: boolean;

  // Actions
  checkAuth: () => Promise<boolean>;
  login: (username: string, email?: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  setAuthError: (error: string | null) => void;
  
  // Internal helper to update state from AuthManager
  syncWithAuthManager: () => Promise<void>;
}

export const createAuthSlice: StateCreator<AuthSlice> = (set, get) => ({
  // Initial State
  isAuthenticated: false,
  user: null,
  authState: null,
  authError: null,
  isLoggingIn: false,

  // Actions
  checkAuth: async () => {
    const isAuth = await authManager.isAuthenticated();
    if (isAuth) {
      await get().syncWithAuthManager();
    } else {
      set({ isAuthenticated: false, user: null, authState: null });
    }
    return isAuth;
  },

  login: async (username: string, email?: string, displayName?: string) => {
    set({ isLoggingIn: true, authError: null });
    try {
      await devLogin(username, email, displayName);
      await get().syncWithAuthManager();
    } catch (error: any) {
      set({ 
        authError: error?.message || "Login failed. Please try again.",
        isAuthenticated: false,
        user: null,
        authState: null
      });
      throw error;
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await logoutAuth();
    } catch (error) {
      log.warn('Logout error:', error);
      // Ensure we clear local state even if server logout fails
      await authManager.clearAuthState();
    }
    set({ isAuthenticated: false, user: null, authState: null });
  },

  clearAuthError: () => set({ authError: null }),
  
  setAuthError: (error: string | null) => set({ authError: error }),

  syncWithAuthManager: async () => {
    const authState = await authManager.getAuthState();
    if (authState) {
      // Map AuthState user structure to User interface if needed, 
      // but they seem compatible based on api.ts
      const user: User = {
        user_id: authState.user.user_id,
        username: authState.user.username,
        email: authState.user.email,
        display_name: authState.user.display_name,
        is_dev_user: authState.user.is_dev_user,
        is_active: authState.user.is_active,
        roles: authState.user.roles
      };
      
      set({ 
        isAuthenticated: true, 
        authState,
        user
      });
    } else {
      set({ isAuthenticated: false, user: null, authState: null });
    }
  }
});

