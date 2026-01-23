/**
 * TokenManager
 *
 * Handles OAuth token lifecycle including automatic refresh before expiry.
 * Ensures only one refresh happens at a time using a refresh promise.
 *
 * Manifest V3 Service Worker Safe:
 * - Fetches tokens from chrome.storage.local on every call
 * - No in-memory state that would be lost on worker restart
 */

import { browser } from 'wxt/browser';
import config from '../../config';
import { createLogger } from '../utils/logger';

const log = createLogger('TokenManager');

interface StoredTokens {
  access_token: string;
  token_type: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  session_id: string;
  user: any;
}

export class TokenManager {
  private refreshPromise: Promise<void> | null = null;

  /**
   * Get a valid access token, auto-refreshing if needed.
   * This is the main entry point for getting tokens.
   *
   * @returns Valid access token or null if not authenticated
   */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.getStoredTokens();

    if (!tokens) {
      log.debug('No tokens stored');
      return null;
    }

    // Check if access token is expired or expiring soon (< 5 minutes)
    const now = Date.now();
    const timeUntilExpiry = tokens.expires_at - now;
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (timeUntilExpiry > FIVE_MINUTES) {
      // Token is still valid
      return tokens.access_token;
    }

    log.info('Access token expired or expiring soon, refreshing...');

    // Check if refresh token is expired
    if (tokens.refresh_expires_at <= now) {
      log.warn('Refresh token expired, user must re-authenticate');
      await this.clearTokens();
      return null;
    }

    // Refresh the token
    await this.refreshAccessToken();

    // Get the new token
    const newTokens = await this.getStoredTokens();
    return newTokens?.access_token || null;
  }

  /**
   * Refresh the access token using the refresh token.
   * Only one refresh happens at a time (deduplication).
   */
  private async refreshAccessToken(): Promise<void> {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) {
      log.debug('Refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token refresh.
   */
  private async performRefresh(): Promise<void> {
    const tokens = await this.getStoredTokens();

    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    log.info('Refreshing access token...');

    try {
      const apiUrl = await config.getApiUrl();
      const response = await fetch(`${apiUrl}/auth/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: 'faultmaven-copilot'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
      }

      const newTokens = await response.json();

      // Store new tokens (refresh token is rotated)
      await browser.storage.local.set({
        access_token: newTokens.access_token,
        token_type: newTokens.token_type,
        expires_at: Date.now() + (newTokens.expires_in * 1000),
        refresh_token: newTokens.refresh_token,
        refresh_expires_at: Date.now() + (newTokens.refresh_expires_in * 1000),
        // Keep existing session_id and user
        session_id: tokens.session_id,
        user: tokens.user
      });

      log.info('Access token refreshed successfully');
    } catch (error: any) {
      log.error('Token refresh failed:', error);

      // If refresh fails, clear tokens
      await this.clearTokens();

      throw error;
    }
  }

  /**
   * Get tokens from storage.
   * Manifest V3 Service Worker safe - fetches from storage every time.
   */
  private async getStoredTokens(): Promise<StoredTokens | null> {
    const storage = await browser.storage.local.get([
      'access_token',
      'token_type',
      'expires_at',
      'refresh_token',
      'refresh_expires_at',
      'session_id',
      'user'
    ]);

    if (!storage.access_token) {
      return null;
    }

    return storage as StoredTokens;
  }

  /**
   * Clear all tokens from storage.
   */
  async clearTokens(): Promise<void> {
    log.info('Clearing all tokens');
    await browser.storage.local.remove([
      'access_token',
      'token_type',
      'expires_at',
      'refresh_token',
      'refresh_expires_at'
    ]);
  }

  /**
   * Check if user is authenticated (has valid tokens).
   */
  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.getStoredTokens();

    if (!tokens) {
      return false;
    }

    // Check if refresh token is still valid
    return tokens.refresh_expires_at > Date.now();
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
