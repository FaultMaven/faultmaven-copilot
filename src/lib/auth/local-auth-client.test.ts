/**
 * Local Auth Client Tests
 *
 * Unit tests for LocalAuthClient (local mode authentication).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalAuthClient, type LocalLoginCredentials, type LocalRegisterRequest } from './local-auth-client';

// Mock dependencies
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
      }
    },
    runtime: {
      sendMessage: vi.fn()
    }
  }
}));

vi.mock('../../config', () => ({
  getApiUrl: vi.fn().mockResolvedValue('http://localhost:8090')
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('../session/client-session-manager', () => ({
  clientSessionManager: {
    clearClientId: vi.fn().mockResolvedValue(undefined)
  }
}));

// Import mocked browser after mocking
import { browser } from 'wxt/browser';

describe('LocalAuthClient', () => {
  let client: LocalAuthClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new LocalAuthClient();

    // Reset mocks
    vi.clearAllMocks();

    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock chrome.storage.local responses
    (browser.storage.local.set as any).mockResolvedValue(undefined);
    (browser.storage.local.get as any).mockImplementation(async (keys: any) => {
      // Return empty object by default
      return {};
    });
    (browser.storage.local.remove as any).mockResolvedValue(undefined);
    (browser.runtime.sendMessage as any).mockResolvedValue(undefined);
  });

  describe('signIn', () => {
    it('should successfully sign in with username and password', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        session_id: 'test-session-id',
        user: {
          user_id: 'user-123',
          username: 'testuser',
          email: 'test@example.com',
          display_name: 'Test User',
          created_at: '2024-01-01T00:00:00Z',
          is_dev_user: false,
          roles: ['user']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTokenResponse
      });

      const credentials: LocalLoginCredentials = {
        username: 'testuser',
        password: 'testpass'
      };

      const result = await client.signIn(credentials);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockTokenResponse.user);
      expect(result.error).toBeUndefined();

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8090/api/v1/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'testuser',
            password: 'testpass',
            email: undefined,
            display_name: undefined
          }),
          credentials: 'include'
        })
      );

      // Verify tokens were stored (including composite authState)
      expect(browser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'test-access-token',
          token_type: 'bearer',
          session_id: 'test-session-id',
          user: mockTokenResponse.user,
          authState: expect.objectContaining({
            access_token: 'test-access-token',
            token_type: 'bearer',
            user: mockTokenResponse.user
          })
        })
      );

      // Verify auth state change was broadcasted
      // Note: broadcastAuthStateChange fetches user from storage, which is empty in test
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'auth_state_changed',
        authState: null
      });
    });

    it('should successfully sign in with only username (no password)', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        session_id: 'test-session-id',
        user: {
          user_id: 'user-123',
          username: 'testuser',
          email: 'test@example.com',
          display_name: 'Test User',
          created_at: '2024-01-01T00:00:00Z',
          is_dev_user: true,
          roles: ['user']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockTokenResponse
      });

      const credentials: LocalLoginCredentials = {
        username: 'testuser'
        // No password
      };

      const result = await client.signIn(credentials);

      expect(result.success).toBe(true);

      // Verify password was not sent
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.password).toBeUndefined();
    });

    it('should handle login failure with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          detail: 'Invalid credentials'
        })
      });

      const credentials: LocalLoginCredentials = {
        username: 'testuser',
        password: 'wrongpass'
      };

      const result = await client.signIn(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(result.user).toBeUndefined();

      // Tokens should not be stored on failure
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const credentials: LocalLoginCredentials = {
        username: 'testuser'
      };

      const result = await client.signIn(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to connect to server');
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      const credentials: LocalLoginCredentials = {
        username: 'testuser'
      };

      const result = await client.signIn(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Login failed');
    });
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        session_id: 'test-session-id',
        user: {
          user_id: 'user-new',
          username: 'newuser',
          email: 'new@example.com',
          display_name: 'New User',
          created_at: '2024-01-01T00:00:00Z',
          is_dev_user: false,
          roles: ['user']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockTokenResponse
      });

      const request: LocalRegisterRequest = {
        username: 'newuser',
        email: 'new@example.com',
        display_name: 'New User',
        password: 'newpass'
      };

      const result = await client.register(request);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockTokenResponse.user);

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8090/api/v1/auth/register',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'newuser',
            email: 'new@example.com',
            display_name: 'New User',
            password: 'newpass'
          }),
          credentials: 'include'
        })
      );

      // Verify tokens were stored
      expect(browser.storage.local.set).toHaveBeenCalled();

      // Verify auth state change was broadcasted
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
    });

    it('should handle registration failure (username taken)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          detail: 'Username already exists'
        })
      });

      const request: LocalRegisterRequest = {
        username: 'existing',
        email: 'test@example.com',
        display_name: 'Test User'
      };

      const result = await client.register(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Username already exists');
    });

    it('should register without password (optional)', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        session_id: 'test-session-id',
        user: {
          user_id: 'user-new',
          username: 'newuser',
          email: 'new@example.com',
          display_name: 'New User',
          created_at: '2024-01-01T00:00:00Z',
          is_dev_user: false,
          roles: ['user']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockTokenResponse
      });

      const request: LocalRegisterRequest = {
        username: 'newuser',
        email: 'new@example.com',
        display_name: 'New User'
        // No password
      };

      const result = await client.register(request);

      expect(result.success).toBe(true);

      // Verify password was not sent
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.password).toBeUndefined();
    });
  });

  describe('signOut', () => {
    it('should successfully sign out and clear tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      await client.signOut();

      // Verify logout API was called
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8090/api/v1/auth/logout',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include'
        })
      );

      // Verify tokens were cleared (including composite authState)
      expect(browser.storage.local.remove).toHaveBeenCalledWith([
        'access_token',
        'token_type',
        'expires_at',
        'refresh_token',
        'refresh_expires_at',
        'session_id',
        'user',
        'authState'
      ]);

      // Verify auth state change was broadcasted
      expect(browser.runtime.sendMessage).toHaveBeenCalled();
    });

    it('should clear tokens even if logout API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await client.signOut();

      // Tokens should still be cleared
      expect(browser.storage.local.remove).toHaveBeenCalled();
    });
  });

  describe('getAccessToken', () => {
    it('should return access token if stored', async () => {
      (browser.storage.local.get as any).mockResolvedValueOnce({
        access_token: 'test-token'
      });

      const token = await client.getAccessToken();

      expect(token).toBe('test-token');
      expect(browser.storage.local.get).toHaveBeenCalledWith(['access_token']);
    });

    it('should return null if no token stored', async () => {
      (browser.storage.local.get as any).mockResolvedValueOnce({});

      const token = await client.getAccessToken();

      expect(token).toBeNull();
    });
  });
});
