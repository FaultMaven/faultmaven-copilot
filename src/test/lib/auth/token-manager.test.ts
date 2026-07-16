import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from '../../../lib/auth/token-manager';

// Mock config
vi.mock('../../../config', () => ({
  __esModule: true,
  default: {},
  getApiUrl: async () => 'https://api.faultmaven.ai'
}));

// Mock auth-config so the mode-aware refresh doesn't fetch /auth/config. Default
// to OAuth ('oidc' provider) so the existing refresh tests keep using /oauth/token.
const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../lib/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

// Mock browser storage using vi.hoisted to prevent hoisting problems
const { mockBrowserStorage } = vi.hoisted(() => {
  let store: Record<string, any> = {};
  const mockStorage = {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, any> = {};
        keys.forEach(k => {
          if (store[k] !== undefined) {
            result[k] = store[k];
          }
        });
        return result;
      }),
      set: vi.fn(async (obj: Record<string, any>) => {
        store = { ...store, ...obj };
      }),
      remove: vi.fn(async (keys: string[]) => {
        keys.forEach(k => delete store[k]);
      })
    }
  };
  return { mockBrowserStorage: mockStorage };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockBrowserStorage
  }
}));

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockLocksRequest: any;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' }); // OAuth mode by default
    tokenManager = new TokenManager();

    // Mock Web Locks API. Serialize like a real exclusive lock, but each
    // request() is INDEPENDENT: a rejected holder must not prevent the next
    // waiter's callback from running (the refresh path now acquires the lock
    // once per retry attempt, so a failed attempt must not poison the next).
    let activeLock: Promise<any> = Promise.resolve();
    mockLocksRequest = vi.fn((name: string, options: any, callback: () => Promise<any>) => {
      const result = activeLock.then(() => callback(), () => callback());
      activeLock = result.then(() => {}, () => {});
      return result;
    });

    Object.defineProperty(global, 'navigator', {
      value: {
        locks: {
          request: mockLocksRequest
        }
      },
      writable: true,
      configurable: true
    });

    // Reset local store
    mockBrowserStorage.local.set({
      access_token: undefined,
      token_type: undefined,
      expires_at: undefined,
      refresh_token: undefined,
      refresh_expires_at: undefined,
      session_id: undefined,
      user: undefined
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null when no tokens are stored', async () => {
    const token = await tokenManager.getValidAccessToken();
    expect(token).toBeNull();
  });

  it('should return the token when it is still valid', async () => {
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes in future
    await mockBrowserStorage.local.set({
      access_token: 'valid-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000
    });

    const token = await tokenManager.getValidAccessToken();
    expect(token).toBe('valid-access-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should clear tokens and return null when refresh token is expired', async () => {
    const expiresAt = Date.now() - 1000; // Expired
    await mockBrowserStorage.local.set({
      access_token: 'expired-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'expired-refresh-token',
      refresh_expires_at: Date.now() - 1000 // Expired
    });

    const token = await tokenManager.getValidAccessToken();
    expect(token).toBeNull();

    const stored = await mockBrowserStorage.local.get(['access_token']);
    expect(stored.access_token).toBeUndefined();
  });

  it('should refresh and return a new token when access token is expiring soon', async () => {
    const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes (less than 5 min threshold)
    await mockBrowserStorage.local.set({
      access_token: 'expiring-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'session-123',
      user: { user_id: '1' }
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        refresh_expires_in: 86400
      })
    });
    global.fetch = mockFetch;

    const token = await tokenManager.getValidAccessToken();
    expect(token).toBe('new-access-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token']);
    expect(stored.access_token).toBe('new-access-token');
    expect(stored.refresh_token).toBe('new-refresh-token');
  });

  it('refreshes via the LOCAL /auth/refresh endpoint in local mode', async () => {
    mockGetAuthConfig.mockResolvedValue({ provider: 'local' });
    await mockBrowserStorage.local.set({
      access_token: 'expiring-access-token',
      token_type: 'bearer',
      expires_at: Date.now() + 2 * 60 * 1000, // expiring soon
      refresh_token: 'local-refresh-token',
      // No refresh_expires_at (local sessions have none) — must not force a logout.
      session_id: 'session-123',
      user: { user_id: '1' }
    });

    // Local /auth/refresh response: NO refresh_expires_in.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'local-new-access',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'local-new-refresh'
      })
    });
    global.fetch = mockFetch;

    const token = await tokenManager.getValidAccessToken();

    expect(token).toBe('local-new-access');
    // Hit the local endpoint with the local body (no grant_type/client_id).
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.faultmaven.ai/api/v1/auth/refresh');
    expect(JSON.parse(calledInit.body)).toEqual({ refresh_token: 'local-refresh-token' });

    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token', 'refresh_expires_at']);
    expect(stored.access_token).toBe('local-new-access');
    expect(stored.refresh_token).toBe('local-new-refresh'); // rotated
    // No refresh expiry persisted for local sessions.
    expect(stored.refresh_expires_at).toBeUndefined();
  });

  it('should use Web Locks API to serialize concurrent requests', async () => {
    const expiresAt = Date.now() + 2 * 60 * 1000;
    await mockBrowserStorage.local.set({
      access_token: 'expiring-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        refresh_expires_in: 86400
      })
    });
    global.fetch = mockFetch;

    // Call concurrently
    const [token1, token2] = await Promise.all([
      tokenManager.getValidAccessToken(),
      tokenManager.getValidAccessToken()
    ]);

    expect(token1).toBe('new-access-token');
    expect(token2).toBe('new-access-token');
    // Web Lock triggers lock callbacks sequentially, so the second lock request
    // sees that the token has already been refreshed and skips fetch.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLocksRequest).toHaveBeenCalledTimes(2);
  });

  it('preserves tokens and returns the still-valid access token on a TRANSIENT refresh failure', async () => {
    // Access token is within the 5-min refresh window but NOT yet expired, and
    // every refresh attempt fails with a network error. The user must NOT be
    // logged out: tokens stay, and the still-valid access token is returned.
    const expiresAt = Date.now() + 2 * 60 * 1000; // expiring soon, still valid
    await mockBrowserStorage.local.set({
      access_token: 'still-valid-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'session-123',
      user: { user_id: '1' }
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('network down'));
    global.fetch = mockFetch;

    const token = await tokenManager.getValidAccessToken();

    // Fell back to the current token instead of returning null / logging out.
    expect(token).toBe('still-valid-access-token');
    // Retried before giving up.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Tokens PRESERVED (not cleared) so a later call can retry the refresh.
    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token']);
    expect(stored.access_token).toBe('still-valid-access-token');
    expect(stored.refresh_token).toBe('valid-refresh-token');
  }, 10000);

  it('clears tokens and returns null on a DEFINITIVE (401) refresh rejection', async () => {
    const expiresAt = Date.now() + 2 * 60 * 1000;
    await mockBrowserStorage.local.set({
      access_token: 'expiring-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'revoked-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'session-123',
      user: { user_id: '1' }
    });

    // Server rejects the refresh token as invalid/revoked → HTTP 401.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid or expired refresh token' })
    });
    global.fetch = mockFetch;

    const token = await tokenManager.getValidAccessToken();

    expect(token).toBeNull();
    // Definitive → no retry.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Tokens cleared → the user re-authenticates.
    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token']);
    expect(stored.access_token).toBeUndefined();
    expect(stored.refresh_token).toBeUndefined();
  });

  it('does NOT overwrite stored tokens when a 200 response has an invalid token payload', async () => {
    const expiresAt = Date.now() + 2 * 60 * 1000; // expiring soon, still valid
    await mockBrowserStorage.local.set({
      access_token: 'still-valid-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'session-123',
      user: { user_id: '1' }
    });

    // 200 OK but the body is NOT a well-formed token payload (e.g. an ingress
    // interstitial or cached proxy JSON). Must not clobber storage with
    // access_token: undefined / expires_at: NaN.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ not: 'a token' })
    });
    global.fetch = mockFetch;

    const token = await tokenManager.getValidAccessToken();

    // Treated as transient → retried, then fell back to the existing valid token.
    expect(token).toBe('still-valid-access-token');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Storage NOT corrupted.
    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token']);
    expect(stored.access_token).toBe('still-valid-access-token');
    expect(stored.refresh_token).toBe('valid-refresh-token');
  }, 10000);

  it('should fall back to in-context deduplication when Web Locks API is unavailable', async () => {
    // Disable Web Locks
    Object.defineProperty(global.navigator, 'locks', {
      value: undefined,
      configurable: true
    });

    const expiresAt = Date.now() + 2 * 60 * 1000;
    await mockBrowserStorage.local.set({
      access_token: 'expiring-access-token',
      token_type: 'bearer',
      expires_at: expiresAt,
      refresh_token: 'valid-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token-no-lock',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token-no-lock',
        refresh_expires_in: 86400
      })
    });
    global.fetch = mockFetch;

    // Call concurrently
    const [token1, token2] = await Promise.all([
      tokenManager.getValidAccessToken(),
      tokenManager.getValidAccessToken()
    ]);

    expect(token1).toBe('new-access-token-no-lock');
    expect(token2).toBe('new-access-token-no-lock');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
