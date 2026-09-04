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

vi.mock('../../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../config')>()),
  getApiUrl: async () => 'http://localhost:8090',
}));

vi.mock('../../../lib/auth/auth-config', () => ({
  getAuthConfig: async () => ({ provider: 'oidc', mode: 'oauth', features: {} }),
  isLocalAuthMode: async () => false,
  clearAuthConfigCache: async () => {},
}));

vi.mock('../../../lib/cache/case-cache', () => ({
  caseCacheManager: { invalidateCache: vi.fn().mockResolvedValue(undefined) },
}));

import { tokenManager } from '../../../lib/auth/token-manager';
import { authManager } from '../../../lib/auth/auth-manager';
import { createExtensionTransport } from '../../../extension/host/extension-transport';
import { setApiTransport } from '../../../lib/api/transport';
import { authenticatedFetch } from '../../../lib/api/client';
import { AuthenticationError } from '../../../lib/errors/types';
import type { HostSession } from '../../../shared/host';

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
 * Records that the client reported THROUGH the host, then does the host's real
 * teardown.
 *
 * Both halves are needed. The storage assertions alone cannot tell "the client
 * reported and the host tore down" from "the client tore down itself" — the old
 * behaviour called the same function and left the same storage — so without this
 * spy the seam test passes on the previous head, which would make it decoration.
 */
const reportedToHost = vi.fn();

/** The extension's session, assembled exactly as ExtensionApp assembles it. */
function extensionSession(): HostSession {
  return {
    user: { id: 'u1', username: 'op', roles: ['user'] },
    accessToken: async () => {
      const token = await tokenManager.getValidAccessToken();
      if (!token) throw new Error('No valid access token; the session has ended.');
      return token;
    },
    signOut: async () => {},
    onUnauthorized: () => {
      reportedToHost();
      return authManager.clearAllAuthData();
    },
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
    reportedToHost.mockClear();
    lockRequests.length = 0;
    installWebLocks();
    setApiTransport(createExtensionTransport(extensionSession()));
  });

  afterEach(() => {
    delete (navigator as unknown as { locks?: unknown }).locks;
    vi.restoreAllMocks();
  });

  it('refreshes an expired credential under the lock and carries the NEW bearer', async () => {
    // Access token already expired; the refresh credential is still good.
    Object.assign(store, {
      access_token: 'stale-token',
      token_type: 'bearer',
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

    // The seam: the shared client cleared nothing itself, and the EXTENSION's
    // real teardown ran — the credential is gone from storage, refresh included,
    // so a stale grant cannot silently re-authenticate.
    expect(store.authState).toBeUndefined();
    expect(store.access_token).toBeUndefined();
    expect(store.refresh_token).toBeUndefined();
  });
});
