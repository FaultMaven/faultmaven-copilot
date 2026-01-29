import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  devLogin,
  getCurrentUser,
  logoutAuth,
  authManager,
  AuthState,
  getUserCases,
  createCase
} from '../../lib/api';
import { AuthenticationError } from '../../lib/errors/types';

// Mock config
vi.mock('../../config', () => ({
  __esModule: true,
  default: {
    session: {
      timeoutMinutes: 180,
      timeoutMs: 180 * 60 * 1000
    },
    inputLimits: {
      dataModeLinesThreshold: 100,
      maxQueryLength: 200000,
      maxFileSize: 10 * 1024 * 1024
    }
  },
  getApiUrl: async () => 'https://api.faultmaven.ai'
}));

// Mock browser environment using vi.hoisted to handle hoisting
const { mockBrowserStorage, mockBrowserRuntime } = vi.hoisted(() => {
  const mockStorage = {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn(),
      remove: vi.fn()
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  };
  
  const mockRuntime = {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  };
  
  return {
    mockBrowserStorage: mockStorage,
    mockBrowserRuntime: mockRuntime
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockBrowserStorage,
    runtime: mockBrowserRuntime
  }
}));

// Setup global browser mock (for legacy/fallback code)
(global as any).browser = {
  storage: mockBrowserStorage,
  runtime: mockBrowserRuntime
};

// Helper to mock fetch response
const mockFetchResponse = (response: any = {}) => {
  return {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    headers: {
      get: vi.fn((key) => response.headers?.[key] || null)
    },
    json: () => Promise.resolve(response.json ?? {})
  };
};

