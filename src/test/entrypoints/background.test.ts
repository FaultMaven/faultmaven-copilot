import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browser APIs using vi.hoisted to prevent hoisting problems
const {
  mockBrowser,
  listeners,
  mockStorage,
  mockAuthSaveState,
  mockAuthClearState, mockIdentity
} = vi.hoisted(() => {
  (global as any).defineBackground = (config: any) => config;
  const listeners: Record<string, any> = {};
  const mockStorageStore: Record<string, any> = {};

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

  // identity owns the sign-in window: the browser opens it and closes it on
  // redirect, which is why there is no tab to create, watch or remove.
  const mockIdentity = {
    getRedirectURL: vi.fn(() => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn()
  };

  const mockBrowserObj = {
    identity: mockIdentity,
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
    mockIdentity,
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
        { action: 'storeAuth' },
        { id: 'hacker-extension-id' },
        sendResponse
      );

      // The sender guard rejects before any handler runs.
      expect(sendResponse).toHaveBeenCalledWith({
        status: 'error',
        message: 'Unauthorized sender'
      });
      expect(result).toBe(false);
    });

    it('should accept messages from within the same extension (matching sender.id)', async () => {
      const sendResponse = vi.fn();
      listeners['message'](
        { action: 'someInternalAction' },
        { id: 'test-copilot-id' },
        sendResponse
      );

      // A same-extension sender passes the guard: it is NOT rejected as
      // unauthorized (an unrecognized action falls through to 'Unknown action').
      expect(sendResponse).not.toHaveBeenCalledWith({
        status: 'error',
        message: 'Unauthorized sender'
      });
    });
  });

  /**
   * Mock fetch for the OAuth callback, which makes TWO calls: the token
   * exchange, then the `/auth/me` profile read.
   *
   * `POST /auth/oauth/token` answers with the backend's flat `TokenResponse`
   * (access_token, refresh_token, token_type, expires_in, refresh_expires_in,
   * user_id, username) — no nested `user`. These fixtures deliberately carry
   * that shape: they previously nested a `user` object per `AuthTokenResponse`,
   * a model this endpoint never returns, and so passed against a contract the
   * server does not implement (copilot#185).
   *
   * `profile: null` simulates a failing profile read, which must FAIL the
   * sign-in — a degraded profile would be persisted and never re-read.
   */
  const mockOAuthFetch = (
    tokenBody: Record<string, any>,
    opts: { profile?: Record<string, any> | null } = {}
  ) =>
    vi.fn().mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/auth/me')) {
        return Promise.resolve(
          opts.profile === null
            ? { ok: false, status: 503, json: async () => ({}) }
            : { ok: true, json: async () => opts.profile ?? {} }
        );
      }
      return Promise.resolve({ ok: true, json: async () => tokenBody });
    });

  /**
   * Count only token-exchange calls. The OAuth callback also fetches /auth/me,
   * so a bare `mockFetch` call count no longer answers "was this code exchanged
   * exactly once?" — which is what these single-exchange assertions are about.
   */
  const tokenExchangeCalls = (mockFetch: any) =>
    mockFetch.mock.calls.filter(
      ([url]: [unknown]) => typeof url === 'string' && url.includes('/auth/oauth/token')
    ).length;

  const TOKEN_RESPONSE = {
    access_token: 'new-token-abc',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-abc',
    refresh_expires_in: 86400,
    user_id: 'user-789',
    username: 'alice'
  };

  const PROFILE_RESPONSE = {
    user_id: 'user-789',
    username: 'alice',
    email: 'alice@example.com',
    display_name: 'Alice',
    is_dev_user: false,
    roles: ['user']
  };

  describe('Sign-in via the browser auth window', () => {
    const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';

    /**
     * Run a full sign-in.
     *
     * The auth window echoes back the state the flow actually generated, the
     * way a real authorization server does — the state is minted inside
     * initiateDashboardOAuth, so a test cannot pre-decide it. Pass
     * `stateOverride` to simulate a mismatched/forged redirect.
     */
    async function signIn(
      { code = 'code-123', stateOverride }: { code?: string; stateOverride?: string } = {}
    ) {
      mockIdentity.launchWebAuthFlow.mockImplementationOnce(async () => {
        const stored = await mockStorage.local.get(['auth_state']);
        const state = stateOverride ?? stored.auth_state;
        return `${REDIRECT}?code=${code}&state=${state}`;
      });
      return await new Promise<any>((resolve) => {
        const handled = listeners['message'](
          { action: 'initiateOIDCLogin' },
          { id: 'test-copilot-id' },
          resolve
        );
        if (handled !== true) resolve(undefined);
      });
    }

    it('completes sign-in from the auth window without creating or closing a tab', async () => {
      // Store pending OAuth flow metadata
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });

      // Mock token exchange + profile read
      const mockFetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: PROFILE_RESPONSE });
      global.fetch = mockFetch;

      await signIn();

      // Verify fetch was called with token request
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/oauth/token',
        expect.objectContaining({
          method: 'POST',
          // The verifier and state are minted inside the flow, so the test
          // asserts the SHAPE and the values it actually controls — pinning a
          // pre-seeded verifier would only prove the seed was ignored.
          body: expect.any(String)
        })
      );

      const tokenCall = mockFetch.mock.calls.find((c: any[]) =>
        String(c[0]).endsWith('/auth/oauth/token')
      );
      expect(tokenCall).toBeDefined();
      const sentBody = JSON.parse(tokenCall![1].body);
      expect(sentBody).toMatchObject({
        grant_type: 'authorization_code',
        code: 'code-123',
        client_id: 'faultmaven-copilot',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      });
      expect(typeof sentBody.code_verifier).toBe('string');
      expect(sentBody.code_verifier.length).toBeGreaterThan(20);

      // Verify authManager.saveAuthState was called
      expect(mockAuthSaveState).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-token-abc',
          user: expect.objectContaining({ user_id: 'user-789' })
        })
      );

      // Verify tab was closed
      // No tab to close: identity.launchWebAuthFlow owns the sign-in window and
      // the browser closes it on redirect. The extension creating and removing
      // a tab is exactly what this replaced.
      expect(mockBrowser.tabs.create).not.toHaveBeenCalled();
      expect(mockBrowser.tabs.remove).not.toHaveBeenCalled();

      // Verify pending OAuth state was cleared
      const stored = await mockStorage.local.get(['pkce_verifier', 'auth_state', 'redirect_uri']);
      expect(stored.pkce_verifier).toBeUndefined();
      expect(stored.auth_state).toBeUndefined();
      expect(stored.redirect_uri).toBeUndefined();
    });

    /** Drive sign-in with a hand-written auth-window outcome. */
    async function signInWith(launchWebAuthFlow: () => Promise<string>) {
      mockIdentity.launchWebAuthFlow.mockImplementationOnce(launchWebAuthFlow);
      return await new Promise<any>((resolve) => {
        const handled = listeners['message'](
          { action: 'initiateOIDCLogin' },
          { id: 'test-copilot-id' },
          resolve
        );
        if (handled !== true) resolve(undefined);
      });
    }

    // handleAuthCallback never throws — exchangeCodeForTokens catches everything
    // and answers { success: false, error }. While that result was only logged,
    // a failed token exchange fell through to `status: 'success'`, and
    // AuthScreen (which errors only on 'error') then sat on "Authenticating…"
    // for the full SSO_WAIT_TIMEOUT_MS with no message and no way back.
    it('reports an error to the panel when the token exchange fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'code already used' })
      });

      const response = await signIn();

      expect(response).toEqual(expect.objectContaining({ status: 'error' }));
      expect(response.message).toMatch(/code already used/i);
    });

    // The same failure one step later: tokens minted, profile read refused.
    it('reports an error to the panel when the profile read fails', async () => {
      global.fetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: null });

      const response = await signIn();

      expect(response).toEqual(expect.objectContaining({ status: 'error' }));
      expect(mockAuthSaveState).not.toHaveBeenCalled();
    });

    // The PKCE verifier, state and redirect_uri live at FIXED storage keys, so
    // there is one slot. The retry the panel offers after its wait timeout
    // starts a SECOND flow that takes that slot, and the abandoned first window
    // can still fail afterwards (the user closes it). Cleaning up
    // unconditionally on that failure deleted the LIVE flow's material, which
    // then died with "No pending authorization request found" — the defect
    // StaleAuthCallbackError already prevents on the exchange path.
    it("leaves a newer flow's pending state intact when an abandoned flow fails", async () => {
      const response = await signInWith(async () => {
        // The user gives up and starts over: flow #2 takes the slot while this
        // window is still open. Only then is this one closed.
        await mockStorage.local.set({
          pkce_verifier: 'verifier-second',
          auth_state: 'state-second',
          redirect_uri: REDIRECT
        });
        throw new Error('The user did not approve access.');
      });

      expect(response).toEqual(expect.objectContaining({ status: 'error' }));

      const after = await mockStorage.local.get(['pkce_verifier', 'auth_state', 'redirect_uri']);
      expect(after.pkce_verifier).toBe('verifier-second');
      expect(after.auth_state).toBe('state-second');
      expect(after.redirect_uri).toBe(REDIRECT);
    });

    // The converse, so the guard above cannot be satisfied by never cleaning up.
    it('clears its own pending state when the flow it started fails', async () => {
      const response = await signInWith(async () => {
        throw new Error('The user did not approve access.');
      });

      expect(response).toEqual(expect.objectContaining({ status: 'error' }));

      const after = await mockStorage.local.get(['pkce_verifier', 'auth_state', 'redirect_uri']);
      expect(after.pkce_verifier).toBeUndefined();
      expect(after.auth_state).toBeUndefined();
      expect(after.redirect_uri).toBeUndefined();
    });

    // RFC 6749 §4.1.3: the token request's redirect_uri must equal the
    // authorization request's. Only initiateDashboardOAuth knows which one that
    // was, so a missing key is a broken pending flow — say so, rather than
    // substituting a literal and letting the server answer with an opaque
    // redirect_uri mismatch.
    it('refuses the exchange when the pending flow has no redirect_uri', async () => {
      await mockStorage.local.set({ pkce_verifier: 'verifier-123', auth_state: 'state-123' });
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const result = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, resolve);
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ success: false }));
      expect(result.error).toMatch(/no pending authorization request/i);
    });

    it('clears a stale refresh_expires_at when the OAuth token response has none', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'v', auth_state: 's',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
        refresh_expires_at: 123 // stale value from a previous session
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'a', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          // NO refresh_expires_in
          user_id: 'u', username: 'x'
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
      await mockStorage.local.set({
        pkce_verifier: 'v', auth_state: 's',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'a', token_type: 'bearer', refresh_token: 'r', user_id: 'u', username: 'x' })
      });

      const res = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'c-invalid', state: 's' }, { id: 'test-copilot-id' }, resolve);
      });

      expect(res.success).toBe(false);
      const stored = await mockStorage.local.get(['access_token']);
      expect(stored.access_token).toBeUndefined();
    });

    it('exchanges an authorization code exactly once when AUTH_CALLBACK double-fires', async () => {
      // Sign-in itself now has a SINGLE ingress — launchWebAuthFlow resolves
      // with the redirect directly, so the old tab-monitor/callback-page race
      // is gone. AUTH_CALLBACK remains wired, and the code is single-use: two
      // deliveries of the same one must still exchange once, or the loser gets
      // a spurious "code already used".
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });

      const mockFetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: PROFILE_RESPONSE });
      global.fetch = mockFetch;

      const fire = () =>
        new Promise<void>((resolve) => {
          listeners['message'](
            { type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
            { id: 'test-copilot-id' },
            () => resolve()
          );
        });

      await Promise.all([fire(), fire()]);

      const tokenCalls = mockFetch.mock.calls.filter((c: any[]) =>
        String(c[0]).endsWith('/auth/oauth/token')
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('gives BOTH racing ingress paths the same success result (loser shares, not errors)', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 't', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          refresh_expires_in: 86400, user_id: 'u1', username: 'a'
        })
      });

      const p1 = signIn({ code: 'code-123' });
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
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
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

    // The PKCE verifier and state live at FIXED storage keys — one slot. The
    // retry the panel offers after its 3-minute wait timeout starts a second
    // flow that overwrites the first, and the abandoned tab can still complete.
    // Its callback then arrives with the SUPERSEDED state, and cleaning up after
    // that failure removed the live flow's verifier: the stale tab died on the
    // mismatch, the live one on "No pending authorization request found".
    it('leaves the pending flow intact when a superseded callback arrives', async () => {
      // Storage holds the SECOND (live) flow; the first tab reports back late.
      await mockStorage.local.set({
        pkce_verifier: 'verifier-second',
        auth_state: 'state-second',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const stale = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-first', state: 'state-first' },
          { id: 'test-copilot-id' }, resolve);
      });

      expect(stale).toEqual(expect.objectContaining({ success: false }));
      expect(mockFetch).not.toHaveBeenCalled();

      // The live flow's PKCE state must still be there — this is the whole point.
      const after = await mockStorage.local.get(['pkce_verifier', 'auth_state']);
      expect(after.pkce_verifier).toBe('verifier-second');
      expect(after.auth_state).toBe('state-second');
    });

    // The converse, so the guard above cannot be satisfied by never cleaning up:
    // a failure that DOES belong to the pending flow must still clear it.
    it('still clears the pending flow when the matching exchange fails', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
        json: async () => ({ detail: 'invalid_grant' })
      });

      const result = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, resolve);
      });

      expect(result).toEqual(expect.objectContaining({ success: false }));
      const after = await mockStorage.local.get(['pkce_verifier', 'auth_state']);
      expect(after.pkce_verifier).toBeUndefined();
      expect(after.auth_state).toBeUndefined();
    });

    it('does not re-exchange the same code after a completed flow (replay rejected)', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 't', token_type: 'bearer', expires_in: 3600, refresh_token: 'r',
          refresh_expires_in: 86400, user_id: 'u1', username: 'a'
        })
      });
      global.fetch = mockFetch;

      // First, complete the flow (evicts the in-flight entry, clears pkce_verifier).
      await new Promise<void>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, () => resolve());
      });
      expect(tokenExchangeCalls(mockFetch)).toBe(1);

      // Replay the same code: must be rejected with no additional token exchange.
      const replay = await new Promise<any>((resolve) => {
        listeners['message']({ type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' }, resolve);
      });
      expect(tokenExchangeCalls(mockFetch)).toBe(1);
      expect(replay).toEqual(expect.objectContaining({ success: false }));
    });

    // copilot#185. /auth/oauth/token returns the flat TokenResponse — no nested
    // `user`. Requiring one made every cloud sign-in fail on
    // `tokens.user.display_name`. The profile must come from /auth/me instead.
    it('completes sign-in on the flat TokenResponse and fills the profile from /auth/me', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });

      const mockFetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: PROFILE_RESPONSE });
      global.fetch = mockFetch;

      await signIn({ code: 'code-123' });

      // The profile read is what supplies display_name/email/roles.
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.faultmaven.ai/api/v1/auth/me',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer new-token-abc' })
        })
      );
      expect(mockAuthSaveState).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-token-abc',
          user: expect.objectContaining({
            user_id: 'user-789',
            username: 'alice',
            email: 'alice@example.com',
            display_name: 'Alice',
            roles: ['user']
          })
        })
      );
    });

    // The AUTH_CALLBACK ingress resolves with this value. It used to echo
    // `tokens.user`, which by this endpoint's contract never exists — so a
    // successful sign-in resolved as { success: true, user: undefined }.
    it('resolves the callback with the profile-built user, not the absent tokens.user', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });
      global.fetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: PROFILE_RESPONSE });

      const result = await new Promise<any>((resolve) => {
        listeners['message'](
          { type: 'AUTH_CALLBACK', code: 'code-123', state: 'state-123' },
          { id: 'test-copilot-id' },
          resolve
        );
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          user: expect.objectContaining({ user_id: 'user-789', display_name: 'Alice' })
        })
      );
    });

    // A degraded profile must never be persisted. Nothing corrects it once
    // stored (auth-service's getCurrentUser feeds the AccountRow display only,
    // never this record) and TokenManager copies it forward on every refresh,
    // so a guessed `roles: ['user']` would
    // silently strip an admin's access for the life of the refresh window.
    // Failing the sign-in costs one retry; the alternative costs up to 7 days.
    it('fails the sign-in when the /auth/me read fails, persisting no session', async () => {
      await mockStorage.local.set({
        pkce_verifier: 'verifier-123',
        auth_state: 'state-123',
        redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
      });

      global.fetch = mockOAuthFetch(TOKEN_RESPONSE, { profile: null });

      await signIn({ code: 'code-123' });

      expect(mockAuthSaveState).not.toHaveBeenCalled();
      const stored = await mockStorage.local.get(['access_token']);
      expect(stored.access_token).toBeUndefined();
    });

    it('refuses a redirect whose state is not the one this flow minted (CSRF)', async () => {
      // launchWebAuthFlow only guarantees the redirect reached THIS extension.
      // It says nothing about which authorization request produced it, so the
      // state still has to be checked against the one we generated.
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      await signIn({ code: 'code-123', stateOverride: 'attacker-chosen-state' });

      // The code is never exchanged.
      expect(mockFetch).not.toHaveBeenCalled();
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

    // copilot#185. This payload was previously stored raw, so a bridge payload
    // without `user` became a persisted authState with `user: undefined` — which
    // every later reader had to survive, and one of them didn't. Reject it whole
    // and write NOTHING, so the user stays logged out and can retry rather than
    // holding a session that breaks the panel on the next render.
    it('rejects a bridge payload with no user and persists nothing', async () => {
      const { user: _omitted, ...noUser } = bridgePayload;

      const result = await storeAuth(noUser);

      expect(result).toEqual(expect.objectContaining({ status: 'error' }));
      expect(mockAuthSaveState).not.toHaveBeenCalled();
      // Critically: no half-written session — the token keys must not land either.
      const stored = await mockStorage.local.get(['access_token', 'refresh_token']);
      expect(stored.access_token).toBeUndefined();
      expect(stored.refresh_token).toBeUndefined();
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

    it('broadcasts auth_state_changed in the { isAuthenticated, user } contract shape', async () => {
      mockBrowser.runtime.sendMessage.mockClear();
      await storeAuth(bridgePayload);

      // Regression: it previously broadcast the raw token payload, whose
      // `isAuthenticated` is undefined, so the side-panel listener set
      // isAuthenticated: undefined.
      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth_state_changed',
          authState: { isAuthenticated: true, user: bridgePayload.user }
        })
      );
      // Must NOT leak the access/refresh tokens into the broadcast.
      const broadcast = mockBrowser.runtime.sendMessage.mock.calls
        .map((c: any[]) => c[0])
        .find((m: any) => m?.type === 'auth_state_changed');
      expect(broadcast.authState.access_token).toBeUndefined();
      expect(broadcast.authState.refresh_token).toBeUndefined();
    });
  });
});
