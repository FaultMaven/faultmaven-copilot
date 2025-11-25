/**
 * Authentication Hook
 *
 * Manages authentication state and operations.
 * Extracted from SidePanelApp to reduce component complexity.
 */

import { useState, useEffect, useCallback } from 'react';
import { devLogin, logoutAuth, authManager, User } from '../../../lib/api';
import { AuthenticationError } from '../../../lib/errors/types';
import { createLogger } from '../../../lib/utils/logger';
import { hasRole, isAdmin, ROLES } from '../../../lib/utils/roles';

const log = createLogger('Auth');

interface AuthState {
  isAuthenticated: boolean;
  currentUser: User | null;
  loginUsername: string;
  loggingIn: boolean;
  error: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    currentUser: null,
    loginUsername: '',
    loggingIn: false,
    error: null
  });

  // Check authentication status and load user on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuth = await authManager.isAuthenticated();
        const user = await authManager.getCurrentUser();
        setAuthState(prev => ({
          ...prev,
          isAuthenticated: isAuth,
          currentUser: user
        }));
        log.debug('Auth status checked', { isAuthenticated: isAuth, user });
      } catch (error) {
        log.error('Auth check failed', error);
      }
    };

    checkAuth();
  }, []);

  // Listen for authentication errors from storage changes (when auth state is cleared)
  useEffect(() => {
    const handleStorageChange = (changes: any) => {
      // Check if authState was removed (user logged out or session expired)
      if (changes.authState && !changes.authState.newValue && changes.authState.oldValue) {
        log.warn('Auth state cleared - logging out user');

        setAuthState({
          isAuthenticated: false,
          currentUser: null,
          loginUsername: '',
          loggingIn: false,
          error: 'Your session has expired. Please log in again.'
        });
      }
    };

    // Listen for storage changes
    if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.onChanged.addListener(handleStorageChange);

      return () => {
        browser.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  const login = useCallback(async (username: string) => {
    setAuthState(prev => ({ ...prev, loggingIn: true, error: null }));

    try {
      log.info('Attempting login', { username });
      await devLogin(username);

      // Load user data after successful login
      const user = await authManager.getCurrentUser();

      setAuthState({
        isAuthenticated: true,
        currentUser: user,
        loginUsername: '',
        loggingIn: false,
        error: null
      });

      log.info('Login successful', { user });
      return true;
    } catch (error) {
      const errorMessage = error instanceof AuthenticationError
        ? error.message
        : 'Login failed. Please try again.';

      log.error('Login failed', error);
      setAuthState(prev => ({
        ...prev,
        loggingIn: false,
        error: errorMessage
      }));
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      log.info('Attempting logout');
      await logoutAuth();

      setAuthState({
        isAuthenticated: false,
        currentUser: null,
        loginUsername: '',
        loggingIn: false,
        error: null
      });

      log.info('Logout successful');
    } catch (error) {
      log.error('Logout failed', error);
      throw error;
    }
  }, []);

  const setLoginUsername = useCallback((username: string) => {
    setAuthState(prev => ({ ...prev, loginUsername: username }));
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthState(prev => ({ ...prev, error: null }));
  }, []);

  // Role checking helpers
  const checkRole = useCallback((role: string): boolean => {
    return hasRole(authState.currentUser, role);
  }, [authState.currentUser]);

  const checkIsAdmin = useCallback((): boolean => {
    return isAdmin(authState.currentUser);
  }, [authState.currentUser]);

  return {
    isAuthenticated: authState.isAuthenticated,
    currentUser: authState.currentUser,
    loginUsername: authState.loginUsername,
    loggingIn: authState.loggingIn,
    authError: authState.error,
    login,
    logout,
    setLoginUsername,
    clearAuthError,
    hasRole: checkRole,
    isAdmin: checkIsAdmin,
    ROLES, // Export ROLES constant for convenience
  };
}
