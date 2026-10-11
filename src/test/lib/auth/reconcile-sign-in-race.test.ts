/**
 * The startup repair must never sweep a sign-in that lands while it runs
 * (copilot#342).
 *
 * `reconcileSession()` treats credentials with no `authState` row as debris and
 * removes them. A sign-in writes both in one `set()` — but if that write lands
 * between the repair's look and its act, the look said "no row" and the act
 * finds credentials: a fresh session, swept as an orphan. The user who just
 * signed in sees the sign-in screen. Reproduced end to end in
 * e2e/tests/07-sign-in-during-panel-startup.spec.ts.
 *
 * These tests drive the REAL repair against the REAL panel-side sign-in writer
 * (`LocalAuthClient.signIn` -> `storeTokens`) over one in-memory storage, and
 * force the interleaving rather than hoping for it.
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

// The identity-change purge (#144) is a collaborator with its own tests.
vi.mock('../../../extension/auth/user-scope', () => ({
  enforceUserDataScope: vi.fn().mockResolvedValue(false),
}));

import { authManager } from '../../../extension/auth/auth-manager';
import { LocalAuthClient } from '../../../extension/auth/local-auth-client';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';

const API = 'https://api.example.test';

const signedInResponse = {
  access_token: 'fresh-access',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'fresh-refresh',
  session_id: 'fresh-session',
  user: { user_id: 'user-1', username: 'u1', email: 'u1@example.test', display_name: 'U1', roles: ['user'] },
};

/** A Web Locks stand-in that is genuinely exclusive per name. */
function installWebLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, _opts: unknown, work: () => Promise<unknown>) => {
    const prev = tails.get(name) ?? Promise.resolve();
    const run = prev.then(work, work);
    tails.set(name, run.then(() => undefined, () => undefined));
    return run;
  });
  Object.defineProperty(global.navigator, 'locks', { value: { request }, configurable: true });
  return request;
}

function removeWebLocks() {
  Object.defineProperty(global.navigator, 'locks', { value: undefined, configurable: true });
}

/** Let every pending microtask and timer-0 continuation run, a few times over. */
async function settle(turns = 20) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

const storedRow = () => store.authState as { user?: { user_id?: string } } | undefined;

const sweptCredentials = () =>
  mockStorage.local.remove.mock.calls.some(
    ([keys]) => Array.isArray(keys) && keys.includes('access_token'),
  );

describe.each([
  ['Web Locks', installWebLocks],
  ['the in-context fallback (no Web Locks)', removeWebLocks],
])('reconcileSession vs a concurrent sign-in, under %s', (_label, installLocks) => {
  let client: LocalAuthClient;

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => signedInResponse,
    }) as unknown as typeof fetch;
    client = new LocalAuthClient();
  });

  afterEach(() => {
    removeWebLocks();
  });

  it('a sign-in landing AFTER the repair looked at storage survives the repair', async () => {
    // The repair's first read of `authState` sees the signed-out profile. The
    // sign-in is started at exactly that point, and given every chance to land
    // its write before the repair continues.
    let signIn: Promise<unknown> | null = null;
    mockStorage.local.get.mockImplementation(async (keys) => {
      const snapshot = mockStorage.local.read(keys);
      const list = Array.isArray(keys) ? keys : [keys];
      if (!signIn && list.includes('authState')) {
        signIn = client.signIn({ username: 'u1', password: 'pw' });
        await settle();
      }
      return snapshot;
    });

    await authManager.reconcileSession();
    await signIn;
    await settle();

    expect(sweptCredentials()).toBe(false);
    expect(store.access_token).toBe('fresh-access');
    expect(store.refresh_token).toBe('fresh-refresh');
    expect(storedRow()?.user?.user_id).toBe('user-1');
  });

  it('a repair that starts while a sign-in is writing waits for it, and reports that session', async () => {
    // The other order: the sign-in has issued its write and the repair starts
    // before that write is applied. Unserialized, the repair answers from the
    // signed-out profile it read first — and the panel's startup takes its
    // identity from that answer.
    let repair: Promise<unknown> | null = null;
    mockStorage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      if (!repair && items.access_token === 'fresh-access') {
        repair = authManager.reconcileSession();
        await settle();
      }
      return mockStorage.local.write(items);
    });

    await client.signIn({ username: 'u1', password: 'pw' });
    const reconciled = (await repair) as { user?: { user_id?: string } } | null;
    await settle();

    expect(reconciled?.user?.user_id).toBe('user-1');
    expect(sweptCredentials()).toBe(false);
    expect(store.access_token).toBe('fresh-access');
    expect(storedRow()?.user?.user_id).toBe('user-1');
  });

  it('still sweeps a genuine orphan — the repair is not disabled, only serialized', async () => {
    // The negative control. A DEAD orphan (expired, nothing to refresh with) is
    // the debris the sweep exists for: a teardown whose credential half failed.
    Object.assign(store, { access_token: 'orphaned', expires_at: Date.now() - 3600000 });

    expect(await authManager.reconcileSession()).toBeNull();

    expect(sweptCredentials()).toBe(true);
    expect(store.access_token).toBeUndefined();
  });
});
