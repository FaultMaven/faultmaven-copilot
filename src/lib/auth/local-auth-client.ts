/**
 * Local Auth Client
 *
 * Implements direct authentication for AUTH_MODE=local deployments.
 * Calls /api/v1/auth/login and /api/v1/auth/register directly without OAuth flow.
 *
 * Token storage matches OAuthClient pattern for TokenManager compatibility.
 */

import { browser } from 'wxt/browser';
import { getApiUrl } from '../../config';
import { createLogger } from '../utils/logger';
import { clientSessionManager } from '../session/client-session-manager';
import type { AuthTokenResponse, APIError } from '../api/types';

const log = createLogger('LocalAuthClient');

/**
 * Login credentials for local mode
 */
export interface LocalLoginCredentials {
  username: string;
  password?: string; // Optional per IAM design
  email?: string;
  display_name?: string;
}

/**
 * Registration request for local mode
 */
export interface LocalRegisterRequest {
  username: string;
  email: string;
  display_name: string;
  password?: string; // Optional per IAM design
}

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  user?: any;
  error?: string;
}

/**
 * Local Auth Client
 *
 * Provides direct username/password authentication for self-hosted deployments.
 */
export class LocalAuthClient {
  /**
   * Sign in with username and optional password
   *
   * @param credentials - Username and optional password
   * @returns Authentication result
   */
  async signIn(credentials: LocalLoginCredentials): Promise<AuthResult> {
    try {
      log.info('Initiating local auth login', { username: credentials.username });

      const apiUrl = await getApiUrl();
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password || undefined,
          email: credentials.email || undefined,
          display_name: credentials.display_name || undefined
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData: APIError = await response.json().catch(() => ({
          detail: 'Login failed'
        }));

        log.error('Login failed', {
          status: response.status,
          error: errorData.detail
        });

        return {
          success: false,
          error: errorData.detail || `Login failed: ${response.status}`
        };
      }

      const tokenResponse: AuthTokenResponse = await response.json();

      // Store tokens in chrome.storage.local (same format as OAuth)
      await this.storeTokens(tokenResponse);

      log.info('Local auth login successful', {
        user_id: tokenResponse.user.user_id
      });

      // Broadcast auth state change
      await this.broadcastAuthStateChange();

      return {
        success: true,
        user: tokenResponse.user
      };

    } catch (error: any) {
      log.error('Login error:', error);

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          error: 'Unable to connect to server. Please check your connection.'
        };
      }

      return {
        success: false,
        error: error.message || 'Login failed'
      };
    }
  }

  /**
   * Register a new user account (local mode only)
   *
   * @param request - Registration details
   * @returns Authentication result
   */
  async register(request: LocalRegisterRequest): Promise<AuthResult> {
    try {
      log.info('Initiating local auth registration', { username: request.username });

      const apiUrl = await getApiUrl();
      const response = await fetch(`${apiUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: request.username,
          email: request.email,
          display_name: request.display_name,
          password: request.password || undefined
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData: APIError = await response.json().catch(() => ({
          detail: 'Registration failed'
        }));

        log.error('Registration failed', {
          status: response.status,
          error: errorData.detail
        });

        return {
          success: false,
          error: errorData.detail || `Registration failed: ${response.status}`
        };
      }

      const tokenResponse: AuthTokenResponse = await response.json();

      // Store tokens in chrome.storage.local
      await this.storeTokens(tokenResponse);

      log.info('Local auth registration successful', {
        user_id: tokenResponse.user.user_id
      });

      // Broadcast auth state change
      await this.broadcastAuthStateChange();

      return {
        success: true,
        user: tokenResponse.user
      };

    } catch (error: any) {
      log.error('Registration error:', error);

      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          error: 'Unable to connect to server. Please check your connection.'
        };
      }

      return {
        success: false,
        error: error.message || 'Registration failed'
      };
    }
  }

  /**
   * Sign out and clear tokens
   */
  async signOut(): Promise<void> {
    try {
      log.info('Signing out');

      const apiUrl = await getApiUrl();

      // Call logout endpoint (best effort - don't block on errors)
      try {
        await fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (error) {
        log.warn('Logout API call failed (non-critical):', error);
      }

      // Clear tokens from storage
      await this.clearTokens();

      // Broadcast auth state change
      await this.broadcastAuthStateChange();

      log.info('Sign out complete');

    } catch (error) {
      log.error('Sign out error:', error);
      throw error;
    }
  }

  /**
   * Get current access token (for compatibility with IAuthClient interface)
   *
   * @returns Access token or null if not authenticated
   */
  async getAccessToken(): Promise<string | null> {
    const storage = await browser.storage.local.get(['access_token']);
    return storage.access_token || null;
  }

  /**
   * Store authentication tokens in chrome.storage.local
   *
   * Uses same storage keys as OAuthClient for TokenManager compatibility.
   * Also stores composite authState object for authManager compatibility.
   *
   * IMPORTANT: Clears old troubleshooting session to force fresh session creation
   * with the newly authenticated user.
   */
  private async storeTokens(tokenResponse: AuthTokenResponse): Promise<void> {
    const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);

    // Clear old troubleshooting session so a fresh one is created with the authenticated user
    // This clears BOTH in-memory cache AND storage - critical because ClientSessionManager
    // caches the clientId in memory, so just clearing storage is not enough
    await clientSessionManager.clearClientId();
    await browser.storage.local.remove(['sessionId']);
    log.info('Cleared old session data (clientId + sessionId) for fresh session creation');

    // Store individual keys (for TokenManager compatibility)
    await browser.storage.local.set({
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      expires_at: expiresAt,
      // Local mode tokens don't have refresh tokens by default
      // Backend may add refresh_token support in the future
      refresh_token: (tokenResponse as any).refresh_token || null,
      refresh_expires_at: (tokenResponse as any).refresh_token
        ? Date.now() + ((tokenResponse as any).refresh_expires_in * 1000)
        : null,
      session_id: tokenResponse.session_id,
      user: tokenResponse.user,
      // Store composite authState for authManager compatibility
      authState: {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_at: expiresAt,
        user: tokenResponse.user
      }
    });

    log.debug('Tokens stored in chrome.storage.local');
  }

  /**
   * Clear all authentication tokens from storage
   */
  private async clearTokens(): Promise<void> {
    await browser.storage.local.remove([
      'access_token',
      'token_type',
      'expires_at',
      'refresh_token',
      'refresh_expires_at',
      'session_id',
      'user',
      'authState'
    ]);

    log.debug('Tokens cleared from chrome.storage.local');
  }

  /**
   * Broadcast authentication state change to other parts of extension
   */
  private async broadcastAuthStateChange(): Promise<void> {
    try {
      const storage = await browser.storage.local.get(['user']);

      await browser.runtime.sendMessage({
        type: 'auth_state_changed',
        authState: storage.user || null
      });

      log.debug('Auth state change broadcasted');
    } catch (error) {
      // Ignore messaging errors - not critical
      log.warn('Failed to broadcast auth state change:', error);
    }
  }
}
