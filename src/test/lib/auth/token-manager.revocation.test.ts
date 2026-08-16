import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from '../../../lib/auth/token-manager';

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

vi.mock('../../../config', () => ({
  __esModule: true,
  default: {},
  getApiUrl: async () => 'https://api.faultmaven.ai',
}));

const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../lib/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

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

    const token = await tokenManager.getValidAccessToken();

    expect(token).toBeNull();
    // The assertion that matters. REFRESH_MAX_ATTEMPTS is 3, so a definitive
    // rejection misclassified as transient would show up here as 3 — and each
    // retry sleeps on an exponential backoff, which is the "spin" a user
    // experiences as a panel wedged on a request that cannot ever succeed.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('destroys the credential rather than preserving it for a retry', async () => {
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await tokenManager.getValidAccessToken();

    // A transient failure deliberately PRESERVES tokens so a blip does not log
    // anyone out. That behaviour is only safe because this case does the
    // opposite: keeping a revoked refresh token would leave the extension
    // re-presenting a dead credential indefinitely instead of converging on
    // the sign-in screen.
    const stored = await mockBrowserStorage.local.get([
      'access_token',
      'refresh_token',
      'refresh_expires_at',
    ]);
    expect(stored.access_token).toBeUndefined();
    expect(stored.refresh_token).toBeUndefined();
    expect(stored.refresh_expires_at).toBeUndefined();
  });

  it('reports not-authenticated afterwards, and stops calling the backend', async () => {
    await seedLiveLookingSession();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => 'invalid_grant',
    });

    await tokenManager.getValidAccessToken();
    (global.fetch as any).mockClear();

    // Convergence, not just a single correct answer: with the credential gone
    // every later call short-circuits on "no tokens stored". Without this the
    // panel would re-attempt a doomed refresh on every interaction.
    expect(await tokenManager.getValidAccessToken()).toBeNull();
    expect(await tokenManager.isAuthenticated()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still preserves tokens when the failure really is transient', async () => {
    // The negative control. Without it, "clears on 401" would also pass if the
    // code cleared on every failure — which would reintroduce the spurious
    // mid-session logouts the retry ladder exists to prevent.
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
