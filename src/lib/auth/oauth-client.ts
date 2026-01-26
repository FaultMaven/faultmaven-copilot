/**
 * OAuth Client
 *
 * Wrapper around dashboard-oauth.ts that implements IAuthClient interface.
 * Provides unified API for OAuth authentication flow.
 */

import { browser } from 'wxt/browser';
import { createLogger } from '../utils/logger';
import { initiateDashboardOAuth, cleanupOAuthState } from './dashboard-oauth';
import type { AuthConfig } from './auth-config';
import type { AuthResult } from './local-auth-client';
import { tokenManager } from './token-manager';

const log = createLogger('OAuthClient');

/**
 * OAuth Client
 *
 * Implements IAuthClient interface for OAuth 2.0 authentication.
 * Delegates to Dashboard OAuth flow (dashboard-oauth.ts).
 */
export class OAuthClient {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Initiate OAuth flow by opening Dashboard authorization page
   *
   * Note: This returns immediately with pending status.
   * The actual authentication completes in the callback handler.
   *
   * @returns Pending authentication result
   */
  async signIn(): Promise<AuthResult> {
    try {
      log.info('Initiating OAuth flow');

      // Generate PKCE parameters and get authorization URL
      const { authorization_url } = await initiateDashboardOAuth();

      // Open Dashboard authorization page in new tab
      await browser.tabs.create({
        url: authorization_url,
        active: true
      });

      log.info('OAuth flow initiated, waiting for user authorization');

      // Return pending result - callback handler will complete authentication
      return {
        success: true,
        error: undefined
      };

    } catch (error: any) {
      log.error('Failed to initiate OAuth flow:', error);

      // Clean up OAuth state on error
      await cleanupOAuthState();

      return {
        success: false,
        error: error.message || 'Failed to initiate OAuth flow'
      };
    }
  }

  /**
   * Sign out and clear OAuth tokens
   */
  async signOut(): Promise<void> {
    try {
      log.info('Signing out (OAuth mode)');

      // Clear tokens using TokenManager
      await tokenManager.clearTokens();

      // Clean up any remaining OAuth state
      await cleanupOAuthState();

      // Broadcast auth state change
      await browser.runtime.sendMessage({
        type: 'auth_state_changed',
        authState: null
      });

      log.info('Sign out complete');

    } catch (error) {
      log.error('Sign out error:', error);
      throw error;
    }
  }

  /**
   * Get current access token (delegates to TokenManager)
   *
   * @returns Access token or null if not authenticated
   */
  async getAccessToken(): Promise<string | null> {
    return tokenManager.getValidAccessToken();
  }
}
