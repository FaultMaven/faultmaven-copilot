/**
 * A teardown ends the session its verdict was about — never a newer one
 * (copilot#346).
 *
 * Two shapes of the same race, both pre-existing:
 *
 * - A STALE VERDICT. The chain is ruled dead (or the API answers 401) for
 *   credential A; a sign-in writes credential B; the teardown then runs and
 *   removes B — the user who just signed in is signed out by a verdict about
 *   the session before theirs.
 * - A REFRESH UNDOING A SIGN-OUT. The refresh's compare-and-swap passes, the
 *   sign-out removes everything, and the refresh's write then puts the
 *   departing user's credentials and row back.
 *
 * Driven against the REAL auth manager, token manager and act-site over one
 * in-memory storage, with the interleaving forced rather than hoped for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store, mockStorage } = vi.hoisted(() => {
  type Keys = string | string[] | null | undefined;
  const store: Record<string, unknown> = {};
  const read = (keys: Keys) => {
    if (keys == null) return { ...store };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (store[k] !== undefined) out[k] = store[k];
    return out;
  };
  const write = async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  };
  const mockStorage = {
    local: {
      read,
      write,
      get: vi.fn(async (keys: Keys) => read(keys)),
      set: vi.fn(write),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      }),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  return { store, mockStorage };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockStorage,
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), onMessage: { addListener: vi.fn() } },
  },
}));

const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../extension/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

import { authManager } from '../../../extension/auth/auth-manager';
import { tokenManager } from '../../../extension/auth/token-manager';
import { readSessionAccessToken } from '../../../extension/host/session-credential';
import { createExtensionTransport } from '../../../extension/host/extension-transport';
import type { HostSession } from '@faultmaven/copilot-ui/shared/host';
import { withSessionWriteLock } from '../../../extension/auth/session-write-lock';
import { SessionEndedError } from '../../../extension/auth/session-ended-error';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';

const API = 'https://api.example.test';

/** A Web Locks stand-in: exclusive per name, and honours `signal`. */
function installWebLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn(
    (name: string, opts: { signal?: AbortSignal }, work: () => Promise<unknown>) => {
      const prev = tails.get(name) ?? Promise.resolve();
      let granted = false;
      const run = new Promise<unknown>((resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          if (!granted) reject(new DOMException('aborted', 'AbortError'));
        });
        prev.then(
          () => {
            if (opts?.signal?.aborted) return;
            granted = true;
            work().then(resolve, reject);
          },
          () => undefined,
        );
      });
      tails.set(name, run.then(() => undefined, () => undefined));
      return run;
    },
  );
  Object.defineProperty(global.navigator, 'locks', { value: { request }, configurable: true });
}

function removeWebLocks() {
  Object.defineProperty(global.navigator, 'locks', { value: undefined, configurable: true });
}

async function settle(turns = 20) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

const SESSION_A = {
  authState: { access_token: 'a-access', user: { user_id: 'user-a' } },
  access_token: 'a-access',
  token_type: 'bearer',
  user: { user_id: 'user-a' },
};

const SESSION_B = {
  authState: { access_token: 'b-access', expires_at: Date.now() + 3600000, user: { user_id: 'user-b' } },
  access_token: 'b-access',
  token_type: 'bearer',
  expires_at: Date.now() + 3600000,
  refresh_token: 'b-refresh',
  user: { user_id: 'user-b' },
};

/** The SAME user's session with a newer credential — a rotation, or a re-sign-in. */
const SESSION_A2 = {
  authState: { access_token: 'a2-access', expires_at: Date.now() + 3600000, user: { user_id: 'user-a' } },
  access_token: 'a2-access',
  token_type: 'bearer',
  expires_at: Date.now() + 3600000,
  refresh_token: 'a2-refresh',
  user: { user_id: 'user-a' },
};

/** A sign-in, written the way every real sign-in writer writes. */
const signInB = () => withSessionWriteLock(() => mockStorage.local.set({ ...SESSION_B }));
const signInA2 = () => withSessionWriteLock(() => mockStorage.local.set({ ...SESSION_A2 }));

