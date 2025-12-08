import { browser } from 'wxt/browser';
import { AuthState, User } from '../api/types';

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

        // Check if token is expired
        if (Date.now() >= authState.expires_at) {
          await this.clearAuthState();
          return null;
        }

        return authState;
      }
    } catch (error) {
      console.warn('[AuthManager] Failed to get auth state:', error);
    }
    return null;
  }

  async clearAuthState(): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.remove(['authState']);
    }
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
