import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from '../../../extension/auth/token-manager';
import { SessionEndedError } from '../../../extension/auth/session-ended-error';

/**
 * What happens to this client when the OTHER one signs out.
 *
 * Deliberate sign-out is account-scoped (faultmaven#1065): it revokes every
 * token for the user, on both chains. So a Dashboard sign-out kills the
 * extension's refresh token while the panel is still open, and the extension
 * finds out only when it next reaches the backend.
 *
 * The existing suite covers a refresh token this client can see is expired.
 * This covers the one it cannot: still-live locally, rejected by the server.
 * That path had no test, so "it converges without spinning" was reasoning
 * rather than a fact.
 */

vi.mock('@faultmaven/copilot-ui/config', () => ({
  __esModule: true,
  default: {},
  getApiUrl: async () => 'https://api.faultmaven.ai',
}));

const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../extension/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

const { mockBrowserStorage } = vi.hoisted(() => {
  let store: Record<string, any> = {};
  return {
    mockBrowserStorage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, any> = {};
          keys.forEach((k) => {
            if (store[k] !== undefined) out[k] = store[k];
          });
          return out;
        }),
        set: vi.fn(async (obj: Record<string, any>) => {
          store = { ...store, ...obj };
        }),
        remove: vi.fn(async (keys: string[]) => {
          keys.forEach((k) => delete store[k]);
        }),
        __reset: () => {
          store = {};
        },
      },
    },
  };
});

vi.mock('wxt/browser', () => ({ browser: { storage: mockBrowserStorage } }));

// Every block below replaces `global.navigator` (to exercise the in-context
// refresh fallback rather than the Web Locks path) and `global.fetch`. Restore
// both, or jsdom's navigator stays clobbered for anything that runs after —
// the sibling token-manager.test.ts restores; this file did not.
const realNavigator = globalThis.navigator;
const realFetch = globalThis.fetch;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'navigator', {
    value: realNavigator,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = realFetch;
});

/** A refresh token this client believes is good: access token expiring inside
 *  the 5-minute window, refresh window wide open. Only the server knows it was
 *  revoked. */
async function seedLiveLookingSession() {
  await mockBrowserStorage.local.set({
    access_token: 'access-token',
    token_type: 'bearer',
    expires_at: Date.now() + 2 * 60 * 1000,
    refresh_token: 'revoked-refresh-token',
    refresh_expires_at: Date.now() + 60 * 60 * 1000,
  });
}

describe('TokenManager — refresh against a revoked token', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    global.fetch = vi.fn();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();

    // No Web Locks: exercise the in-context fallback, which is the path with
    // no cross-context serialization to mask a retry ladder.
    (global as any).navigator = {};
  });

  it('gives up after exactly one attempt — a revoked token is not a blip', async () => {
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);

    // The assertion that matters. REFRESH_MAX_ATTEMPTS is 3, so a definitive
    // rejection misclassified as transient would show up here as 3 — and each
    // retry sleeps on an exponential backoff, which is the "spin" a user
    // experiences as a panel wedged on a request that cannot ever succeed.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('REPORTS the death rather than performing the teardown itself', async () => {
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);

    // This used to assert the credential was destroyed HERE. It is not, and the
    // change is the point: answering `null` for both "dead" and "blip" is what
    // forced the teardown inside this class, where it ran in the refresh lock,
    // in the refresh verdict, and during logout's own authenticated call. The
    // host acts on the throw — see ExtensionApp.accessToken.
    const stored = await mockBrowserStorage.local.get(['access_token', 'refresh_token']);
    expect(stored.access_token).toBe('access-token');
    expect(stored.refresh_token).toBe('revoked-refresh-token');
  });

  it('keeps reporting it, so a host that has not yet acted is told every time', async () => {
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);
    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);

    // Convergence is a property of the PAIR, not of this class alone. Simulate
    // the host acting on the throw; only then does it go quiet. Silently
    // answering null here instead would leave a host that missed the first
    // report with nothing to act on and no way to learn.
    await tokenManager.clearTokens();
    (global.fetch as any).mockClear();

    expect(await tokenManager.getValidAccessToken()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stops calling the backend once the host has torn the session down', async () => {
    // The convergence invariant. TokenManager no longer clears anything itself,
    // so "it stops re-attempting a doomed refresh" is now a property of the
    // PAIR — and if the host's teardown ever fails to stick, every later request
    // is another doomed refresh. Nothing else pins that this terminates.
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);

    // The host acts on that verdict.
    await tokenManager.clearTokens();
    (global.fetch as any).mockClear();

    expect(await tokenManager.getValidAccessToken()).toBeNull();
    expect(await tokenManager.isAuthenticated()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still preserves tokens when the failure really is transient', async () => {
    // The negative control. Without it, "throws on 401" would also pass if the
    // code threw on every failure — reintroducing the spurious mid-session
    // logouts the retry ladder exists to prevent.
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
      text: async () => 'unavailable',
    });

    const token = await tokenManager.getValidAccessToken();

    // Access token still has ~2 minutes, so the request can still succeed.
    expect(token).toBe('access-token');
    const stored = await mockBrowserStorage.local.get(['refresh_token']);
    expect(stored.refresh_token).toBe('revoked-refresh-token');
    expect((global.fetch as any).mock.calls.length).toBeGreaterThan(1);
  }, 20_000);
});

