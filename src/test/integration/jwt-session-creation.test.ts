/**
 * Integration Test: JWT Token in Session Creation
 *
 * This test verifies that JWT tokens are correctly passed in the Authorization header
 * when creating sessions after login, ensuring authenticated users don't get anonymous sessions.
 *
 * Issue: https://github.com/faultmaven/docs/working/CRITICAL-frontend-jwt-token-missing.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientSessionManager } from '../../lib/session/client-session-manager';
import { authManager } from '../../lib/auth/auth-manager';
import type { AuthState } from '../../lib/api/types';

// Mock browser environment
const { mockBrowser } = vi.hoisted(() => {
  const storage = {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    }
  };
  return {
    mockBrowser: {
      storage
    }
  };
});

vi.mock('wxt/browser', () => ({
  browser: mockBrowser
}));

// Mock config
vi.mock('../../config', () => ({
  default: {
    session: {
      timeoutMinutes: 180
    }
  },
  getApiUrl: vi.fn().mockResolvedValue('http://localhost:8000')
}));

describe('JWT Token in Session Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should include Authorization header when user is authenticated', async () => {
    // 1. Setup: User has logged in and has JWT token
    const mockAuthState: AuthState = {
      access_token: 'mock-jwt-token-abc123',
      token_type: 'bearer',
      expires_at: Date.now() + 3600000, // 1 hour from now
      user: {
        user_id: '3f0dfb95-3711-4974-ba85-a9373cbf749b',
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        is_dev_user: true,
        is_active: true
      }
    };

    // Mock storage to return auth state
    mockBrowser.storage.local.get.mockImplementation((keys: string[]) => {
      if (keys.includes('authState')) {
        return Promise.resolve({ authState: mockAuthState });
      }
      if (keys.includes('faultmaven_client_id')) {
        return Promise.resolve({ faultmaven_client_id: 'client-123' });
      }
      if (keys.includes('access_token')) {
        return Promise.resolve({ access_token: mockAuthState.access_token });
      }
      return Promise.resolve({});
    });

    // Mock successful session creation response
    const mockSessionResponse = {
      session_id: 'session-123',
      user_id: '3f0dfb95-3711-4974-ba85-a9373cbf749b',
      status: 'active',
      created_at: new Date().toISOString(),
      session_type: 'troubleshooting',
      message: 'Session created successfully'
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessionResponse)
    });

    // 2. Act: Create session
    const session = await clientSessionManager.createSession();

    // 3. Assert: Verify Authorization header was sent
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer mock-jwt-token-abc123'
        })
      })
    );

    // 4. Verify session was created for authenticated user
    expect(session.session_id).toBe('session-123');
    expect(session.user_id).toBe('3f0dfb95-3711-4974-ba85-a9373cbf749b');
  });

  it('should NOT include Authorization header when user is not authenticated', async () => {
    // 1. Setup: No auth state (anonymous user)
    mockBrowser.storage.local.get.mockImplementation((keys: string[]) => {
      if (keys.includes('faultmaven_client_id')) {
        return Promise.resolve({ faultmaven_client_id: 'client-456' });
      }
      return Promise.resolve({});
    });

    // Mock anonymous session response
    const mockSessionResponse = {
      session_id: 'session-456',
      user_id: 'user_bb548749', // Auto-generated anonymous user
      status: 'active',
      created_at: new Date().toISOString(),
      session_type: 'troubleshooting',
      message: 'Session created successfully'
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSessionResponse)
    });

    // 2. Act: Create session
    const session = await clientSessionManager.createSession();

    // 3. Assert: Verify NO Authorization header was sent
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );

    // Verify Authorization header is NOT present
    const fetchCall = (global.fetch as any).mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['Authorization']).toBeUndefined();

    // 4. Verify session was created as anonymous
    expect(session.user_id).toMatch(/^user_[a-z0-9]+$/);
  });

  it('should use TokenManager tokens when available', async () => {
    // 1. Setup: TokenManager has tokens (OAuth flow)
    const oauthToken = 'oauth-token-xyz789';

    mockBrowser.storage.local.get.mockImplementation((keys: string[]) => {
      if (keys.includes('access_token')) {
        return Promise.resolve({
          access_token: oauthToken,
          token_type: 'bearer',
          expires_at: Date.now() + 3600000,
          refresh_token: 'refresh-token-123',
          refresh_expires_at: Date.now() + 7200000
        });
      }
      if (keys.includes('faultmaven_client_id')) {
        return Promise.resolve({ faultmaven_client_id: 'client-789' });
      }
      return Promise.resolve({});
    });

    // Mock successful session creation
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        session_id: 'session-789',
        user_id: 'oauth-user-123',
        status: 'active',
        created_at: new Date().toISOString(),
        session_type: 'troubleshooting',
        message: 'Session created successfully'
      })
    });

    // 2. Act: Create session
    await clientSessionManager.createSession();

    // 3. Assert: Verify OAuth token was used
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer oauth-token-xyz789'
        })
      })
    );
  });

  it('should fall back to AuthManager when TokenManager returns null', async () => {
    // 1. Setup: TokenManager returns null, but AuthManager has token
    const authManagerToken = 'auth-manager-token-456';

    mockBrowser.storage.local.get.mockImplementation((keys: string[]) => {
      // TokenManager checks these keys first
      if (keys.includes('access_token') && !keys.includes('authState')) {
        return Promise.resolve({}); // No TokenManager tokens
      }
      // AuthManager fallback
      if (keys.includes('authState')) {
        return Promise.resolve({
          authState: {
            access_token: authManagerToken,
            token_type: 'bearer',
            expires_at: Date.now() + 3600000,
            user: {
              user_id: 'auth-user-789',
              username: 'authuser',
              email: 'auth@example.com',
              display_name: 'Auth User',
              is_dev_user: true,
              is_active: true
            }
          }
        });
      }
      if (keys.includes('faultmaven_client_id')) {
        return Promise.resolve({ faultmaven_client_id: 'client-fallback' });
      }
      return Promise.resolve({});
    });

    // Mock successful session creation
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        session_id: 'session-fallback',
        user_id: 'auth-user-789',
        status: 'active',
        created_at: new Date().toISOString(),
        session_type: 'troubleshooting',
        message: 'Session created successfully'
      })
    });

    // 2. Act: Create session
    await clientSessionManager.createSession();

    // 3. Assert: Verify AuthManager token was used as fallback
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer auth-manager-token-456'
        })
      })
    );
  });
});
