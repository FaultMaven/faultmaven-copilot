/**
 * The panel's session ensure in a host that renews credentials
 * (faultmaven#1460; the findings of faultmaven-dashboard#255's review).
 *
 * Through the real request, mint, ensure and slice modules; only the network
 * (`fetchWithTimeout`) is stubbed. Each test gets a fresh copy of the package —
 * its store, epoch, ensure chain and timers — with the heartbeat interval
 * stubbed BEFORE the slice is imported, since the slice reads it at import.
 * Fake timers throughout, advanced step by step; `settle` drains the
 * microtasks a step started with one real macrotask, so nothing polls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStubHost } from '../support/host';

const { fetchWithTimeout } = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({ fetchWithTimeout }));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const API = 'http://localhost:8090';
const MINT = `${API}/api/v1/sessions`;
const CASES = `${API}/api/v1/cases`;
const HEARTBEAT_MS = 10 * 60 * 1000;

const reply = (status: number, body: unknown = {}) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as unknown as Response;
const minted = (sessionId: string, userId: string) =>
  reply(200, { session_id: sessionId, user_id: userId, status: 'active', created_at: 'now' });
const mints = () => fetchWithTimeout.mock.calls.filter(([url]) => url === MINT);
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
};

// Captured before any test fakes the timers.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>((resolve) => { realSetTimeout(resolve, 0); });

async function loadPackage() {
  vi.stubEnv('VITE_HEARTBEAT_INTERVAL_MS', String(HEARTBEAT_MS));
  vi.resetModules();
  const [store, core, transport, hostStore, epoch, client, errors] = await Promise.all([
    import('@faultmaven/copilot-ui/lib/state/store'),
    import('@faultmaven/copilot-ui/lib/api/session-core'),
    import('@faultmaven/copilot-ui/lib/api/transport'),
    import('@faultmaven/copilot-ui/lib/host-store'),
    import('@faultmaven/copilot-ui/lib/state/session-epoch'),
    import('@faultmaven/copilot-ui/lib/api/client'),
    import('@faultmaven/copilot-ui/lib/errors/types'),
  ]);
  return { ...store, ...core, ...transport, ...hostStore, ...epoch, ...client, ...errors };
}

let pkg: Awaited<ReturnType<typeof loadPackage>>;
let stub: ReturnType<typeof createStubHost>;
let token: string | null;
const onUnauthorized = vi.fn();
const init = (owner = 'u1') => pkg.useAppStore.getState().initializeSession(true, owner);

beforeEach(async () => {
  fetchWithTimeout.mockReset();
  onUnauthorized.mockReset();
  Reflect.deleteProperty(navigator, 'locks');
  pkg = await loadPackage();
  stub = createStubHost({ faultmaven_client_id: 'client-1' });
  pkg.setHostStore(stub.store);
  token = 't1';
  pkg.setApiTransport({
    baseUrl: async () => API,
    accessToken: async () => {
      if (!token) throw new Error('no token right now');
      return token;
    },
    sessionId: async () => (stub.data.sessionId as string | undefined) ?? null,
    clearSession: () => pkg.clearPersistedSession(),
    onUnauthorized: (bearer: string) => onUnauthorized(bearer),
  });
  vi.useFakeTimers();
});

afterEach(async () => {
  await pkg.useAppStore.getState().clearSession();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'locks');
});

describe('a mint the session outlived', () => {
  it('writes nothing when the session ends between its send and its answer', async () => {
    const mint = deferred();
    fetchWithTimeout.mockImplementation((url: string) => (url === MINT ? mint.promise : reply(200)));
    const started = init();
    await settle();
    expect(mints()).toHaveLength(1);

    pkg.bumpEpoch(); // a sign-out
    mint.resolve(minted('s1', 'u1'));
    await started;

    expect(stub.data.sessionId).toBeUndefined();
    expect(stub.data.sessionUserId).toBeUndefined();
    expect(pkg.useAppStore.getState().sessionId).toBeNull();
  });

  it('is never sent when the session ends while it waits for the session lock', async () => {
    // Another context holds the lock (its own ensure, or a dead session's clear).
    let tail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, _opts: unknown, task: () => Promise<unknown>) => {
      const run = tail.then(task);
      tail = run.catch(() => {});
      return run;
    });
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    fetchWithTimeout.mockImplementation(async (url: string) => (url === MINT ? minted('s1', 'u1') : reply(200)));

    const started = init();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    pkg.bumpEpoch(); // a sign-out while queued
    release();
    await started;

    expect(mints()).toHaveLength(0);
    expect(stub.data.sessionId).toBeUndefined();
    expect(pkg.useAppStore.getState().sessionId).toBeNull();
  });
});

describe('the ensure scheduler', () => {
  // 403 is defensive: the server's heartbeat answers none today.
  it.each([404, 403])('re-mints at once when a heartbeat is answered %i, not at the next tick', async (status) => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    fetchWithTimeout.mockImplementation(async (url: string) => {
      if (url === MINT) return minted('s2', 'u1');
      return reply(String(url).endsWith('/s1/heartbeat') ? status : 200);
    });
    await init();
    expect(pkg.useAppStore.getState().sessionId).toBe('s1');

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS); // the first tick: s1 is refused
    await settle();

    expect(mints()).toHaveLength(1);
    expect(stub.data).toMatchObject({ sessionId: 's2', sessionUserId: 'u1' });
    expect(pkg.useAppStore.getState().sessionId).toBe('s2');
  });

  it('holds a session within seconds of a credential arriving after a failed init', async () => {
    token = null;
    fetchWithTimeout.mockImplementation(async (url: string) => (url === MINT ? minted('s1', 'u1') : reply(200)));
    await init();
    expect(pkg.useAppStore.getState().sessionId).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000); // the first retry: still no credential
    await settle();
    expect(mints()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(25_000); // 40 s: the credential arrives
    token = 't1';
    await settle();
    expect(mints()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000); // 45 s: the second retry, 30 s after the first
    await settle();

    expect(mints()).toHaveLength(1);
    expect(pkg.useAppStore.getState().sessionId).toBe('s1');
  });
});

describe("a host that answers 'unavailable'", () => {
  beforeEach(() => {
    onUnauthorized.mockReturnValue('unavailable');
  });

  it('fails the request with NetworkError, once, and leaves the session where it was', async () => {
    fetchWithTimeout.mockResolvedValue(reply(401, { detail: 'Could not validate credentials' }));
    const epoch = pkg.getEpoch();

    await expect(pkg.authenticatedFetchWithRetry(CASES)).rejects.toBeInstanceOf(pkg.NetworkError);

    expect(fetchWithTimeout.mock.calls.filter(([url]) => url === CASES)).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledWith('t1');
    expect(pkg.getEpoch()).toBe(epoch);
  });

  it('fails the mint with NetworkError, once, and leaves the session where it was', async () => {
    fetchWithTimeout.mockResolvedValue(reply(401));
    const epoch = pkg.getEpoch();

    await expect(pkg.refreshSession('u1')).rejects.toBeInstanceOf(pkg.NetworkError);

    expect(mints()).toHaveLength(1);
    expect(pkg.getEpoch()).toBe(epoch);
  });

  it('has its refused mint retried by the scheduler', async () => {
    fetchWithTimeout.mockResolvedValueOnce(reply(401)).mockResolvedValue(minted('s1', 'u1'));
    const epoch = pkg.getEpoch();
    await init();
    expect(mints()).toHaveLength(1);
    expect(pkg.useAppStore.getState().sessionId).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    await settle();

    expect(mints()).toHaveLength(2);
    expect(pkg.useAppStore.getState().sessionId).toBe('s1');
    expect(pkg.getEpoch()).toBe(epoch);
  });
});

describe('without Web Locks, an ensure for one user never adopts another user\'s session', () => {
  it("mints the second user's own session while the first user's is in flight", async () => {
    const first = deferred();
    fetchWithTimeout.mockReturnValueOnce(first.promise).mockResolvedValueOnce(minted('sB', 'uB'));

    const forA = pkg.refreshSession('uA');
    const forB = pkg.refreshSession('uB');
    first.resolve(minted('sA', 'uA'));
    await Promise.all([forA, forB]);

    expect(mints()).toHaveLength(2);
    expect(stub.data).toMatchObject({ sessionId: 'sB', sessionUserId: 'uB' });
  });

  it("does not set another user's stored session in the panel's store", async () => {
    // Another tab's ensure, for another account, stores its session just after ours.
    stub.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(stub.data, items);
      if (items.sessionUserId === 'uB') Object.assign(stub.data, { sessionId: 'sA', sessionUserId: 'uA' });
    });
    fetchWithTimeout.mockResolvedValue(minted('sB', 'uB'));

    await init('uB');

    expect(mints()).toHaveLength(1);
    expect(pkg.useAppStore.getState().sessionId).toBeNull();
  });
});
