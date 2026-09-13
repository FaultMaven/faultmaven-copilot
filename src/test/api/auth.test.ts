import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthState, getUserCases, createCase } from '@faultmaven/copilot-ui/lib/api';
// The credential stack is no longer re-exported by the shared barrel — that is
// the route this step cut — so the extension's own modules are imported here
// directly, which is what the extension itself does.
import { getCurrentUser, logoutAuth } from '../../extension/auth/auth-service';
import { authManager } from '../../extension/auth/auth-manager';
import { AuthenticationError } from '@faultmaven/copilot-ui/lib/errors/types';

// Build-time constants only. Where the API lives is the host's answer, which
// this file installs below.
vi.mock('@faultmaven/copilot-ui/config', () => ({
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
  }
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
    // Resolves, because that is what the real API does — EventBus attaches a
    // `.catch` to swallow "no listener", and a mock returning undefined made
    // the broadcast throw where the real one cannot.
    sendMessage: vi.fn().mockResolvedValue(undefined),
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

// Mock auth-config so logout's best-effort refresh-token revoke can be exercised
// per auth mode. Default is 'local' (revoke skipped) to keep existing tests intact;
// the OAuth revoke tests override the provider explicitly.
const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../extension/auth/auth-config', async (importActual) => ({
  ...(await importActual<any>()),
  getAuthConfig: mockGetAuthConfig
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

import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';

const API = 'https://api.faultmaven.ai';

describe('Authentication API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Re-armed each test: afterEach's restoreAllMocks drops the implementation,
    // and a sendMessage that returns undefined is not what the real API does —
    // EventBus attaches a `.catch` to swallow "no listener".
    mockBrowserRuntime.sendMessage.mockResolvedValue(undefined);

    // This file mocks `wxt/browser` for itself, so the suite defaults from
    // setup.ts — bound to the global mock and to localhost — would answer from
    // the wrong storage and the wrong origin. The credential, the session id
    // and the base URL every assertion below names all come from HERE.
    setHostStore({
      get: (keys) => mockBrowserStorage.local.get(keys),
      set: (items) => mockBrowserStorage.local.set(items),
      remove: (keys) => mockBrowserStorage.local.remove(keys),
      subscribe: () => () => {},
    });
    setHostEndpoints({
      apiUrl: async () => API,
      dashboardUrl: async () => 'https://app.faultmaven.ai',
      subscribe: () => () => {},
    });
    setApiTransport({
      baseUrl: async () => API,
      accessToken: async () => {
        const stored = await mockBrowserStorage.local.get(['authState']);
        const token = (stored as any)?.authState?.access_token;
        if (!token) throw new Error('no credential staged');
        return token;
      },
      sessionId: async () => {
        const stored = await mockBrowserStorage.local.get(['sessionId']);
        return (stored as any)?.sessionId ?? null;
      },
      clearSession: async () => {
        await mockBrowserStorage.local.remove(['sessionId', 'sessionCreatedAt', 'sessionResumed']);
      },
      onUnauthorized: () => 'ended' as const,
    });
    // Default to local mode: logout's best-effort revoke is a no-op unless a test
    // opts into OAuth mode.
    mockGetAuthConfig.mockResolvedValue({
      provider: 'local',
      features: {
        supports_registration: true,
        supports_password_reset: false,
        supports_email_verification: false,
        requires_redirect: false
      }
    });
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
      // The credential keys are staged too: getAuthState now asks
      // tokenManager.isAuthenticated() unconditionally, so a row with no
      // credential behind it is (correctly) reconciled away rather than
      // returned. That reconciliation is what removed the need for an
      // orphan-repair read on the per-request hot path.
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: mockAuthState,
        access_token: mockAuthState.access_token,
        expires_at: mockAuthState.expires_at,
        user: mockAuthState.user
      });

      const result = await authManager.getAuthState();

      expect(result).toEqual(mockAuthState);
      expect(mockBrowserStorage.local.get).toHaveBeenCalledWith(['authState']);
    });

    it('returns null for a dead session WITHOUT tearing anything down', async () => {
      const expiredAuthState = {
        ...mockAuthState,
        expires_at: Date.now() - 1000 // Expired 1 second ago
      };

      mockBrowserStorage.local.get.mockResolvedValue({
        authState: expiredAuthState
      });

      const result = await authManager.getAuthState();

      expect(result).toBeNull();
      // A read answers the question and nothing else. It used to tear down here,
      // which made every caller destructive — `extension-reload.ts` asks this to
      // decide whether the extension reloaded, and the options page to render a
      // name. Repair is `reconcileSession()`, below.
      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalled();
    });

    it('reconcileSession clears BOTH halves when the chain is definitively dead', async () => {
      // A reader that detects death and then performs a PARTIAL teardown leaves
      // the previous user's tokens and profile at rest with nothing coming back
      // for them: the panel renders the sign-in screen, so no later call reaches
      // TokenManager's own terminal paths. Asserting only `remove(['authState'])`
      // — as the test above does — passes either way, which is why this one
      // exists separately.
      const expiredAuthState = { ...mockAuthState, expires_at: Date.now() - 1000 };
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: expiredAuthState,
        // No access_token and no refresh_token: nothing left to refresh with.
      });

      await authManager.reconcileSession();

      // A reader that detects death and then performs a PARTIAL teardown leaves
      // the previous user's tokens and profile at rest with nothing coming back
      // for them. Both halves, or it is not a teardown.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token', 'user'])
      );
    });

    it('clearAllAuthData NEVER rejects, and still clears the credentials', async () => {
      // It used to rethrow. Every caller does something load-bearing straight
      // afterwards — `logoutAuth` and `LocalAuthClient.signOut` broadcast
      // `auth_state_changed`, and `onUnauthorized` must return an AuthOutcome
      // because `client.ts` awaits it unguarded — so a throw suppressed exactly
      // the notification that makes a sign-out observable, with the credentials
      // already gone. That is this area's original bug pointed the other way.
      mockBrowserStorage.local.remove.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });

      await expect(authManager.clearAllAuthData()).resolves.toBeUndefined();

      // The other half still ran.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token'])
      );
    });

    it('clearAllAuthData single-flights concurrent teardowns', async () => {
      // Four call sites tear a session down, and two of them fire once per
      // failing request: a revoked credential 401s the heartbeat, the turn poll
      // and the case fetch at once. Inside TokenManager the refresh lock
      // serialized this; owning it here is what replaces that.
      mockBrowserStorage.local.get.mockResolvedValue({});

      await Promise.all([
        authManager.clearAllAuthData(),
        authManager.clearAllAuthData(),
        authManager.clearAllAuthData(),
      ]);

      // One identity removal and one credential removal, not three of each.
      const authStateRemovals = mockBrowserStorage.local.remove.mock.calls.filter(
        (call: any[]) => Array.isArray(call[0]) && call[0].length === 1 && call[0][0] === 'authState'
      );
      expect(authStateRemovals).toHaveLength(1);
    });

    it('reconcileSession sweeps credentials that outlived their row', async () => {
      // The mirror of the original bug. `runTeardown` removes the row first and
      // can then fail on the credentials, leaving a bearer at rest that nothing
      // removes: the panel shows the sign-in screen, so no later request reaches
      // the credential stack to notice. Sweeping the row-with-no-credential
      // split and not this one is an asymmetry, not a design.
      // A DEAD orphan, which is the only kind that actually happens: the
      // teardown runs because the chain was ruled dead, then its credential
      // half fails. Staging a live one (the first version of this test) asks a
      // question the real failure never asks.
      mockBrowserStorage.local.get.mockResolvedValue({
        // No authState row, and nothing here is refreshable.
        access_token: 'orphaned',
        expires_at: Date.now() - 3600000,
      });

      expect(await authManager.reconcileSession()).toBeNull();

      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token'])
      );
    });

    it('reconcileSession does nothing when nothing is stored at all', async () => {
      // The ordinary signed-out state must not look like a repair opportunity.
      mockBrowserStorage.local.get.mockResolvedValue({});

      expect(await authManager.reconcileSession()).toBeNull();

      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalled();
    });

    it('reconcileSession leaves a LIVE session alone', async () => {
      // The negative control: a repair that fires on a healthy session is just
      // a logout with extra steps.
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: mockAuthState,
        access_token: mockAuthState.access_token,
        expires_at: mockAuthState.expires_at,
        user: mockAuthState.user
      });

      await authManager.reconcileSession();

      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalled();
    });


    it('keeps an expired authState when TokenManager still has a refreshable token (no spurious logout)', async () => {
      // The composite expiry is the ACCESS-token expiry frozen at login; a valid
      // refresh_token means the session is alive. getAuthState must NOT delete it
      // (which would fire the storage listener and force a logout ~1h in).
      const expiredAuthState = { ...mockAuthState, expires_at: Date.now() - 1000 };
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: expiredAuthState,
        access_token: 'stale-access',
        expires_at: Date.now() - 1000,     // access token also expired...
        refresh_token: 'valid-refresh'     // ...but still refreshable
      });

      const result = await authManager.getAuthState();

      expect(result).toEqual(expiredAuthState); // kept, not deleted
      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalledWith(['authState']);
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

    it('clearAuthState is token-PRESERVING (does not remove token keys)', async () => {
      await authManager.clearAuthState();

      // Only the composite authState is removed — the refresh_token must survive
      // the normal access-token-expiry path so the session can be refreshed.
      const removedKeySets = mockBrowserStorage.local.remove.mock.calls.map((c: any[]) => c[0]);
      expect(removedKeySets).toContainEqual(['authState']);
      const clearedTokenKeys = removedKeySets.some(
        (keys: string[]) => Array.isArray(keys) && keys.includes('refresh_token')
      );
      expect(clearedTokenKeys).toBe(false);
    });

    it('clearAllAuthData clears BOTH the authState and all token keys', async () => {
      await authManager.clearAllAuthData();

      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining([
          'access_token', 'token_type', 'expires_at',
          'refresh_token', 'refresh_expires_at', 'session_id', 'user'
        ])
      );
    });

    it('checks authentication status correctly', async () => {
      // Test authenticated state (credential staged too — see the note above)
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: mockAuthState,
        access_token: mockAuthState.access_token,
        expires_at: mockAuthState.expires_at,
        user: mockAuthState.user
      });

      let isAuth = await authManager.isAuthenticated();
      expect(isAuth).toBe(true);

      // Test unauthenticated state
      mockBrowserStorage.local.get.mockResolvedValue({});

      isAuth = await authManager.isAuthenticated();
      expect(isAuth).toBe(false);
    });

    // copilot#185. A stored authState with no `user` is structurally invalid.
    // Dereferencing it threw `Cannot read properties of undefined (reading
    // 'display_name')` inside whichever component asked, which renders as an
    // unrecoverable error page instead of a login prompt. Treat it as no session.
    it('returns null for a stored authState that has no user, instead of throwing', async () => {
      const { user: _omitted, ...noUser } = mockAuthState as any;
      mockBrowserStorage.local.get.mockResolvedValue({ authState: noUser });

      await expect(authManager.getCurrentUser()).resolves.toBeNull();
    });

    // isAuthenticated() must agree with getCurrentUser(). Disagreeing puts the
    // store in {isAuthenticated: true, currentUser: null}, and SidePanelApp
    // gates only on isAuthenticated — so the signed-in UI renders with no
    // identity and the login prompt never appears.
    it('reports NOT authenticated for a stored authState that has no user', async () => {
      const { user: _omitted, ...noUser } = mockAuthState as any;
      mockBrowserStorage.local.get.mockResolvedValue({ authState: noUser });

      await expect(authManager.isAuthenticated()).resolves.toBe(false);
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

    it('handles 401 authentication error on a credential-present request', async () => {
      // A hard auth failure means the credential we SENT is invalid — seed a
      // valid token so getAuthHeaders attaches Authorization: Bearer.
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'valid-token', token_type: 'bearer', expires_at: Date.now() + 86400000 },
        access_token: 'valid-token',
        token_type: 'bearer',
        expires_at: Date.now() + 3600000,
        refresh_token: 'valid-refresh',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        status: 401,
        ok: false,
        json: { detail: 'Unauthorized' }
      }));

      await expect(getCurrentUser()).rejects.toThrow(AuthenticationError);
      // The client no longer clears the credential itself — it reports the
      // rejection and the host tears down. See client.test.ts for the report.
      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalledWith(['authState']);
    });

    // #99: a 401 on a header-less request (no token attached — transient refresh
    // outage that preserved the tokens) is a recoverable session condition, not
    // a hard auth failure. It must NOT run the full teardown.
    it('does NOT tear down auth on a 401 when no credential was attached (#99)', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({}); // no stored token

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
        status: 401,
        ok: false,
        json: { detail: 'Unauthorized' }
      }));

      // The recoverable classification routes into the retry wrapper's refresh,
      // which fails here too (everything 401s) — so what surfaces is that
      // failure, not the original SessionExpiredError.
      await expect(getCurrentUser()).rejects.toThrow();
      // The token-clearing teardown must not have fired.
      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalledWith(['authState']);
    });

    // getCurrentUser goes through authenticatedFetchWithRetry, not the bare
    // authenticatedFetch. The bare helper REMOVES sessionId from storage and
    // throws; a caller reading this for display swallows the rejection, so
    // without the wrapper's refresh the panel would be left with no persisted
    // session id and the next real request would have to 401 its way to one.
    it('refreshes and retries on an expired session rather than leaving it cleared', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'valid-token', token_type: 'bearer', expires_at: Date.now() + 86400000 },
        access_token: 'valid-token',
        token_type: 'bearer',
        expires_at: Date.now() + 3600000,
        refresh_token: 'valid-refresh',
        refresh_expires_at: Date.now() + 604800000
      });

      const userResponse = { user_id: 'user_123', username: 'testuser', email: 'test@example.com' };
      let meCalls = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/auth/me')) {
          meCalls += 1;
          if (meCalls === 1) {
            return mockFetchResponse({
              status: 401,
              ok: false,
              json: { detail: 'Session expired', error_code: 'SESSION_EXPIRED' },
              headers: { 'x-error-code': 'SESSION_EXPIRED' }
            });
          }
          return mockFetchResponse({ json: userResponse });
        }
        if (String(url).includes('/sessions')) {
          return mockFetchResponse({
            json: { session_id: 'session-new', created_at: 'now', status: 'active', last_activity: 'now' }
          });
        }
        return mockFetchResponse({ json: {} });
      });

      await expect(getCurrentUser()).resolves.toEqual(userResponse);

      // The replacement session was persisted, so the retry (and everything
      // after it) carries X-Session-Id.
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-new' })
      );
      expect(meCalls).toBe(2);
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

      // A real Response has a json(); the endpoint answers LogoutResponse, and
      // the reach of the sign-out is read from it.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: 'Logged out successfully',
          revoked_tokens: 1,
          all_sessions_ended: true
        })
      });

      const outcome = await logoutAuth();
      expect(outcome.allSessionsEnded).toBe(true);

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

      // Verify the OAuth token keys are ALSO cleared — otherwise a stale
      // refresh_token survives and TokenManager silently re-authenticates the
      // "logged out" user (the bug this PR fixes).
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token', 'refresh_expires_at', 'session_id', 'user'])
      );

      // Verify cross-tab message is sent
      expect(mockBrowserRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'auth_state_changed', authState: null })
      );
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

      // Auth state AND tokens should still be cleared even on API failure.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(['authState']);
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token', 'refresh_expires_at', 'session_id', 'user'])
      );
    });

    const REVOKE_URL = 'https://api.faultmaven.ai/api/v1/auth/oauth/revoke';

    it('OAuth mode: best-effort revokes the refresh token server-side before teardown', async () => {
      mockGetAuthConfig.mockResolvedValue({
        provider: 'oidc',
        features: {
          supports_registration: false,
          supports_password_reset: false,
          supports_email_verification: false,
          requires_redirect: true
        }
      });
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true }));

      await logoutAuth();

      // `waitFor`: the revoke is deliberately NOT awaited by logoutAuth — it
      // waits on the network and would otherwise stall the panel that asked for
      // the sign-out. It still has to happen.
      await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        REVOKE_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            token: 'refresh-token',
            token_type_hint: 'refresh_token',
            client_id: 'faultmaven-copilot'
          })
        })
      ));
      // Local teardown still runs.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token', 'refresh_expires_at', 'session_id', 'user'])
      );
    });

    it('refreshes a near-expiry session so the sign-out can be confirmed', async () => {
      // Reading the STORED token alone meant that after a laptop sleep the POST
      // went out with an expired bearer, 401'd, and the user was told we could
      // not confirm their other sessions ended — on a sign-out that could have
      // refreshed first and actually written the account-wide revocation.
      mockGetAuthConfig.mockResolvedValue({ provider: 'local', features: {} as any });
      // STATEFUL: a fixed mock would hand the pre-refresh token back on the
      // re-read after a successful rotation, and the test would be asserting
      // against a store that never changes.
      let store: Record<string, any> = {
        authState: { access_token: 'near-expiry' },
        access_token: 'near-expiry',
        expires_at: Date.now() + 60_000, // inside the proactive-refresh window
        refresh_token: 'refresh-token',
      };
      mockBrowserStorage.local.get.mockImplementation(async (keys: string[]) => {
        const out: Record<string, any> = {};
        keys.forEach((k) => { if (store[k] !== undefined) out[k] = store[k]; });
        return out;
      });
      mockBrowserStorage.local.set.mockImplementation(async (obj: Record<string, any>) => {
        store = { ...store, ...obj };
      });
      mockBrowserStorage.local.remove.mockImplementation(async (keys: string[]) => {
        keys.forEach((k) => delete store[k]);
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/auth/refresh')) {
          return mockFetchResponse({
            ok: true,
            json: {
              access_token: 'fresh-bearer',
              token_type: 'bearer',
              expires_in: 900,
              refresh_token: 'rotated',
            },
          });
        }
        return mockFetchResponse({ ok: true, json: { all_sessions_ended: true } });
      });

      const outcome = await logoutAuth();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/logout',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer fresh-bearer' }),
        })
      );
      expect(outcome.allSessionsEnded).toBe(true);
    });

    it('never lets its own POST tear the session down', async () => {
      // The other half. `getValidAccessToken` reports a dead chain by throwing,
      // and the HOST acts on that by clearing storage — which mid-logout would
      // run inside the try, before the broadcast, and destroy the refresh token
      // the revoke still needs. logoutAuth asks the credential stack directly
      // and swallows the verdict, so the only teardown is its own, in the
      // `finally`.
      mockGetAuthConfig.mockResolvedValue({ provider: 'local', features: {} as any });
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'doomed' },
        access_token: 'doomed',
        expires_at: Date.now() + 60_000,
        refresh_token: 'revoked-refresh-token',
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/auth/refresh')) {
          // Definitive rejection: the chain is dead.
          return mockFetchResponse({ ok: false, status: 400, json: { error: 'invalid_grant' } });
        }
        return mockFetchResponse({ ok: true, json: { all_sessions_ended: true } });
      });

      // Resolves rather than rejecting: the verdict must not escape logoutAuth.
      await expect(logoutAuth()).resolves.toBeDefined();

      // The POST still went out, with whatever bearer was stored.
      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
      // And the local teardown still ran.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token'])
      );
    }, 20_000);

    it('OAuth mode: a failing revoke never blocks logout', async () => {
      mockGetAuthConfig.mockResolvedValue({
        provider: 'oidc',
        features: {
          supports_registration: false,
          supports_password_reset: false,
          supports_email_verification: false,
          requires_redirect: true
        }
      });
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === REVOKE_URL) {
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve(mockFetchResponse({ ok: true }));
      });

      // Logout resolves despite the revoke failure, and reports the sign-out as
      // unconfirmed: this body carries no `all_sessions_ended`, which is what a
      // backend predating the field looks like. Unconfirmed, not assumed.
      await expect(logoutAuth()).resolves.toEqual({ allSessionsEnded: false });
      // ...the logout endpoint was still called...
      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
      // ...and local teardown still ran.
      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining(['access_token', 'refresh_token', 'refresh_expires_at', 'session_id', 'user'])
      );
    });

    it('local mode: does not attempt refresh-token revoke', async () => {
      // Default mock is local mode.
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh-token',
        refresh_expires_at: Date.now() + 604800000
      });

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true }));

      await logoutAuth();

      expect(fetch).not.toHaveBeenCalledWith(REVOKE_URL, expect.anything());
    });

    it('OAuth mode with no refresh token: does not attempt revoke', async () => {
      mockGetAuthConfig.mockResolvedValue({
        provider: 'oidc',
        features: {
          supports_registration: false,
          supports_password_reset: false,
          supports_email_verification: false,
          requires_redirect: true
        }
      });
      // No refresh_token in storage (access-token-only / never-fully-authenticated).
      mockBrowserStorage.local.get.mockResolvedValue({
        authState: { access_token: 'token-to-clear' },
        access_token: 'token-to-clear',
        expires_at: Date.now() + 3600000
      });

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true }));

      await logoutAuth();

      expect(fetch).not.toHaveBeenCalledWith(REVOKE_URL, expect.anything());
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
          status: 'inquiry',
          created_at: '2024-01-01T00:00:00Z',
          user_id: 'user-1',
          enterprise_id: 'ent-1'
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

      const { deleteCase } = await import('@faultmaven/copilot-ui/lib/api');
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

    it('submitTurn includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          agent_response: 'Processed',
          turn_number: 1,
          milestones_completed: [],
          case_state: 'inquiry',
          progress_made: false,
          is_stuck: false,
          attachments_processed: []
        })
      });

      const { submitTurn } = await import('@faultmaven/copilot-ui/lib/api');
      await submitTurn('case-123', { query: 'test' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/cases/case-123/turns',
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

      const { generateCaseTitle } = await import('@faultmaven/copilot-ui/lib/api');
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

    // REMOVED: Legacy uploadData() and uploadDataToCase() tests
    // Both replaced by unified submitTurn() endpoint

    /*
    it('uploadKnowledgeDocument includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ document_id: 'doc-123' })
      });

      const mockFile = new File(['# Test Doc'], 'test.md', { type: 'text/markdown' });
      const { uploadKnowledgeDocument } = await import('@faultmaven/copilot-ui/lib/api');
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

      const { getKnowledgeDocuments } = await import('@faultmaven/copilot-ui/lib/api');
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

      const { searchKnowledgeBase } = await import('@faultmaven/copilot-ui/lib/api');
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

    it('heartbeatSession includes auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session_id: 'session-123', status: 'active' })
      });

      const { heartbeatSession } = await import('@faultmaven/copilot-ui/lib/api');
      await heartbeatSession('session-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/sessions/session-123/heartbeat',
        expect.objectContaining({
          method: 'POST',
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
      // The client no longer clears the credential itself — it reports the
      // rejection and the host tears down. See client.test.ts for the report.
      expect(mockBrowserStorage.local.remove).not.toHaveBeenCalledWith(['authState']);
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