/**
 * Reporting a dead chain, and NOT acting on it.
 *
 * TokenManager discovers that a session is over — it presents the refresh token
 * and hears the backend refuse it — but it does not end one. It answers `null`
 * for "nothing usable right now" (transient: the request goes out header-less
 * and recovers) and throws SessionEndedError for "definitively dead". The host
 * acts on the latter, in ExtensionApp.accessToken().
 *
 * Collapsing both into `null` is what forced the teardown to live in here,
 * where it ran inside the refresh lock, inside the refresh verdict, and during
 * logout's own authenticated call.
 */
describe('TokenManager — reports a dead chain, does not act on it', () => {
  let tokenManager: TokenManager;

  async function seedSession(overrides: Record<string, any> = {}) {
    await mockBrowserStorage.local.set({
      access_token: 'access-token',
      token_type: 'bearer',
      expires_at: Date.now() + 2 * 60 * 1000,
      refresh_token: 'the-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'a-session',
      user: { user_id: 'user-a' },
      ...overrides,
    });
  }

  function rejectRefreshDefinitively() {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    global.fetch = vi.fn();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();
    (global as any).navigator = {};
  });

  it('throws SessionEndedError when the refresh is definitively rejected', async () => {
    await seedSession();
    rejectRefreshDefinitively();

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);
    // Reporting only: the credential is still there for the host to tear down.
    expect((await mockBrowserStorage.local.get(['refresh_token'])).refresh_token)
      .toBe('the-refresh-token');
  });

  it('throws when there is no refresh token and the access token is spent', async () => {
    await seedSession({ refresh_token: undefined, expires_at: Date.now() - 1000 });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);
  });

  it('spends the remaining access-token life when there is no refresh token', async () => {
    // A valid access token with no refresh token is a supported, deliberately
    // written state (bridge and local login both remove the key when a response
    // carries none). Entering at <5 min remaining and tearing down immediately
    // signs the user out up to five minutes early.
    await seedSession({ refresh_token: undefined });

    expect(await tokenManager.getValidAccessToken()).toBe('access-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('spends the remaining access-token life when the refresh window closes', async () => {
    await seedSession({ refresh_expires_at: Date.now() - 1000 });

    expect(await tokenManager.getValidAccessToken()).toBe('access-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('presents a held refresh token past its window rather than ruling it dead', async () => {
    // A closed window is a reason not to spend the access token's remaining life
    // on a refresh. It is NOT a reason to declare the session dead: the backend
    // is the authority on its own credential, and ruling locally meant a window
    // that lapsed while the backend was merely DOWN answered `dead` on every
    // later read — tearing down a session the outage handling had just preserved.
    await seedSession({ expires_at: Date.now() - 1000, refresh_expires_at: Date.now() - 1000 });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'renewed-anyway',
        token_type: 'bearer',
        expires_in: 900,
        refresh_token: 'rotated',
      }),
    });

    expect(await tokenManager.getValidAccessToken()).toBe('renewed-anyway');
  });

  it('ends the session when the backend refuses that held token', async () => {
    await seedSession({ expires_at: Date.now() - 1000, refresh_expires_at: Date.now() - 1000 });
    rejectRefreshDefinitively();

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);
  });

  it('throws only when there is nothing to present and nothing to present it with', async () => {
    await seedSession({ expires_at: Date.now() - 1000, refresh_token: undefined });

    await expect(tokenManager.getValidAccessToken()).rejects.toThrow(SessionEndedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('outage protection is DURABLE, not one call deep', async () => {
    // The hole this closes. An earlier version special-cased the outage in the
    // post-ladder arm, so the preserved session was ruled `dead` by the very
    // next credential read — including the one inside the failing request's own
    // recovery path (header-less 401 → refreshSession → createSession →
    // getAuthHeaders → here). The protection lasted exactly one call.
    await seedSession({
      expires_at: Date.now() - 1000,
      refresh_expires_at: Date.now() - 1000,
    });
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
      text: async () => 'unavailable',
    });

    // Three consecutive reads, as the recovery path would make.
    for (let i = 0; i < 3; i++) {
      await expect(tokenManager.getValidAccessToken()).resolves.toBeNull();
    }
    // And the credential is still there for the backend to rule on later.
    expect((await mockBrowserStorage.local.get(['refresh_token'])).refresh_token)
      .toBe('the-refresh-token');
  }, 60_000);

  it('treats an ABSENT refresh window as open, not as long-expired', async () => {
    // `null <= Date.now()` is true — null coerces to 0 — so a bare comparison
    // read "no window recorded" as "expired in 1970". isAuthenticated() guarded
    // the same field differently, and the two disagreed about identical storage.
    await seedSession({ refresh_expires_at: null });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access-token',
        token_type: 'bearer',
        expires_in: 900,
        refresh_token: 'fresh-refresh-token',
      }),
    });

    expect(await tokenManager.getValidAccessToken()).toBe('fresh-access-token');
  });

  it('answers null — not a session verdict — when the failure is transient', async () => {
    // The negative control. Widening the terminal paths without it is how a
    // spurious logout ships.
    await seedSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
      text: async () => 'unavailable',
    });

    expect(await tokenManager.getValidAccessToken()).toBe('access-token');
    expect((await mockBrowserStorage.local.get(['refresh_token'])).refresh_token)
      .toBe('the-refresh-token');
  }, 20_000);

  it('refuses a token too near expiry to survive the round trip', async () => {
    // `> 0` was satisfied by a millisecond, and a request carrying a bearer that
    // 401s routes to the HARD teardown — the opposite of this branch's intent.
    await seedSession({ expires_at: Date.now() + 1500 });
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
      text: async () => 'unavailable',
    });

    expect(await tokenManager.getValidAccessToken()).toBeNull();
  }, 20_000);
});

