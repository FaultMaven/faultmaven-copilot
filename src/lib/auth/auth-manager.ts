import { browser } from 'wxt/browser';
import { AuthState, User } from '../api/types';
import { createLogger } from '../utils/logger';
import { caseCacheManager } from '../cache/case-cache';
import { tokenManager } from './token-manager';

const log = createLogger('AuthManager');

/**
 * Auth manager for centralized authentication state
 */
class AuthManager {
  async saveAuthState(authState: AuthState): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.set({ authState });
    }
  }

  async getAuthState(): Promise<AuthState | null> {
    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        const result = await browser.storage.local.get(['authState']);
        const authState = result.authState;

        if (!authState) return null;

        // authState.expires_at is the ACCESS-token expiry captured at login — it is
        // NOT the session lifetime. TokenManager refreshes the access token in the
        // background (and keeps this composite in sync on refresh), so a passed
        // expires_at does not mean "logged out". Only end the session when
        // TokenManager has no usable/refreshable token. Deleting authState here on
        // the frozen expiry would fire the storage listener and force a SPURIOUS
        // logout ~1 access-token-lifetime after login despite a valid refresh token.
        if (Date.now() >= authState.expires_at) {
          const stillAuthenticated = await tokenManager.isAuthenticated();
          if (!stillAuthenticated) {
            await this.clearAuthState();
            return null;
          }
        }

        return authState;
      }
    } catch (error) {
      log.warn('Failed to get auth state:', error);
    }
    return null;
  }

  /**
   * Token-PRESERVING teardown: clears only the composite `authState` (and the
   * case cache). Used inside the normal access-token-expiry path, where the
   * `refresh_token` (managed separately by TokenManager) MUST survive so the
   * session can be silently refreshed.
   *
   * Do NOT call this for logout / hard auth failure — see clearAllAuthData().
   */
  async clearAuthState(): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.remove(['authState']);
      // Also clear case cache on logout to prevent data leaks or stale data
      await caseCacheManager.invalidateCache();
    }
  }

  /**
   * Full local auth teardown for logout and hard (401) auth failures: clears the
   * composite `authState` (+ case cache) AND every token key managed by
   * TokenManager (`access_token`, `refresh_token`, `refresh_expires_at`, …).
   *
   * clearAuthState() alone is NOT sufficient for logout: it leaves the token
   * keys in storage, so `getAuthHeaders` keeps attaching a live Bearer and
   * TokenManager will silently re-mint a session from the surviving
   * `refresh_token` — the previous user stays authenticated on a shared machine.
   */
  async clearAllAuthData(): Promise<void> {
    await this.clearAuthState();
    await tokenManager.clearTokens();
  }

  async isAuthenticated(): Promise<boolean> {
    const authState = await this.getAuthState();
    return authState !== null;
  }

  /**
   * Get current authenticated user with roles
   * @returns User object or null if not authenticated
   */
  async getCurrentUser(): Promise<User | null> {
    const authState = await this.getAuthState();
    if (!authState) return null;

    return {
      user_id: authState.user.user_id,
      username: authState.user.username,
      email: authState.user.email,
      display_name: authState.user.display_name,
      is_dev_user: authState.user.is_dev_user,
      is_active: authState.user.is_active,
      roles: authState.user.roles || []
    };
  }
}

// Global auth manager instance
export const authManager = new AuthManager();
