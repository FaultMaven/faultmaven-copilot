/**
 * The seam: a 401 on the shared request path, through the host, and back.
 *
 * Both ends of this were already covered — the client reports to
 * `onUnauthorized` (client.test.ts) and TokenManager refreshes under a lock
 * (token-manager.test.ts) — but nothing drove one into the other. A boundary
 * whose two sides are each tested against a mock of the other is exactly where a
 * signature or a contract can drift silently, so this test uses the REAL
 * TokenManager, the REAL AuthManager and the REAL extension transport, with only
 * the network and extension storage stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stateful extension storage: the refresh writes tokens the next read must see.
const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        }),
      },
    },
  },
}));

vi.mock('@faultmaven/copilot-ui/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/config')>()),
  getApiUrl: async () => 'http://localhost:8090',
}));

vi.mock('../../../extension/auth/auth-config', () => ({
  getAuthConfig: async () => ({ provider: 'oidc', mode: 'oauth', features: {} }),
  isLocalAuthMode: async () => false,
  clearAuthConfigCache: async () => {},
}));

vi.mock('@faultmaven/copilot-ui/lib/cache/case-cache', () => ({
  caseCacheManager: { invalidateCache: vi.fn().mockResolvedValue(undefined), fence: vi.fn() },
}));

import { authManager } from '../../../extension/auth/auth-manager';
import { endSessionOnRejectedCredential, readSessionAccessToken } from '../../../extension/host/session-credential';
import { createExtensionTransport } from '../../../extension/host/extension-transport';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { authenticatedFetch } from '@faultmaven/copilot-ui/lib/api/client';
import { AuthenticationError, CredentialUnavailableError } from '@faultmaven/copilot-ui/lib/errors/types';
import type { HostSession } from '@faultmaven/copilot-ui/shared/host';

const lockRequests: string[] = [];

/** A real cross-context mutex, so the single-flight path under test is the locked one. */
function installWebLocks() {
  const held = new Map<string, Promise<unknown>>();
  (navigator as unknown as { locks: unknown }).locks = {
    // Real signature: request(name, callback) OR request(name, options, callback).
    async request(name: string, a: unknown, b?: unknown) {
      lockRequests.push(name);
      const fn = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
      const prior = held.get(name) ?? Promise.resolve();
      const run = prior.then(fn, fn);
      held.set(name, run.catch(() => {}));
      return run;
    },
  };
}

/**
 * Records that the client reported THROUGH the host, and lets the host's real
 * teardown run.
 *
 * Both halves are needed. The storage assertions alone cannot tell "the client
 * reported and the host tore down" from "the client tore down itself" — the old
 * behaviour called the same function and left the same storage — so without this
 * spy the seam test passes on the previous head, which would make it decoration.
 *
 * A spy on the teardown, not on `HostSession.onUnauthorized`: the extension's
 * transport reports a 401 straight to its act-site WITH the rejected bearer
 * (copilot#346), which that session signature cannot carry.
 */
let reportedToHost: ReturnType<typeof vi.spyOn>;

