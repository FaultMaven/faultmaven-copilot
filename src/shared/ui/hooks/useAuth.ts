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
  const loggingIn = useAppStore((state) => state.loggingIn);
  const error = useAppStore((state) => state.authError);

  const logout = useAppStore((state) => state.logout);
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
    loggingIn,
    error: error || null,
    logout,
    hasRole: checkRole,
    isAdmin: checkIsAdmin
  };
}