/**
 * Races between a refresh in flight and a sign-in that completes during it.
 *
 * A verdict reached about the OLD chain must not be applied to the new one.
 */
describe('TokenManager — a sign-in landing mid-refresh', () => {
  let tokenManager: TokenManager;

  async function seedSession(overrides: Record<string, any> = {}) {
    await mockBrowserStorage.local.set({
      access_token: 'a-access-token',
      token_type: 'bearer',
      expires_at: Date.now() + 2 * 60 * 1000,
      refresh_token: 'a-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
      session_id: 'a-session',
      user: { user_id: 'user-a' },
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    global.fetch = vi.fn();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();
    (global as any).navigator = {};
  });

  it('does not report a dead chain when the sign-in REMOVED the refresh token', async () => {
    // Guarding with `current && current !== presented` read that absence as
    // "still ours" and condemned the session that had just replaced ours.
    await seedSession();
    (global.fetch as any).mockImplementation(async () => {
      await mockBrowserStorage.local.set({
        access_token: 'b-access-token',
        expires_at: Date.now() + 60 * 60 * 1000,
      });
      await mockBrowserStorage.local.remove(['refresh_token']);
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'invalid_grant' }),
        text: async () => 'invalid_grant',
      };
    });

    expect(await tokenManager.getValidAccessToken()).toBe('b-access-token');
  });

  it('does not stamp the previous identity back over a session established mid-refresh', async () => {
    // The SUCCESS path, and the worse failure. The backend has no reason to
    // reject A's chain because B signed in, so a 200 is the EXPECTED outcome of
    // this race — and every field written comes from the pre-flight snapshot,
    // `session_id`, `user` and `authState.user` included.
    await seedSession();
    (global.fetch as any).mockImplementation(async () => {
      await mockBrowserStorage.local.set({
        access_token: 'b-access-token',
        expires_at: Date.now() + 60 * 60 * 1000,
        refresh_token: 'b-refresh-token',
        session_id: 'b-session',
        user: { user_id: 'user-b' },
      });
      return {
        ok: true,
        json: async () => ({
          access_token: 'a-rotated-access-token',
          token_type: 'bearer',
          expires_in: 900,
          refresh_token: 'a-rotated-refresh-token',
        }),
      };
    });

    expect(await tokenManager.getValidAccessToken()).toBe('b-access-token');
    const stored = await mockBrowserStorage.local.get([
      'refresh_token', 'session_id', 'user',
    ]);
    expect(stored.refresh_token).toBe('b-refresh-token');
    expect(stored.session_id).toBe('b-session');
    expect(stored.user).toEqual({ user_id: 'user-b' });
  });

  it('does not report a dead chain when the refresh token vanishes before the lock is held', async () => {
    await seedSession();
    const live = {
      access_token: 'a-access-token',
      token_type: 'bearer',
      expires_at: Date.now() + 2 * 60 * 1000,
      refresh_token: 'a-refresh-token',
      refresh_expires_at: Date.now() + 60 * 60 * 1000,
    };
    // Read 1 is getValidAccessToken's; read 2 is performRefreshOnce's, inside
    // the lock, by which time the sign-in has removed the credential.
    vi.spyOn(tokenManager as any, 'getStoredTokens')
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({ ...live, refresh_token: undefined });

    await expect(tokenManager.getValidAccessToken()).resolves.not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

/**
 * The two readers must never disagree about the same storage.
 *
 * This is the invariant the whole design exists for. `getValidAccessToken` and
 * `isAuthenticated` both used to derive liveness themselves, and for
 * `{access_token, no expires_at, no refresh_token}` one answered "present it and
 * let the backend rule" while the other answered "not valid" — a divergence that
 * `getAuthState()` then escalated into destroying a working credential.
 *
 * A matrix rather than one case, because the failures kept arriving one storage
 * shape at a time: a NaN window, an absent window, a missing expiry, a bridge
 * payload with no refresh material.
 */
describe('TokenManager — one verdict, no second opinion', () => {
  let tokenManager: TokenManager;

  const SHAPES: Array<[string, Record<string, any>]> = [
    ['live token, live refresh', {
      access_token: 't', expires_at: Date.now() + 3600_000,
      refresh_token: 'r', refresh_expires_at: Date.now() + 86400_000,
    }],
    ['expiring token, live refresh', {
      access_token: 't', expires_at: Date.now() + 60_000,
      refresh_token: 'r', refresh_expires_at: Date.now() + 86400_000,
    }],
    ['live token, no refresh material at all', {
      access_token: 't', expires_at: Date.now() + 3600_000,
    }],
    // The shape that broke it. Reachable: handleStoreAuth validates only
    // access_token and user.user_id, so a bridge payload can carry neither an
    // expiry nor refresh material.
    ['no measurable expiry, no refresh token', { access_token: 't' }],
    ['no measurable expiry, with refresh token', {
      access_token: 't', refresh_token: 'r',
    }],
    ['NaN refresh window', {
      access_token: 't', expires_at: Date.now() + 60_000,
      refresh_token: 'r', refresh_expires_at: NaN,
    }],
    ['null refresh window (Chrome flattens NaN)', {
      access_token: 't', expires_at: Date.now() + 60_000,
      refresh_token: 'r', refresh_expires_at: null,
    }],
    ['spent token, closed refresh window', {
      access_token: 't', expires_at: Date.now() - 1000,
      refresh_token: 'r', refresh_expires_at: Date.now() - 1000,
    }],
    ['nothing stored', {}],
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    // Any refresh attempt succeeds, so a `refreshable` verdict resolves to a
    // token rather than to a network failure this matrix is not about.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'refreshed', token_type: 'bearer', expires_in: 900,
        refresh_token: 'rotated',
      }),
    });
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();
    (global as any).navigator = {};
  });

  it.each(SHAPES)('agrees with itself for: %s', async (_label, stored) => {
    await mockBrowserStorage.local.set(stored);

    const authenticated = await tokenManager.isAuthenticated();

    let hasToken: boolean;
    try {
      hasToken = (await tokenManager.getValidAccessToken()) !== null;
    } catch (error) {
      // A session verdict is the one answer that is NOT "no token right now".
      expect(error).toBeInstanceOf(SessionEndedError);
      hasToken = false;
    }

    // The contract: isAuthenticated() is true exactly when getValidAccessToken
    // can produce something. Any storage shape where these differ is a shape
    // where getAuthState() would destroy a credential the request path is
    // still using.
    expect(hasToken).toBe(authenticated);
  });
});

