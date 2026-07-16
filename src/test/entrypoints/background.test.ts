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

    it('clears a stale refresh_expires_at when the OAuth token response has none', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'v', auth_state: 's',
        redirect_uri: 'chrome-extension://test-copilot-id/callback.html',
        refresh_expires_at: 123 // stale value from a previous session
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'a', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          // NO refresh_expires_in
          user: { user_id: 'u', username: 'x', roles: ['user'] }
        })
      });

      const res = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'c-stale', state: 's' }, { id: 'test-copilot-id' }, resolve);
      });

      expect(res.success).toBe(true);
      const stored = await mockStorage.local.get(['refresh_token', 'refresh_expires_at']);
      expect(stored.refresh_token).toBe('r');
      // Stale value must be REMOVED (a past refresh_expires_at forces a logout).
      expect(stored.refresh_expires_at).toBeUndefined();
    });

    it('rejects an OAuth token response with a non-numeric expires_in (no NaN expires_at stored)', async () => {
      await mockStorage.local.set({ pkce_verifier: 'v', auth_state: 's' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'a', token_type: 'bearer', refresh_token: 'r', user: { user_id: 'u' } })
      });

      const res = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'c-invalid', state: 's' }, { id: 'test-copilot-id' }, resolve);
      });

      expect(res.success).toBe(false);
      const stored = await mockStorage.local.get(['access_token']);
      expect(stored.access_token).toBeUndefined();
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

    it('gives BOTH racing ingress paths the same success result (loser shares, not errors)', async () => {
      await mockStorage.local.set({
        oauth_pending: { tabId: 999, expectedState: 'state-123', deadline: Date.now() + 300000 },
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'chrome-extension://test-copilot-id/callback.html'
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 't', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          refresh_expires_in: 86400, user: { user_id: 'u1', username: 'a', roles: ['user'] }
        })
      });

      const p1 = listeners['tabUpdate'](999,
        { url: 'https://app.faultmaven.ai/callback?code=code-123&state=state-123' }, { id: 999 });
      const messageResult = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, resolve);
      });
      await p1;

      // The AUTH_CALLBACK ingress (whichever raced second) must receive the shared
      // success — never a "code already used" error.
      expect(messageResult).toEqual(expect.objectContaining({ success: true }));
    });

    it('AUTH_CALLBACK with a mismatched state is rejected without exchanging (CSRF)', async () => {
      await mockStorage.local.set({ pkce_verifier: 'verifier-123', auth_state: 'state-123' });
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const result = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'attacker-state' },
          { id: 'test-copilot-id' }, resolve);
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ success: false }));
      expect(result.error).toMatch(/state parameter mismatch/i);
    });

    it('does not re-exchange the same code after a completed flow (replay rejected)', async () => {
      await mockStorage.local.set({
        oauth_pending: { tabId: 999, expectedState: 'state-123', deadline: Date.now() + 300000 },
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'chrome-extension://test-copilot-id/callback.html'
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 't', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          refresh_expires_in: 86400, user: { user_id: 'u1', username: 'a', roles: ['user'] }
        })
      });
      global.fetch = mockFetch;

      // First, complete the flow (evicts the in-flight entry, clears pkce_verifier).
      await new Promise<void>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, () => resolve());
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Replay the same code: must be rejected with no additional token exchange.
      const replay = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, resolve);
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(replay).toEqual(expect.objectContaining({ success: false }));
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

  describe('Auth Bridge storeAuth', () => {
    const bridgePayload = {
      access_token: 'bridge-access',
      token_type: 'bearer',
      expires_at: Date.now() + 3600_000,
      refresh_token: 'bridge-refresh',
      user: { user_id: 'u1', username: 'alice', roles: ['user'] }
    };

    const storeAuth = (payload: any) => new Promise<any>((resolve) => {
      listeners['message']({ action: 'storeAuth', payload }, { id: 'test-copilot-id' }, resolve);
    });

    it('persists the refresh_token (TokenManager keys) so a bridge session can auto-refresh', async () => {
      const res = await storeAuth(bridgePayload);

      expect(res).toEqual({ status: 'success' });
      // The whole point: refresh material must land in the TokenManager keys, not
      // just the composite authState.
      const stored = await mockStorage.local.get([
        'access_token', 'refresh_token', 'token_type', 'expires_at'
      ]);
      expect(stored.access_token).toBe('bridge-access');
      expect(stored.refresh_token).toBe('bridge-refresh');
      expect(stored.token_type).toBe('bearer');
      expect(stored.expires_at).toBe(bridgePayload.expires_at);
      // Composite authState still saved for the fallback path.
      expect(mockAuthSaveState).toHaveBeenCalledWith(bridgePayload);
    });

    it('derives refresh_expires_at from refresh_expires_in when present', async () => {
      const before = Date.now();
      await storeAuth({ ...bridgePayload, refresh_expires_in: 604800 });

      const stored = await mockStorage.local.get(['refresh_expires_at']);
      expect(stored.refresh_expires_at).toBeGreaterThanOrEqual(before + 604800 * 1000);
    });

    it('handles a payload without refresh_token and clears stale refresh material', async () => {
      // Seed a PREVIOUS session's refresh material.
      await mockStorage.local.set({ refresh_token: 'stale-refresh', refresh_expires_at: 123 });

      const { refresh_token, ...noRefresh } = bridgePayload;
      await storeAuth(noRefresh);

      const stored = await mockStorage.local.get(['access_token', 'refresh_token', 'refresh_expires_at']);
      expect(stored.access_token).toBe('bridge-access');
      // Stale refresh material must be removed — not left to pair with the new
      // access token or to trigger a spurious logout.
      expect(stored.refresh_token).toBeUndefined();
      expect(stored.refresh_expires_at).toBeUndefined();
    });

    it('clears a stale refresh_expires_at when the new payload has none', async () => {
      await mockStorage.local.set({ refresh_expires_at: 123 }); // past → would force logout
      await storeAuth(bridgePayload); // has refresh_token but no expiry field

      const stored = await mockStorage.local.get(['refresh_token', 'refresh_expires_at']);
      expect(stored.refresh_token).toBe('bridge-refresh');
      expect(stored.refresh_expires_at).toBeUndefined();
    });
  });
});
