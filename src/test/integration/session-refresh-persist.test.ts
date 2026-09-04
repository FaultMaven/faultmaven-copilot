import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stateful in-memory host store, so a value written by refreshSession is
// visible to a later getAuthHeaders read (the actual bug: the retry path
// re-created a session but never persisted it, so the retry went session-less).
const { store, createSessionWithRecovery, getValidAccessToken, getAuthState } = vi.hoisted(() => ({
  store: {} as Record<string, any>,
  createSessionWithRecovery: vi.fn(),
  getValidAccessToken: vi.fn(),
  getAuthState: vi.fn()
}));

vi.mock('@faultmaven/copilot-ui/lib/session/client-session-manager', () => ({
  clientSessionManager: { createSessionWithRecovery }
}));
vi.mock('../../extension/auth/token-manager', () => ({ tokenManager: { getValidAccessToken } }));
vi.mock('../../extension/auth/auth-manager', () => ({ authManager: { getAuthState } }));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { refreshSession } from '@faultmaven/copilot-ui/lib/api/session-core';
import { getAuthHeaders } from '@faultmaven/copilot-ui/lib/api/fetch-utils';

import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

describe('session refresh → X-Session-Id bridge', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    createSessionWithRecovery.mockReset().mockResolvedValue({
      session_id: 'sess-refreshed', client_id: 'c1', session_resumed: false, status: 'active'
    });
    getValidAccessToken.mockReset().mockResolvedValue(null);
    getAuthState.mockReset().mockResolvedValue(null);
    if (typeof navigator !== 'undefined') delete (navigator as any).locks;
    // BOTH ends of the bridge are bound to the one in-memory store: the write
    // goes through the host store, the read through the host transport. Binding
    // them to two different stores would let this pass while the bug was back.
    setHostStore({
      get: async (keys: string[]) => {
        const out: Record<string, any> = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (obj: Record<string, any>) => { Object.assign(store, obj); },
      remove: async (keys: string[]) => { for (const k of keys) delete store[k]; },
      subscribe: () => () => {},
    });
    setApiTransport({
      baseUrl: async () => 'http://localhost:8090',
      accessToken: async () => {
        const token = await getValidAccessToken();
        if (!token) throw new Error('no credential');
        return token;
      },
      sessionId: async () => (store.sessionId as string | undefined) ?? null,
      clearSession: async () => {
        delete store.sessionId;
        delete store.sessionCreatedAt;
        delete store.sessionResumed;
      },
      onUnauthorized: () => {},
    });
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