/**
 * An unmeasurable expiry must HEAL, not become permanent.
 *
 * The agreement matrix above covers this shape and passes either way — it asks
 * whether the two readers agree, not whether anything gets better. A verdict of
 * `usable` for an unmeasurable expiry WITH a refresh token means no refresh is
 * ever attempted: the stale token is presented until the backend 401s, and a 401
 * carrying a bearer is the hard teardown, which destroys the valid refresh token
 * that would have renewed the session.
 *
 * This shape is written deliberately by both credential writers (no expiry beats
 * a NaN one), so it is not a corner case — it is the normal state after a login
 * response without a usable `expires_in`.
 */
describe('TokenManager — an unmeasurable expiry heals', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();
    (global as any).navigator = {};
  });

  it('refreshes when a refresh token is available, and writes a real expiry', async () => {
    await mockBrowserStorage.local.set({
      access_token: 'stale-token',
      token_type: 'bearer',
      refresh_token: 'the-refresh-token',
      // No expires_at at all — the shape the writers now produce.
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'healed-token',
        token_type: 'bearer',
        expires_in: 900,
        refresh_token: 'rotated',
      }),
    });

    expect(await tokenManager.getValidAccessToken()).toBe('healed-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Healed permanently: the next call has a measurable expiry and needs no
    // network at all.
    const stored = await mockBrowserStorage.local.get(['expires_at']);
    expect(typeof stored.expires_at).toBe('number');
    (global.fetch as any).mockClear();
    expect(await tokenManager.getValidAccessToken()).toBe('healed-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('presents the token untouched when there is nothing to refresh with', async () => {
    // The other half of the policy. We cannot rule on it and there is no way to
    // learn more locally, so let the backend rule rather than destroying a
    // session that may be perfectly good.
    await mockBrowserStorage.local.set({
      access_token: 'unmeasurable-token',
      token_type: 'bearer',
    });
    global.fetch = vi.fn();

    expect(await tokenManager.getValidAccessToken()).toBe('unmeasurable-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

/**
 * An early return must never disagree with the terminal branch below it.
 *
 * `assess()` answers the unmeasurable-expiry case before it reaches the terminal
 * logic, and that early return gated on `canRefresh` — which additionally
 * requires an OPEN refresh window. So a held refresh token past its window fell
 * through to `usable`: the stale access token presented on every request
 * forever, no refresh ever attempted, and the first 401 carrying that bearer
 * routed to the HARD teardown, destroying the credential the backend would
 * still have honoured. The terminal branch answers `refreshable` for exactly
 * that shape; the early return has to agree with it.
 */
describe('TokenManager — the unmeasurable-expiry branch agrees with the terminal one', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockBrowserStorage.local as any).__reset();
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    tokenManager = new TokenManager();
    (global as any).navigator = {};
  });

  it('refreshes a held token with no expiry AND a closed window', async () => {
    // Reachable from a local login whose response carries `refresh_expires_in`
    // but no usable `expires_in`: the writer stores the window and omits the
    // expiry, and the window later closes.
    await mockBrowserStorage.local.set({
      access_token: 'stale',
      token_type: 'bearer',
      refresh_token: 'held-past-its-window',
      refresh_expires_at: Date.now() - 1000,
      // no expires_at
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'healed', token_type: 'bearer', expires_in: 900,
        refresh_token: 'rotated',
      }),
    });

    expect(await tokenManager.getValidAccessToken()).toBe('healed');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still presents it when there is genuinely nothing to refresh with', async () => {
    await mockBrowserStorage.local.set({
      access_token: 'unmeasurable', token_type: 'bearer',
    });
    global.fetch = vi.fn();

    expect(await tokenManager.getValidAccessToken()).toBe('unmeasurable');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
