import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stateful in-memory browser.storage.local so a value written by refreshSession
// is visible to a later getAuthHeaders read (the actual bug: the retry path
// re-created a session but never persisted it, so the retry went session-less).
const { store, createSessionWithRecovery, getValidAccessToken, getAuthState } = vi.hoisted(() => ({
  store: {} as Record<string, any>,
  createSessionWithRecovery: vi.fn(),
  getValidAccessToken: vi.fn(),
  getAuthState: vi.fn()
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, any> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, any>) => { Object.assign(store, obj); }),
        remove: vi.fn(async (keys: string[]) => { for (const k of keys) delete store[k]; })
      }
    }
  }
}));

vi.mock('../../lib/session/client-session-manager', () => ({
  clientSessionManager: { createSessionWithRecovery }
}));
vi.mock('../../lib/auth/token-manager', () => ({ tokenManager: { getValidAccessToken } }));
vi.mock('../../lib/auth/auth-manager', () => ({ authManager: { getAuthState } }));
vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));
vi.mock('../../config', () => ({ default: {}, getApiUrl: vi.fn().mockResolvedValue('https://api.test') }));

import { refreshSession } from '../../lib/api/session-core';
import { getAuthHeaders } from '../../lib/api/fetch-utils';

describe('session refresh → X-Session-Id bridge', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    createSessionWithRecovery.mockReset().mockResolvedValue({
      session_id: 'sess-refreshed', client_id: 'c1', session_resumed: false, status: 'active'
    });
    getValidAccessToken.mockReset().mockResolvedValue(null);
    getAuthState.mockReset().mockResolvedValue(null);
    if (typeof navigator !== 'undefined') delete (navigator as any).locks;
  });

  it('persists the refreshed session so the next request carries X-Session-Id', async () => {
    // Storage starts with NO sessionId (handleSessionExpired removed it).
    let headers = await getAuthHeaders();
    expect((headers as Record<string, string>)['X-Session-Id']).toBeUndefined();

    await refreshSession();

    // The very defect: after refresh, the header must now be present.
    headers = await getAuthHeaders();
    expect((headers as Record<string, string>)['X-Session-Id']).toBe('sess-refreshed');
    expect(store.sessionId).toBe('sess-refreshed');
  });
});
