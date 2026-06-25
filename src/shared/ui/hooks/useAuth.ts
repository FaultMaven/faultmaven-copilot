/**
 * Authentication Hook
 *
 * Manages authentication state and operations using the centralized Zustand store.
 */

import { useEffect } from 'react';
import { useAppStore } from '../../../lib/state/store';

export function useAuth() {
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const currentUser = useAppStore((state) => state.currentUser);
  const loginUsername = useAppStore((state) => state.loginUsername);
  const loggingIn = useAppStore((state) => state.loggingIn);
  const error = useAppStore((state) => state.authError);

  const login = useAppStore((state) => state.login);
  const logout = useAppStore((state) => state.logout);
  const setLoginUsername = useAppStore((state) => state.setLoginUsername);
  const clearAuthError = useAppStore((state) => state.clearAuthError);
  const checkRole = useAppStore((state) => state.checkRole);
  const checkIsAdmin = useAppStore((state) => state.checkIsAdmin);
  const initializeAuth = useAppStore((state) => state.initializeAuth);

  // Initialize auth listeners and check status on mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return {
    isAuthenticated,
    currentUser,
    loginUsername,
    loggingIn,
    error: error || null,
    login,
    logout,
    setLoginUsername,
    clearAuthError,
    hasRole: checkRole,
    isAdmin: checkIsAdmin
  };
}
