import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tokenManager } from '../../../lib/auth/token-manager';

// Mock browser environment
const { mockBrowserStorage } = vi.hoisted(() => {
  const mockStorage = {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined)
    }
  };

  return {
    mockBrowserStorage: mockStorage
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockBrowserStorage
  }
}));

// Mock config
vi.mock('../../../config', () => ({
  getApiUrl: async () => 'http://localhost:8000'
}));

describe('TokenManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getValidAccessToken', () => {
    it('returns valid access token when not expired', async () => {
      const futureExpiry = Date.now() + 3600000; // 1 hour from now

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'valid-token',
        token_type: 'bearer',
        expires_at: futureExpiry,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      const token = await tokenManager.getValidAccessToken();

      expect(token).toBe('valid-token');
    });

    it('returns null when no tokens stored', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({});

      const token = await tokenManager.getValidAccessToken();

      expect(token).toBeNull();
    });

    it('refreshes token when expiring soon (<5 minutes)', async () => {
      const soonExpiry = Date.now() + (4 * 60 * 1000); // 4 minutes from now
      const newExpiry = Date.now() + 3600000;

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'expiring-token',
        token_type: 'bearer',
        expires_at: soonExpiry,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          refresh_expires_in: 604800
        })
      });

      const token = await tokenManager.getValidAccessToken();

      // Should have refreshed
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/auth/oauth/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('grant_type":"refresh_token')
        })
      );

      // Should return new token
      expect(token).toBe('new-token');

      // Should store new tokens
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-token',
          refresh_token: 'new-refresh-token'
        })
      );
    });

    it('does not refresh when token has plenty of time left', async () => {
      const futureExpiry = Date.now() + (30 * 60 * 1000); // 30 minutes from now

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'valid-token',
        token_type: 'bearer',
        expires_at: futureExpiry,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      const token = await tokenManager.getValidAccessToken();

      // Should not have called refresh endpoint
      expect(global.fetch).not.toHaveBeenCalled();

      // Should return current token
      expect(token).toBe('valid-token');
    });

    it('returns null when token expired and refresh token also expired', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'expired-token',
        token_type: 'bearer',
        expires_at: Date.now() - 1000, // Expired
        refresh_token: 'expired-refresh',
        refresh_expires_at: Date.now() - 1000 // Also expired
      });

      const token = await tokenManager.getValidAccessToken();

      expect(token).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('handles refresh token failure gracefully', async () => {
      const soonExpiry = Date.now() + (4 * 60 * 1000);

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'expiring-token',
        expires_at: soonExpiry,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid_grant' })
      });

      const token = await tokenManager.getValidAccessToken();

      // Should return null on refresh failure
      expect(token).toBeNull();
    });

    it('deduplicates simultaneous refresh requests', async () => {
      const soonExpiry = Date.now() + (4 * 60 * 1000);

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'expiring-token',
        expires_at: soonExpiry,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          refresh_expires_in: 604800
        })
      });

      // Make multiple simultaneous requests
      const tokens = await Promise.all([
        tokenManager.getValidAccessToken(),
        tokenManager.getValidAccessToken(),
        tokenManager.getValidAccessToken()
      ]);

      // All should return same new token
      expect(tokens[0]).toBe('new-token');
      expect(tokens[1]).toBe('new-token');
      expect(tokens[2]).toBe('new-token');

      // Fetch should only be called once (deduplication)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearTokens', () => {
    it('removes all OAuth tokens from storage', async () => {
      await tokenManager.clearTokens();

      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith([
        'access_token',
        'token_type',
        'expires_at',
        'refresh_token',
        'refresh_expires_at',
        'session_id',
        'user'
      ]);
    });
  });

  describe('Token rotation', () => {
    it('updates both access and refresh tokens on refresh', async () => {
      const soonExpiry = Date.now() + (4 * 60 * 1000);

      mockBrowserStorage.local.get.mockResolvedValue({
        access_token: 'old-access-token',
        expires_at: soonExpiry,
        refresh_token: 'old-refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          refresh_expires_in: 604800,
          session_id: 'session-123',
          user: { user_id: 'user-123', username: 'testuser' }
        })
      });

      await tokenManager.getValidAccessToken();

      // Verify both tokens were updated
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          session_id: 'session-123',
          user: expect.objectContaining({ user_id: 'user-123' })
        })
      );
    });
  });

  describe('Manifest V3 Service Worker compatibility', () => {
    it('fetches tokens from storage on every call (no in-memory cache)', async () => {
      const futureExpiry = Date.now() + 3600000;

      // First call
      mockBrowserStorage.local.get.mockResolvedValueOnce({
        access_token: 'token-1',
        expires_at: futureExpiry,
        refresh_token: 'refresh-1',
        refresh_expires_at: Date.now() + 604800000
      });

      const token1 = await tokenManager.getValidAccessToken();
      expect(token1).toBe('token-1');

      // Second call with different token (simulating worker restart)
      mockBrowserStorage.local.get.mockResolvedValueOnce({
        access_token: 'token-2',
        expires_at: futureExpiry,
        refresh_token: 'refresh-2',
        refresh_expires_at: Date.now() + 604800000
      });

      const token2 = await tokenManager.getValidAccessToken();
      expect(token2).toBe('token-2');

      // Should have fetched from storage both times
      expect(mockBrowserStorage.local.get).toHaveBeenCalledTimes(2);
    });
  });
});
