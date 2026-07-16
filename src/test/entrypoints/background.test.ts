import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browser APIs using vi.hoisted to prevent hoisting problems
const {
  mockBrowser,
  listeners,
  mockStorage,
  mockCreateSession,
  mockDeleteSession,
  mockAuthSaveState,
  mockAuthClearState
} = vi.hoisted(() => {
  (global as any).defineBackground = (config: any) => config;
  const listeners: Record<string, any> = {};
  const mockStorageStore: Record<string, any> = {};

  const mockCreateSession = vi.fn();
  const mockDeleteSession = vi.fn();
  const mockAuthSaveState = vi.fn();
  const mockAuthClearState = vi.fn();

  const mockStorageObj = {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, any> = {};
        keys.forEach(k => {
          if (mockStorageStore[k] !== undefined) {
            result[k] = mockStorageStore[k];
          }
        });
        return result;
      }),
      set: vi.fn(async (obj: Record<string, any>) => {
        Object.entries(obj).forEach(([k, v]) => {
          mockStorageStore[k] = v;
        });
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete mockStorageStore[k]);
      })
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  };

  const mockBrowserObj = {
    runtime: {
      id: 'test-copilot-id',
      onMessage: {
        addListener: vi.fn((fn) => { listeners['message'] = fn; }),
        removeListener: vi.fn()
      },
      onInstalled: {
        addListener: vi.fn((fn) => { listeners['installed'] = fn; }),
        removeListener: vi.fn()
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path) => `chrome-extension://test-copilot-id${path}`)
    },
    tabs: {
      onUpdated: {
        addListener: vi.fn((fn) => { listeners['tabUpdate'] = fn; }),
        removeListener: vi.fn()
      },
      remove: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 999 }),
      query: vi.fn().mockResolvedValue([])
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    storage: mockStorageObj,
    action: {
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      }
    },
    sidePanel: {
      open: vi.fn().mockResolvedValue(undefined)
    }
  };

  return {
    mockBrowser: mockBrowserObj,
    listeners,
    mockStorage: mockStorageObj,
    mockCreateSession,
    mockDeleteSession,
    mockAuthSaveState,
    mockAuthClearState
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: mockBrowser
}));

// Setup global browser mock (for legacy/fallback code)
(global as any).browser = mockBrowser;

vi.mock('../../lib/api', () => ({
  createSession: mockCreateSession,
  deleteSession: mockDeleteSession,
  authManager: {
    saveAuthState: mockAuthSaveState,
    clearAuthState: mockAuthClearState
  }
}));

// Mock config
vi.mock('../../config', () => ({
  __esModule: true,
  default: {
    session: {
      timeoutMs: 30 * 60 * 1000
    }
  },
  getApiUrl: async () => 'https://api.faultmaven.ai',
  getDashboardUrl: async () => 'https://app.faultmaven.ai'
}));

// Mock reconcileAuthBridgeRegistration
vi.mock('../lib/auth/auth-bridge-registration', () => ({
  reconcileAuthBridgeRegistration: vi.fn()
}));

// Import background entrypoint
import backgroundEntry from '../../entrypoints/background';

