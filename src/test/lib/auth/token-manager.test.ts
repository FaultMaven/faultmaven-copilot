import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from '../../../lib/auth/token-manager';

// Mock config
vi.mock('../../../config', () => ({
  __esModule: true,
  default: {},
  getApiUrl: async () => 'https://api.faultmaven.ai'
}));

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
    tokenManager = new TokenManager();

    // Mock Web Locks API
    let activeLock: Promise<any> = Promise.resolve();
    mockLocksRequest = vi.fn((name: string, options: any, callback: () => Promise<any>) => {
      activeLock = activeLock.then(() => callback());
      return activeLock;
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