/** The panel's session, as the extension's transport is built from it. */
const panelFor = (userId: string) =>
  ({ user: { id: userId }, onUnauthorized: async () => 'ended' as const }) as unknown as HostSession;

describe.each([
  ['Web Locks', installWebLocks],
  ['the in-context fallback (no Web Locks)', removeWebLocks],
])('teardown vs a newer session, under %s', (_label, installLocks) => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.clearAllMocks();
    mockStorage.local.get.mockImplementation(async (keys) => mockStorage.local.read(keys));
    mockStorage.local.set.mockImplementation(mockStorage.local.write);
    installLocks();
    setHostStore({
      get: (keys) => mockStorage.local.get(keys),
      set: (items) => mockStorage.local.set(items),
      remove: (keys) => mockStorage.local.remove(keys),
      subscribe: () => () => {},
    });
    setHostEndpoints({
      apiUrl: async () => API,
      dashboardUrl: async () => 'https://dashboard.example.test',
      subscribe: () => () => {},
    });
    mockGetAuthConfig.mockResolvedValue({ provider: 'oidc' });
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeWebLocks();
  });

  it("a teardown judged on A stands down when A's own session holds a newer credential", async () => {
    Object.assign(store, SESSION_A2);

    const outcome = await authManager.clearAllAuthData({ accessToken: 'a-access', userId: 'user-a' });

    expect(outcome).toBe('superseded');
    expect(store.access_token).toBe('a2-access');
  });

  it("a teardown judged on A stands down for ANOTHER user's session — and says so", async () => {
    // B is left alone, but A's session is over: 'replaced', never 'superseded',
    // so no caller mistakes B's credential for a continuation of A's.
    Object.assign(store, SESSION_B);

    const outcome = await authManager.clearAllAuthData({ accessToken: 'a-access', userId: 'user-a' });

    expect(outcome).toBe('replaced');
    expect(store.access_token).toBe('b-access');
    expect(store.authState).toEqual(SESSION_B.authState);
  });

  it('a teardown judged on credential A still ends A', async () => {
    Object.assign(store, SESSION_A);

    const outcome = await authManager.clearAllAuthData({ accessToken: 'a-access', userId: 'user-a' });

    expect(outcome).toBe('ended');
    expect(store.access_token).toBeUndefined();
    expect(store.authState).toBeUndefined();
  });

  it('a sign-in landing between the teardown\'s check and its removal survives', async () => {
    // The check passes — A is still stored — and the sign-in is started right
    // then. Only the lock keeps it from landing before the removal: the check
    // alone would let the teardown remove B, judged on A.
    Object.assign(store, SESSION_A);
    let signIn: Promise<unknown> | null = null;
    mockStorage.local.get.mockImplementation(async (keys) => {
      const snapshot = mockStorage.local.read(keys);
      const list = Array.isArray(keys) ? keys : [keys];
      // The teardown's comparison read (inside the lock, after the verdict).
      if (!signIn && list.includes('access_token') && list.includes('authState') && list.length === 3) {
        signIn = signInB();
        await settle();
      }
      return snapshot;
    });

    expect(await authManager.clearAllAuthData({ accessToken: 'a-access', userId: 'user-a' })).toBe('ended');
    await signIn;
    await settle();

    expect(store.access_token).toBe('b-access');
    expect(store.authState).toEqual(SESSION_B.authState);
  });

  /** A is spent with nothing to refresh it; `sign` lands right after `assess()` read it. */
  function deadAThenSignIn(sign: () => Promise<unknown>) {
    Object.assign(store, { ...SESSION_A, expires_at: Date.now() - 3600000 });
    const landed: { signIn: Promise<unknown> | null } = { signIn: null };
    mockStorage.local.get.mockImplementation(async (keys) => {
      const snapshot = mockStorage.local.read(keys);
      const list = Array.isArray(keys) ? keys : [keys];
      if (!landed.signIn && list.includes('access_token') && !list.includes('authState')) {
        landed.signIn = sign();
        await settle();
      }
      return snapshot;
    });
    return landed;
  }

  it("the act-site answers from A's newer credential after a verdict on A's old one", async () => {
    // The verdict — and the teardown it asks for — is about a-access. The same
    // user signed in again meanwhile: their session continues, and the request
    // that asked gets its newer bearer.
    const landed = deadAThenSignIn(signInA2);

    await expect(readSessionAccessToken()).resolves.toBe('a2-access');
    await landed.signIn;

    expect(store.access_token).toBe('a2-access');
    expect(store.authState).toEqual(SESSION_A2.authState);
  });

  it("the act-site neither signs B out nor hands A's request B's bearer", async () => {
    // A different user signed in after the verdict on A. B's session is left
    // alone — and A's request is NOT retried with B's credential: it was built
    // for A, and replayed it would land in B's account.
    const landed = deadAThenSignIn(signInB);

    await expect(readSessionAccessToken()).rejects.toBeInstanceOf(SessionEndedError);
    await landed.signIn;

    expect(store.access_token).toBe('b-access');
    expect(store.refresh_token).toBe('b-refresh');
    expect(store.authState).toEqual(SESSION_B.authState);
  });

  it("a 401 for A's old bearer answers 'refreshed' when A's session holds a newer one", async () => {
    // The 401 is a round trip late: A's credential rotated while the request
    // was out. The same session continues; the client retries once with a2.
    Object.assign(store, SESSION_A2);

    const outcome = await createExtensionTransport(panelFor('user-a')).onUnauthorized('a-access');

    expect(outcome).toBe('refreshed');
    expect(store.access_token).toBe('a2-access');
  });

  it("a 401 for A's bearer answers 'ended' — no retry — when B has signed in, and leaves B alone", async () => {
    // 'refreshed' would replay A's request (a POST /cases, a turn) with B's
    // bearer, into B's account.
    Object.assign(store, SESSION_B);

    const outcome = await createExtensionTransport(panelFor('user-a')).onUnauthorized('a-access');

    expect(outcome).toBe('ended');
    expect(store.access_token).toBe('b-access');
    expect(store.authState).toEqual(SESSION_B.authState);
  });

  it("a 401 for the bearer still stored ends that session", async () => {
    Object.assign(store, SESSION_A);

    expect(await createExtensionTransport(panelFor('user-a')).onUnauthorized('a-access')).toBe('ended');
    expect(store.access_token).toBeUndefined();
    expect(store.authState).toBeUndefined();
  });

  it('an in-flight refresh cannot undo a sign-out', async () => {
    // A is refreshable. The refresh's compare-and-swap passes; the user signs
    // out at that moment; the refresh must not then write A back.
    Object.assign(store, {
      ...SESSION_A,
      expires_at: Date.now() + 60_000, // inside the proactive window
      refresh_token: 'a-refresh',
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'a-rotated-access',
        token_type: 'bearer',
        expires_in: 900,
        refresh_token: 'a-rotated-refresh',
      }),
    });
    let signOut: Promise<unknown> | null = null;
    const realGetRefreshToken = tokenManager.getRefreshToken.bind(tokenManager);
    vi.spyOn(tokenManager, 'getRefreshToken').mockImplementation(async () => {
      const current = await realGetRefreshToken();
      if (!signOut) {
        signOut = authManager.clearAllAuthData();
        await settle();
      }
      return current;
    });

    await tokenManager.getValidAccessToken();
    await signOut;
    await settle();

    expect(store.access_token).toBeUndefined();
    expect(store.refresh_token).toBeUndefined();
    expect(store.authState).toBeUndefined();
  });

  it('a wedged lock holder delays a sign-out by a bounded wait, never forever', async () => {
    Object.assign(store, SESSION_A);
    // A holder that never lets go — a storage call that never settles, say.
    void withSessionWriteLock(() => new Promise<never>(() => {}));
    await settle(2);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      const signOut = authManager.clearAllAuthData().then((outcome) => {
        settled = true;
        return outcome;
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(true);
      expect(await signOut).toBe('ended');
    } finally {
      vi.useRealTimers();
    }
    expect(store.access_token).toBeUndefined();
    expect(store.authState).toBeUndefined();
  });
});