describe('Background Service Worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    
    // Clear storage store
    await mockStorage.local.remove([
      'sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId',
      'oauth_pending', 'pkce_verifier', 'auth_state', 'redirect_uri',
      'access_token', 'refresh_token', 'expires_at'
    ]);

    // Run main to register listeners
    backgroundEntry.main();
  });

  describe('Message Listener Security', () => {
    it('should reject messages from external extensions (different sender.id)', async () => {
      const sendResponse = vi.fn();
      const result = listeners['message'](
        { action: 'getSessionId' },
        { id: 'hacker-extension-id' },
        sendResponse
      );

      // Listener should return false (sync handling) or call sendResponse with error
      expect(sendResponse).toHaveBeenCalledWith({
        status: 'error',
        message: 'Unauthorized sender'
      });
      expect(result).toBe(false);
    });

    it('should accept messages from within the same extension (matching sender.id)', async () => {
      mockCreateSession.mockResolvedValue({
        session_id: 'new-session-id',
        client_id: 'client-123',
        session_resumed: false
      });

      const sendResponse = vi.fn();
      const result = listeners['message'](
        { action: 'getSessionId' },
        { id: 'test-copilot-id' },
        sendResponse
      );

      // Async message handling should return true
      expect(result).toBe(true);
    });
  });

  describe('Session Message Handling', () => {
    it('should create new session when getSessionId is called with no stored session', async () => {
      mockCreateSession.mockResolvedValue({
        session_id: 'new-session-id',
        client_id: 'client-123',
        session_resumed: false,
        message: 'created'
      });

      const sendResponse = vi.fn();
      await new Promise<void>((resolve) => {
        const handlerResponse = (res: any) => {
          sendResponse(res);
          resolve();
        };

        listeners['message'](
          { action: 'getSessionId' },
          { id: 'test-copilot-id' },
          handlerResponse
        );
      });

      expect(mockCreateSession).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        sessionId: 'new-session-id',
        status: 'success',
        sessionResumed: false,
        message: 'created'
      });

      // Verify stored in storage
      const stored = await mockStorage.local.get(['sessionId']);
      expect(stored.sessionId).toBe('new-session-id');
    });

    it('should return existing session when it is still valid', async () => {
      const now = Date.now();
      await mockStorage.local.set({
        sessionId: 'existing-session-id',
        sessionCreatedAt: now - 5 * 60 * 1000, // 5 min ago (limit is 30 min)
        sessionResumed: true
      });

      const sendResponse = vi.fn();
      await new Promise<void>((resolve) => {
        const handlerResponse = (res: any) => {
          sendResponse(res);
          resolve();
        };

        listeners['message'](
          { action: 'getSessionId' },
          { id: 'test-copilot-id' },
          handlerResponse
        );
      });

      // Should return immediately (synchronously or asynchronously)
      expect(sendResponse).toHaveBeenCalledWith({
        sessionId: 'existing-session-id',
        status: 'success',
        sessionResumed: true
      });
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it('should clear session on clearSession request', async () => {
      await mockStorage.local.set({
        sessionId: 'to-clear-id',
        sessionCreatedAt: Date.now()
      });

      mockDeleteSession.mockResolvedValue(undefined);

      const sendResponse = vi.fn();
      await new Promise<void>((resolve) => {
        const handlerResponse = (res: any) => {
          sendResponse(res);
          resolve();
        };

        listeners['message'](
          { action: 'clearSession' },
          { id: 'test-copilot-id' },
          handlerResponse
        );
      });

      expect(mockDeleteSession).toHaveBeenCalledWith('to-clear-id');
      expect(sendResponse).toHaveBeenCalledWith({ status: 'success' });

      // Verify removed from storage
      const stored = await mockStorage.local.get(['sessionId']);
      expect(stored.sessionId).toBeUndefined();
    });
  });

  describe('OAuth Redirect Tab Monitoring', () => {
    it('should complete OAuth callback and close tab when matching redirect URL is parsed', async () => {
      // Store pending OAuth flow metadata
      await mockStorage.local.set({
        oauth_pending: {
          tabId: 999,
          expectedState: 'state-123',
          deadline: Date.now() + 5 * 60 * 1000
        },
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'chrome-extension://test-copilot-id/callback.html'
      });

      // Mock token exchange fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-token-abc',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-abc',
          refresh_expires_in: 86400,
          user: {
            user_id: 'user-789',
            username: 'alice',
            email: 'alice@example.com',
            display_name: 'Alice',
            roles: ['user']
          }
        })
      });
      global.fetch = mockFetch;

      // Trigger tab update
      await listeners['tabUpdate'](
        999,
        { url: 'https://app.faultmaven.ai/callback?code=code-123&state=state-123' },
        { id: 999 }
      );

      // Verify fetch was called with token request
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/oauth/token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code: 'code-123',
            code_verifier: 'verifier-123',
            client_id: 'faultmaven-copilot',
            redirect_uri: 'chrome-extension://test-copilot-id/callback.html'
          })
        })
      );

      // Verify authManager.saveAuthState was called
      expect(mockAuthSaveState).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-token-abc',
          user: expect.objectContaining({ user_id: 'user-789' })
        })
      );

      // Verify tab was closed
      expect(mockBrowser.tabs.remove).toHaveBeenCalledWith(999);

      // Verify pending OAuth state was cleared
      const stored = await mockStorage.local.get(['oauth_pending']);
      expect(stored.oauth_pending).toBeUndefined();
    });

    it('exchanges the code exactly once when both ingress paths fire for the same redirect', async () => {
      await mockStorage.local.set({
        oauth_pending: {
          tabId: 999,
          expectedState: 'state-123',
          deadline: Date.now() + 5 * 60 * 1000
        },
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'chrome-extension://test-copilot-id/callback.html'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-token-abc',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-abc',
          refresh_expires_in: 86400,
          user: { user_id: 'user-789', username: 'alice', email: 'a@b.c', display_name: 'Alice', roles: ['user'] }
        })
      });
      global.fetch = mockFetch;

      // Fire BOTH ingress paths for the same authorization code, concurrently:
      // the tab monitor AND the callback.html AUTH_CALLBACK message.
      const p1 = listeners['tabUpdate'](
        999,
        { url: 'https://app.faultmaven.ai/callback?code=code-123&state=state-123' },
        { id: 999 }
      );
      const p2 = new Promise<void>((resolve) => {
        listeners['message'](
          { type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' },
          () => resolve()
        );
      });
      await Promise.all([p1, p2]);

      // The single-use code must be exchanged exactly ONCE (not raced twice).
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockAuthSaveState).toHaveBeenCalledTimes(1);
    });

    it('should ignore URLs when state parameter does not match expectedState (CSRF protection)', async () => {
      await mockStorage.local.set({
        oauth_pending: {
          tabId: 999,
          expectedState: 'state-123',
          deadline: Date.now() + 5 * 60 * 1000
        },
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123'
      });

      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      // Trigger tab update with malicious state
      await listeners['tabUpdate'](
        999,
        { url: 'https://app.faultmaven.ai/callback?code=code-123&state=hacker-state' },
        { id: 999 }
      );

      // Verification: Fetch token should NOT run and tab should NOT close
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockBrowser.tabs.remove).not.toHaveBeenCalled();
    });
  });
});