/** The extension's session, assembled exactly as ExtensionApp assembles it. */
function extensionSession(): HostSession {
  return {
    user: { id: 'u1', username: 'op', roles: ['user'] },
    // The real thing, not a mirror — see host/session-credential.ts.
    accessToken: () => readSessionAccessToken('u1'),
    signOut: async () => {},
    subscribeAuthState: () => () => {},
    onUnauthorized: () => endSessionOnRejectedCredential(null, null),
  };
}

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('401 → host → refresh → retry, across the real seam', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    reportedToHost = vi.spyOn(authManager, 'clearAllAuthData');
    lockRequests.length = 0;
    installWebLocks();
    setApiTransport(createExtensionTransport(extensionSession()));
  });

  afterEach(() => {
    delete (navigator as unknown as { locks?: unknown }).locks;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // The access token spent and the refresh endpoint down (faultmaven#1460).
  // The credential is kept, so the request is not sent: sent with no bearer,
  // its 401 read as an expired session, "Sign in first".
  it('keeps the session through a transient refresh failure, and sends nothing', async () => {
    vi.useFakeTimers();
    Object.assign(store, {
      access_token: 'stale-token',
      token_type: 'bearer',
      user: { user_id: 'u1' },
      expires_at: Date.now() - 60_000,
      refresh_token: 'good-refresh',
      refresh_expires_at: Date.now() + 86_400_000,
    });
    const refused = (status: number) =>
      ({ ok: false, status, headers: new Headers(), json: async () => ({}), text: async () => '{}' }) as unknown as Response;
    global.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/oauth/token')) return refused(503);
      // The server refuses a request that carries no bearer.
      return new Headers(init.headers as HeadersInit).has('Authorization')
        ? (ok({ fine: true }) as unknown as Response)
        : refused(401);
    }) as unknown as typeof fetch;

    const failure = authenticatedFetch('/api/v1/whatever').catch((error: unknown) => error);
    // The refresh ladder's backoff between its three attempts.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await failure).toBeInstanceOf(CredentialUnavailableError);
    const sent = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
    expect(sent.filter((u) => u.includes('/oauth/token'))).toHaveLength(3);
    expect(sent.filter((u) => u.includes('/api/v1/whatever'))).toHaveLength(0);
    expect(reportedToHost).not.toHaveBeenCalled();
    expect(store).toMatchObject({ access_token: 'stale-token', refresh_token: 'good-refresh' });
  });

  it('refreshes an expired credential under the lock and carries the NEW bearer', async () => {
    // Access token already expired; the refresh credential is still good.
    Object.assign(store, {
      access_token: 'stale-token',
      token_type: 'bearer',
      // Every writer stores the owner beside the token (#350).
      user: { user_id: 'u1' },
      expires_at: Date.now() - 60_000,
      refresh_token: 'good-refresh',
      refresh_expires_at: Date.now() + 86_400_000,
    });

    const calls: Array<{ url: string; auth?: string }> = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      const auth = new Headers(init.headers as HeadersInit).get('Authorization') ?? undefined;
      calls.push({ url: String(url), auth: auth ?? undefined });
      if (String(url).includes('/auth/oauth/token')) {
        return ok({
          access_token: 'fresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'rotated-refresh',
        }) as unknown as Response;
      }
      return ok({ fine: true }) as unknown as Response;
    }) as unknown as typeof fetch;

    const response = await authenticatedFetch('/api/v1/whatever');
    expect(response.ok).toBe(true);

    // The refresh actually happened, through the real TokenManager...
    expect(calls.some((c) => c.url.includes('/auth/oauth/token'))).toBe(true);
    // ...the rotated credential was persisted...
    expect(store.access_token).toBe('fresh-token');
    expect(store.refresh_token).toBe('rotated-refresh');
    // ...and the request carried the NEW bearer, not the stale one.
    const apiCall = calls.find((c) => c.url.includes('/api/v1/whatever'));
    expect(apiCall?.auth).toBe('Bearer fresh-token');
  });

  it('single-flights the refresh: N concurrent requests, ONE refresh', async () => {
    Object.assign(store, {
      access_token: 'stale-token',
      token_type: 'bearer',
      // Every writer stores the owner beside the token (#350).
      user: { user_id: 'u1' },
      expires_at: Date.now() - 60_000,
      refresh_token: 'good-refresh',
      refresh_expires_at: Date.now() + 86_400_000,
    });

    let refreshes = 0;
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/oauth/token')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return ok({
          access_token: 'fresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'rotated-refresh',
        }) as unknown as Response;
      }
      return ok({ fine: true }) as unknown as Response;
    }) as unknown as typeof fetch;

    await Promise.all([
      authenticatedFetch('/api/v1/a'),
      authenticatedFetch('/api/v1/b'),
      authenticatedFetch('/api/v1/c'),
    ]);

    // The refresh grant is single-use: a second rotation would invalidate the
    // first and sign the user out. One refresh, three requests.
    expect(refreshes).toBe(1);
    // And it was serialised by the CROSS-CONTEXT lock, not merely by the
    // in-context promise dedup. Only the lock also excludes the background
    // worker, which is the case that actually rotates a grant twice.
    expect(lockRequests).toContain('faultmaven-token-refresh');
  });

  it('reports a rejected credential to the host, which tears it down for real', async () => {
    Object.assign(store, {
      access_token: 'live-token',
      token_type: 'bearer',
      // Every writer stores the owner beside the token (#350).
      user: { user_id: 'u1' },
      expires_at: Date.now() + 3_600_000,
      refresh_token: 'revoked-refresh',
      refresh_expires_at: Date.now() + 86_400_000,
      authState: { access_token: 'live-token', token_type: 'bearer', expires_at: Date.now() + 3_600_000 },
    });

    global.fetch = vi.fn(async () =>
      ({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ detail: 'Unauthorized' }),
        text: async () => '{"detail":"Unauthorized"}',
      }) as unknown as Response,
    ) as unknown as typeof fetch;

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(AuthenticationError);

    // The client went through the host rather than reaching for the credential.
    expect(reportedToHost).toHaveBeenCalledTimes(1);
    // ...judged against the bearer the rejected request carried (#346).
    // ...and the user the panel built the request for.
    expect(reportedToHost).toHaveBeenCalledWith({ accessToken: 'live-token', userId: 'u1' });

    // The seam: the shared client cleared nothing itself, and the EXTENSION's
    // real teardown ran — the credential is gone from storage, refresh included,
    // so a stale grant cannot silently re-authenticate.
    expect(store.authState).toBeUndefined();
    expect(store.access_token).toBeUndefined();
    expect(store.refresh_token).toBeUndefined();
  });

  it('ends the session when the REFRESH is definitively rejected, through the real chain', async () => {
    // THE ORIGINAL BUG, end to end, with real modules.
    //
    // A sign-out on another client writes an account-wide revocation watermark;
    // this client finds out when its next proactive refresh is refused. The
    // credential keys were cleared and `authState` was not — and nothing
    // observes the credential keys, so the panel went on rendering a signed-in
    // UI over the previous user's conversations, indefinitely.
    //
    // The two halves of the fix are pinned separately with mocks (the act-site
    // calls the teardown; the teardown removes the row). Neither notices if the
    // halves stop meeting, which is what this covers: TokenManager reports, the
    // host acts, and the row is gone.
    Object.assign(store, {
      access_token: 'expiring-token',
      token_type: 'bearer',
      // Every writer stores the owner beside the token (#350).
      user: { user_id: 'u1' },
      // Inside the proactive-refresh window, so the request path refreshes.
      expires_at: Date.now() + 60_000,
      refresh_token: 'revoked-by-the-watermark',
      refresh_expires_at: Date.now() + 86_400_000,
      authState: { access_token: 'expiring-token', token_type: 'bearer' },
    });

    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/refresh') || String(url).includes('/oauth/token')) {
        // RFC 6749 §5.2 for a revoked refresh token: definitive, not a blip.
        return {
          ok: false,
          status: 400,
          headers: new Headers(),
          json: async () => ({ error: 'invalid_grant' }),
          text: async () => '{"error":"invalid_grant"}',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        text: async () => '{}',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    // The verdict reaches the CALLER, rather than being swallowed into a
    // header-less request whose 401 reads as a transient one, credential kept.
    // `SessionEndedError` extends the package's `AuthenticationError`, which is
    // the vocabulary `getAuthHeaders` branches on.
    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    // And the doomed request was never sent: only the refresh attempt went out.
    const sent = (global.fetch as any).mock.calls.map(([url]: [string]) => String(url));
    expect(sent.filter((u: string) => u.includes('/api/v1/whatever'))).toHaveLength(0);

    // The row is what anything observes — its absence IS the sign-out.
    expect(store.authState).toBeUndefined();
    expect(store.access_token).toBeUndefined();
    expect(store.refresh_token).toBeUndefined();
  });
});