describe('Authentication API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AuthManager', () => {
    const mockAuthState: AuthState = {
      access_token: 'test-token-123',
      token_type: 'bearer',
      expires_at: Date.now() + 86400000, // 24 hours from now
      user: {
        user_id: 'user_123',
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        is_dev_user: true,
        is_active: true
      }
    };

    it('saves auth state to browser storage', async () => {
      await authManager.saveAuthState(mockAuthState);

      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith({
        authState: mockAuthState
      });
    });

    it('retrieves valid auth state from storage', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: mockAuthState
      });

      const result = await authManager.getAuthState();

      expect(result).toEqual(mockAuthState);
      expect(mockBrowserStorage.local.get).toHaveBeenCalledWith(['authState']);
    });

    it('returns null for expired auth state', async () => {
      const expiredAuthState = {
        ...mockAuthState,
        expires_at: Date.now() - 1000 // Expired 1 second ago
      };

      mockBrowserStorage.local.get.mockResolvedValue({
        authState: expiredAuthState
      });

      const result = await authManager.getAuthState();

      expect(result).toBeNull();
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
    });

    it('returns null when no auth state exists', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({});

      const result = await authManager.getAuthState();

      expect(result).toBeNull();
    });

    it('clears auth state from storage', async () => {
      await authManager.clearAuthState();

      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
    });

    it('checks authentication status correctly', async () => {
      // Test authenticated state
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: mockAuthState
      });

      let isAuth = await authManager.isAuthenticated();
      expect(isAuth).toBe(true);

      // Test unauthenticated state
      mockBrowserStorage.local.get.mockResolvedValue({});

      isAuth = await authManager.isAuthenticated();
      expect(isAuth).toBe(false);
    });
  });

  describe('devLogin', () => {
    it('logs in successfully and stores auth state', async () => {
      const loginResponse = {
        access_token: 'new-token-456',
        token_type: 'bearer',
        expires_in: 86400,
        session_id: 'session-789',
        user: {
          user_id: 'user_456',
          username: 'newuser',
          email: 'new@example.com',
          display_name: 'New User',
          is_dev_user: true,
          is_active: true
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(loginResponse)
      });

      const result = await devLogin('newuser', 'new@example.com', 'New User');

      // Verify API call
      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/dev-login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'newuser',
            email: 'new@example.com',
            display_name: 'New User'
          }),
          credentials: 'include'
        }
      );

      // Verify auth state is saved
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith({
        authState: expect.objectContaining({
          access_token: 'new-token-456',
          token_type: 'bearer',
          user: loginResponse.user
        })
      });

      expect(result).toEqual(loginResponse);
    });

    it('handles login failure correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Invalid credentials' })
      });

      await expect(devLogin('invaliduser')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('getCurrentUser', () => {
    it('gets current user with authentication', async () => {
      const userResponse = {
        user_id: 'user_123',
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        is_dev_user: true,
        is_active: true
      };

      // Mock auth state (legacy AuthManager) AND OAuth tokens (TokenManager)
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: {
          access_token: 'valid-token',
          token_type: 'bearer',
          expires_at: Date.now() + 86400000
        },
        // OAuth tokens for TokenManager
        access_token: 'valid-token',
        token_type: 'bearer',
        expires_at: Date.now() + 3600000,
        refresh_token: 'valid-refresh',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(userResponse)
      });

      const result = await getCurrentUser();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/me',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-token'
          }),
          credentials: 'include'
        })
      );

      expect(result).toEqual(userResponse);
    });

    it('handles 401 authentication error', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({});

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        status: 401,
        ok: false,
        json: { detail: 'Unauthorized' }
      }));

      await expect(getCurrentUser()).rejects.toThrow(AuthenticationError);
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
    });
  });

  describe('logoutAuth', () => {
    it('logs out successfully and clears state', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        // OAuth tokens for TokenManager
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true
      });

      await logoutAuth();

      // Verify logout API call
      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token-to-clear'
          }),
          credentials: 'include'
        })
      );

      // Verify auth state is cleared
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);

      // Verify cross-tab message is sent
      expect(mockBrowserRuntime.sendMessage).toHaveBeenCalledWith({
        type: 'auth_state_changed',
        authState: null
      });
    });

    it('clears auth state even on logout API failure', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        // OAuth tokens for TokenManager
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        ok: false,
        status: 500,
        json: { detail: 'Server error' }
      }));

      await expect(logoutAuth()).rejects.toThrow('Server error');

      // Auth state should still be cleared even on API failure
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
    });
  });

  describe('Authenticated API calls', () => {
    beforeEach(() => {
      // Mock valid auth state for authenticated calls (legacy AuthManager)
      // AND OAuth tokens for TokenManager
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: {
          access_token: 'valid-auth-token',
          token_type: 'bearer',
          expires_at: Date.now() + 86400000
        },
        sessionId: 'test-session-id',
        // OAuth tokens for TokenManager
        access_token: 'valid-auth-token',
        token_type: 'bearer',
        expires_at: Date.now() + 3600000, // 1 hour from now
        refresh_token: 'valid-refresh-token',
        refresh_expires_at: Date.now() + 604800000 // 7 days from now
      });
    });

    it('getUserCases includes both auth and session headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([])
      });

      await getUserCases();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id',
            'Content-Type': 'application/json'
          }),
          credentials: 'include'
        })
      );
    });

    it('createCase includes auth headers', async () => {
      // API returns CaseSummary directly at root level per OpenAPI spec
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('test-correlation-id')
        },
        json: () => Promise.resolve({
          case_id: 'case-123',
          title: 'Test Case',
          status: 'consulting',
          created_at: '2024-01-01T00:00:00Z',
          user_id: 'user-1'
        })
      });

      await createCase({ title: 'Test Case' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          }),
          credentials: 'include'
        })
      );
    });

    it('deleteCase includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204
      });

      const { deleteCase } = await import('../../lib/api');
      await deleteCase('case-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases/case-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id',
            'Content-Type': 'application/json'
          }),
          credentials: 'include'
        })
      );
    });

    it('archiveCase includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      });

      const { archiveCase } = await import('../../lib/api');
      await archiveCase('case-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases/case-123/archive',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          }),
          credentials: 'include'
        })
      );
    });

    it('uploadDataToCase includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ data_id: 'data-123' })
      });

      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const { uploadDataToCase } = await import('../../lib/api');
      await uploadDataToCase('case-123', 'session-123', mockFile);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases/case-123/data',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          }),
          credentials: 'include'
        })
      );
    });

    it('generateCaseTitle includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        ok: true,
        status: 200,
        json: { title: 'Generated Title' }
      }));

      const { generateCaseTitle } = await import('../../lib/api');
      await generateCaseTitle('case-123', { max_words: 5 });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases/case-123/title',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          }),
          credentials: 'include'
        })
      );
    });

    // REMOVED: Legacy uploadData() test
    // Function removed in favor of uploadDataToCase() (already tested above)

    it('getSessionData includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([])
      });

      const { getSessionData } = await import('../../lib/api');
      await getSessionData('session-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/data/sessions/session-123?limit=10&offset=0',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    /*
    it('uploadKnowledgeDocument includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ document_id: 'doc-123' })
      });

      const mockFile = new File(['# Test Doc'], 'test.md', { type: 'text/markdown' });
      const { uploadKnowledgeDocument } = await import('../../lib/api');
      await uploadKnowledgeDocument(mockFile, 'Test Doc', 'playbook');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/knowledge/documents',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    it('getKnowledgeDocuments includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ documents: [], total_count: 0 })
      });

      const { getKnowledgeDocuments } = await import('../../lib/api');
      await getKnowledgeDocuments();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.faultmaven.ai/api/v1/knowledge/documents'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    it('searchKnowledgeBase includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ query: 'test', total_results: 0, results: [] })
      });

      const { searchKnowledgeBase } = await import('../../lib/api');
      await searchKnowledgeBase('test query');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/knowledge/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });
    */

    it('getSession includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session_id: 'session-123', status: 'active' })
      });

      const { getSession } = await import('../../lib/api');
      await getSession('session-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/session-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    it('deleteSession includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204
      });

      const { deleteSession } = await import('../../lib/api');
      await deleteSession('session-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/session-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    it('listSessions includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([])
      });

      const { listSessions } = await import('../../lib/api');
      await listSessions();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer valid-auth-token',
            'X-Session-Id': 'test-session-id'
          })
        })
      );
    });

    it('handles 401 error in authenticated calls', async () => {
      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        status: 401,
        ok: false,
        json: { detail: 'Unauthorized' }
      }));

      await expect(getUserCases()).rejects.toThrow(AuthenticationError);

      // Verify auth state is cleared on 401
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
    });
  });

  describe('Header generation', () => {
    it('includes both headers when auth and session available', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: {
          access_token: 'test-token',
          expires_at: Date.now() + 86400000
        },
        sessionId: 'test-session',
        // OAuth tokens for TokenManager
        access_token: 'test-token',
        expires_at: Date.now() + 3600000,
        refresh_token: 'test-refresh',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([])
      });

      await getUserCases();

      const call = (fetch as any).mock.calls[0];
      const headers = call[1].headers;

      expect(headers['Authorization']).toBe('Bearer test-token');
      expect(headers['X-Session-Id']).toBe('test-session');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes only session header when auth unavailable', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        sessionId: 'test-session'
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([])
      });

      await getUserCases();

      const call = (fetch as any).mock.calls[0];
      const headers = call[1].headers;

      expect(headers['Authorization']).toBeUndefined();
      expect(headers['X-Session-Id']).toBe('test-session');
    });

    it('includes only auth header when session unavailable', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: {
          access_token: 'test-token',
          expires_at: Date.now() + 86400000
        },
        // OAuth tokens for TokenManager
        access_token: 'test-token',
        expires_at: Date.now() + 3600000,
        refresh_token: 'test-refresh',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([])
      });

      await getUserCases();

      const call = (fetch as any).mock.calls[0];
      const headers = call[1].headers;

      expect(headers['Authorization']).toBe('Bearer test-token');
      expect(headers['X-Session-Id']).toBeUndefined();
    });
  });
});