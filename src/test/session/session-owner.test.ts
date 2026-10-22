/**
 * A session is minted only with a bearer, only for the panel's user, and is
 * reused or heartbeated only by that user (faultmaven#1460).
 *
 * Through the real request, mint, ensure and slice modules; only the network
 * (`fetchWithTimeout`) is stubbed. The server is about to require auth on
 * `POST /api/v1/sessions`, and a client that answers "I sent no credential"
 * by minting with no credential would then loop: mint -> 401 -> re-mint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticatedFetchWithRetry } from '@faultmaven/copilot-ui/lib/api/client';
import { clearPersistedSession, refreshSession } from '@faultmaven/copilot-ui/lib/api/session-core';
import { clientSessionManager } from '@faultmaven/copilot-ui/lib/session/client-session-manager';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import {
  AuthenticationError,
  SessionExpiredError,
  SessionSwitchedError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { bumpEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { createStubHost } from '../support/host';

const { fetchWithTimeout } = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({ fetchWithTimeout }));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const API = 'http://localhost:8090';
const MINT = `${API}/api/v1/sessions`;
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as unknown as Response;
const minted = (sessionId: string, userId: string) =>
  reply(200, { session_id: sessionId, user_id: userId, status: 'active', created_at: 'now' });
const bearerOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
const mints = () => fetchWithTimeout.mock.calls.filter(([url]) => url === MINT);

let stub: ReturnType<typeof createStubHost>;
let token: string | null;
let readToken: () => Promise<string>;
const onUnauthorized = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithTimeout.mockReset();
  onUnauthorized.mockReset();
  // The in-context single-flight path: no Web Locks in the test env.
  Reflect.deleteProperty(navigator, 'locks');
  stub = createStubHost({ faultmaven_client_id: 'client-1' });
  setHostStore(stub.store);
  token = 't1';
  readToken = async () => {
    if (!token) throw new Error('no token right now');
    return token;
  };
  setApiTransport({
    baseUrl: async () => API,
    accessToken: () => readToken(),
    sessionId: async () => (stub.data.sessionId as string | undefined) ?? null,
    clearSession: () => clearPersistedSession(),
    onUnauthorized: (bearer: string) => onUnauthorized(bearer),
  });
});

describe('a 401 on a request sent with no credential mints nothing', () => {
  // The server refuses every header-less request, the mint included.
  beforeEach(() => {
    token = null;
    fetchWithTimeout.mockImplementation(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization ? reply(200) : reply(401),
    );
  });
  const requests = () =>
    fetchWithTimeout.mock.calls.filter(([url]) => url === `${API}/api/v1/cases`);

  it('keeps an owned session: the request is retried once, and nothing is minted', async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });

    await expect(authenticatedFetchWithRetry(`${API}/api/v1/cases`)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );

    expect(requests()).toHaveLength(2);
    expect(mints()).toHaveLength(0);
    expect(stub.data.sessionId).toBe('s1');
  });

  it('with nothing stored, retries once, and nothing is minted', async () => {
    await expect(authenticatedFetchWithRetry(`${API}/api/v1/cases`)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );

    expect(requests()).toHaveLength(2);
    expect(mints()).toHaveLength(0);
  });
});

describe('the mint', () => {
  it('is not sent without a bearer, and keeps the client id', async () => {
    token = null;
    const clearClientId = vi.spyOn(clientSessionManager, 'clearClientId');

    await expect(clientSessionManager.createSessionWithRecovery('u1')).rejects.toBeInstanceOf(
      SessionExpiredError,
    );

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(clearClientId).not.toHaveBeenCalled();
  });

  it("is re-sent once with the renewed bearer when a 401's verdict is 'refreshed'", async () => {
    onUnauthorized.mockImplementation(() => {
      token = 't2';
      return 'refreshed';
    });
    fetchWithTimeout.mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(minted('s-new', 'u1'));

    const session = await clientSessionManager.createSession('u1');

    expect(session.session_id).toBe('s-new');
    expect(onUnauthorized).toHaveBeenCalledWith('t1');
    expect(mints().map(bearerOf)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it("asks for sign-in when the verdict is 'ended', fencing the epoch", async () => {
    onUnauthorized.mockReturnValue('ended');
    fetchWithTimeout.mockResolvedValue(reply(401));
    const before = getEpoch();

    await expect(clientSessionManager.createSession('u1')).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    expect(getEpoch()).toBe(before + 1);
    expect(mints()).toHaveLength(1);
  });

  it('asks for sign-in when the renewed bearer is refused too, with no second verdict', async () => {
    onUnauthorized.mockReturnValue('refreshed');
    fetchWithTimeout.mockResolvedValue(reply(401));
    const before = getEpoch();

    await expect(clientSessionManager.createSession('u1')).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    expect(mints()).toHaveLength(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(getEpoch()).toBe(before);
  });

  // A 404 on the re-sent mint takes the client-id recovery path; its mint
  // must not ask the host again.
  it('takes at most one verdict, the client-id recovery included', async () => {
    onUnauthorized.mockReturnValue('refreshed');
    fetchWithTimeout
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValue(reply(401));
    const clearClientId = vi.spyOn(clientSessionManager, 'clearClientId');

    await expect(clientSessionManager.createSessionWithRecovery('u1')).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    expect(clearClientId).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  // The server resolves a revoked or invalid bearer to nobody and mints an
  // anonymous session for it: a rejected credential, never the user's session.
  it('takes the verdict on a session minted for another user, and never persists it', async () => {
    onUnauthorized.mockReturnValue('ended');
    fetchWithTimeout.mockResolvedValue(minted('s-anon', 'user_ab12cd34'));

    await expect(refreshSession('u1')).rejects.toBeInstanceOf(AuthenticationError);

    expect(onUnauthorized).toHaveBeenCalledWith('t1');
    expect(stub.data.sessionId).toBeUndefined();
  });

  it("persists the re-sent mint when, after 'refreshed', it is the user's", async () => {
    onUnauthorized.mockReturnValue('refreshed');
    fetchWithTimeout
      .mockResolvedValueOnce(minted('s-anon', 'user_ab12cd34'))
      .mockResolvedValueOnce(minted('s-u1', 'u1'));

    await refreshSession('u1');

    expect(stub.data).toMatchObject({ sessionId: 's-u1', sessionUserId: 'u1' });
  });
});

describe('the ensure', () => {
  it("sends nothing when the stored session is the owner's", async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });

    await refreshSession('u1');

    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  // `undefined`: anonymous, or persisted before owners were recorded.
  it.each([['another user', 'u2'], ['no recorded owner', undefined]])(
    'replaces a stored session with %s',
    async (_label, storedOwner) => {
      Object.assign(stub.data, { sessionId: 's-old', sessionUserId: storedOwner });
      fetchWithTimeout.mockResolvedValue(minted('s-new', 'u1'));

      await refreshSession('u1');

      expect(mints()).toHaveLength(1);
      expect(stub.data).toMatchObject({ sessionId: 's-new', sessionUserId: 'u1' });
    },
  );

  it('without an owner, waits for an owned ensure in flight', async () => {
    let release!: (response: Response) => void;
    fetchWithTimeout.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
    const owned = refreshSession('u1');
    let ownerlessDone = false;
    const ownerless = refreshSession().then(() => { ownerlessDone = true; });

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ownerlessDone).toBe(false);
    } finally {
      // Released either way, so a failure here leaves no ensure in flight.
      release(minted('s-new', 'u1'));
      await Promise.all([owned, ownerless]);
    }
    expect(stub.data.sessionId).toBe('s-new');
  });

  it('mints nothing, and clears nothing, without an owner', async () => {
    Object.assign(stub.data, { sessionId: 's-old', sessionUserId: 'u2' });

    await refreshSession();

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(stub.data.sessionId).toBe('s-old');
  });
});

describe('the session slice', () => {
  const heartbeats = () =>
    fetchWithTimeout.mock.calls.filter(([url]) => String(url).endsWith('/heartbeat'));
  const init = () => useAppStore.getState().initializeSession(true, 'u1');

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ sessionId: null, isSessionInitialized: false, sessionError: null });
  });

  afterEach(async () => {
    await useAppStore.getState().clearSession();
    vi.useRealTimers();
  });

  const mintWhenAsked = () =>
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url === MINT ? minted('s-new', 'u1') : reply(200),
    );

  it('retries a mint refused at init 15 s later, once a bearer is available', async () => {
    token = null;
    await init();
    expect(mints()).toHaveLength(0);

    token = 't1';
    mintWhenAsked();
    await vi.advanceTimersByTimeAsync(15_000);

    await vi.waitFor(() => expect(useAppStore.getState().sessionId).toBe('s-new'));
    expect(mints()).toHaveLength(1);
  });

  it('keeps the heartbeat when the early retry is refused too, and the next tick mints', async () => {
    token = null;
    await init();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(vi.getTimerCount()).toBe(1);

    token = 't1';
    mintWhenAsked();
    await vi.advanceTimersToNextTimerAsync();

    await vi.waitFor(() => expect(useAppStore.getState().sessionId).toBe('s-new'));
    expect(mints()).toHaveLength(1);
  });

  it("beats the owner's session", async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    fetchWithTimeout.mockResolvedValue(reply(200));
    await init();

    await vi.advanceTimersToNextTimerAsync();

    await vi.waitFor(() => expect(heartbeats()).toHaveLength(1));
    expect(heartbeats()[0][0]).toBe(`${API}/api/v1/sessions/s1/heartbeat`);
    expect(mints()).toHaveLength(0);
  });

  it.each([404, 403])('drops a session whose heartbeat is answered %i, and the next tick mints', async (status) => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url === MINT ? minted('s2', 'u1') : reply(String(url).includes('/s1/') ? status : 200),
    );
    await init();

    await vi.advanceTimersToNextTimerAsync();
    await vi.waitFor(() => expect(stub.data.sessionId).toBeUndefined());
    // The store too: the upload gate reads it.
    expect(useAppStore.getState().sessionId).toBeNull();

    await vi.advanceTimersToNextTimerAsync();
    await vi.waitFor(() => expect(stub.data.sessionId).toBe('s2'));
    expect(mints()).toHaveLength(1);
  });

  it('leaves one heartbeat after overlapping inits, and none after clearSession', async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });

    await Promise.all([init(), init()]);
    expect(vi.getTimerCount()).toBe(1);

    await useAppStore.getState().clearSession();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer when the session is signed out during the mint at init', async () => {
    fetchWithTimeout.mockResolvedValue(reply(401));
    onUnauthorized.mockImplementation(async () => {
      // The host tears down, and the panel hears it, before init's catch runs.
      await useAppStore.getState().clearSession();
      return 'ended';
    });

    await init();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('mints nothing for the previous user after clearSession', async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    await init();
    await useAppStore.getState().clearSession();

    // Another user signs in on the same page.
    token = 't-u2';
    fetchWithTimeout.mockResolvedValue(minted('s-u2', 'u2'));
    onUnauthorized.mockReturnValue('ended');
    await expect(useAppStore.getState().refreshSession()).rejects.toThrow();

    expect(mints()).toHaveLength(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  // Another account signed in on this browser, and its panel stored its session.
  it("keeps another user's stored session when the host refuses this user's request", async () => {
    Object.assign(stub.data, { sessionId: 'sB', sessionUserId: 'uB' });
    readToken = async () => {
      throw new SessionSwitchedError();
    };

    await init();

    expect(mints()).toHaveLength(0);
    expect(stub.data.sessionId).toBe('sB');
  });

  it('keeps a session stored before owners were recorded through a header-less 401', async () => {
    Object.assign(stub.data, { sessionId: 's-legacy' });
    token = null;
    fetchWithTimeout.mockImplementation(async (_url: string, req: RequestInit) =>
      (req.headers as Record<string, string>).Authorization ? reply(200) : reply(401),
    );
    await init();

    await expect(authenticatedFetchWithRetry(`${API}/api/v1/cases`)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );

    expect(mints()).toHaveLength(0);
    expect(stub.data.sessionId).toBe('s-legacy');
  });
});

describe('the session slice: its timers and its owner', () => {
  const heartbeats = () =>
    fetchWithTimeout.mock.calls.filter(([url]) => String(url).endsWith('/heartbeat'));
  const init = () => useAppStore.getState().initializeSession(true, 'u1');
  const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 10 * 60 * 1000);
  const mintWhenAsked = () =>
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url === MINT ? minted('s-new', 'u1') : reply(200),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ sessionId: null, isSessionInitialized: false, sessionError: null });
  });

  afterEach(async () => {
    await useAppStore.getState().clearSession();
    vi.useRealTimers();
  });

  // The host ends the session during the init mint without the panel's
  // clearSession: only the epoch moves, and the epoch init started under
  // is what stops its timers.
  it('mints once, then stops, when the host ends the session during the init mint', async () => {
    fetchWithTimeout.mockResolvedValue(reply(401));
    onUnauthorized.mockReturnValue('ended');
    await init();

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(mints()).toHaveLength(1);
  });

  it("drops a dead heartbeat's session under the session lock", async () => {
    let held = false;
    let tail: Promise<unknown> = Promise.resolve();
    const request = vi.fn((_name: string, _opts: unknown, task: () => Promise<unknown>) => {
      const run = tail.then(async () => {
        held = true;
        try {
          return await task();
        } finally {
          held = false;
        }
      });
      tail = run.catch(() => {});
      return run;
    });
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    const removedUnderLock: boolean[] = [];
    stub.remove.mockImplementation(async (keys: string[]) => {
      removedUnderLock.push(held);
      for (const key of keys) delete stub.data[key];
    });
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    fetchWithTimeout.mockResolvedValue(reply(404));
    await init();

    await vi.advanceTimersToNextTimerAsync();
    await vi.waitFor(() => expect(stub.data.sessionId).toBeUndefined());

    expect(removedUnderLock).toEqual([true]);
  });

  it('clearSession cancels a pending early ensure', async () => {
    token = null;
    await init();
    await useAppStore.getState().clearSession();
    expect(vi.getTimerCount()).toBe(0);

    token = 't1';
    mintWhenAsked();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mints()).toHaveLength(0);
  });

  it('a re-init cancels a pending early ensure', async () => {
    token = null;
    await init();
    token = 't1';
    mintWhenAsked();
    await init();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mints()).toHaveLength(1);
  });

  it("schedules no early ensure for a superseded init's failure", async () => {
    let fail!: (response: Response) => void;
    fetchWithTimeout.mockReturnValueOnce(new Promise<Response>((resolve) => { fail = resolve; }));
    const first = init(); // its mint is in flight
    const second = init(); // replaces its timer, and joins its mint
    fail(reply(500));
    await Promise.all([first, second]);

    // The second init's interval and its one early ensure.
    expect(vi.getTimerCount()).toBe(2);
    await useAppStore.getState().clearSession();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an early ensure mints nothing once the session has ended', async () => {
    token = null;
    await init();
    bumpEpoch();
    token = 't1';
    mintWhenAsked();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(mints()).toHaveLength(0);
  });

  it('with no owner, adopts no stored session', async () => {
    Object.assign(stub.data, { sessionId: 's1', sessionUserId: 'u1' });
    await init();
    await useAppStore.getState().clearSession();
    // Another account's panel stores its session.
    Object.assign(stub.data, { sessionId: 'sB', sessionUserId: 'uB' });

    await expect(useAppStore.getState().refreshSession()).rejects.toThrow();

    expect(useAppStore.getState().sessionId).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('never beats a stored session for no owner', async () => {
    Object.assign(stub.data, { sessionId: 'sB', sessionUserId: 'uB' });
    fetchWithTimeout.mockResolvedValue(reply(200));
    // A caller outside the types (plain JS, a stale build) passing no owner.
    await useAppStore.getState().initializeSession(true, undefined as unknown as string);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(useAppStore.getState().sessionId).toBeNull();
    expect(heartbeats()).toHaveLength(0);
  });
});
