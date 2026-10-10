/**
 * 403 on a turn (fm#1898, ADR-020): the server's own word that this viewer may
 * not write the case. Driven down to `authenticatedFetch`, stubbing only the wire.
 *
 * The driver the client held was stale or unknown, so the refusal is read
 * against the case row: a row naming another DRIVER makes the case read-only,
 * keeps the driver notice in the bubble and takes the case out of the sidebar's
 * list (cache slot dropped, list reload requested); a row naming the viewer as
 * driver means the refusal was something else, so the composer is left alone.
 * The creator is not the test: here the viewer created every case, and a
 * creator who handed the case on is refused like any other reader.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { bumpEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { CHECKING_ACCESS_NOTICE, DRIVER_READ_ONLY_NOTICE } from '@faultmaven/copilot-ui/lib/cases/driver';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost, hostWrapper } from '../support/host';

const mockShowError = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/errors')>()),
  useError: () => ({ showError: mockShowError, dismissError: vi.fn() }),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const CASE = 'case-123';
const BASE = 'http://localhost:8090';
const CASE_URL = `${BASE}/api/v1/cases/${CASE}`;
const TURNS_URL = `${CASE_URL}/turns`;

const wire = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
});

/** The viewer (u1) created the case; only the effective driver varies. */
const row = (driverId: string) => ({
  case_id: CASE,
  title: 'Test',
  state: 'investigating',
  closure_reason: null,
  closed_at: null,
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  user_id: 'u1',
  driver_id: driverId,
  enterprise_id: 'e1',
});

/** Turn POSTs get a 403; the case read-back names `driverId`. */
function route(driverId: string) {
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === TURNS_URL && method === 'POST') return Promise.resolve(wire(403, { detail: 'Not the case driver' }));
    if (url === CASE_URL && method === 'GET') return Promise.resolve(wire(200, row(driverId)));
    return Promise.reject(new Error(`unrouted ${method} ${url}`));
  });
}

const rows = (): OptimisticConversationItem[] => useAppStore.getState().conversations[CASE] ?? [];
const assistant = () => rows().find((r) => !r.question);
const denied = () => useAppStore.getState().writeDeniedCaseIds[CASE] === true;

describe('403 on a turn', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    pendingOpsManager.clear();
    stub = createStubHost();
    setHostStore(stub.store);
    setApiTransport({
      baseUrl: async () => BASE,
      accessToken: async () => 'test-token',
      sessionId: async () => null,
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });
    useAppStore.setState({
      sessionId: 'session-123',
      currentUser: { id: 'u1', username: 'me', roles: [] } as never,
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      writeDeniedCaseIds: {},
      // Driver not yet known: the placeholder a freshly opened case carries.
      activeCase: {
        case_id: CASE,
        title: 'Test',
        state: 'investigating',
        created_at: '2026-10-09T09:00:00Z',
        owner_id: '',
        enterprise_id: '',
        closure_reason: null,
        closed_at: null,
        message_count: 0,
      },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700_000);
    });
  };

  it('message path: another driver → read-only message, case marked, no Retry, sent once', async () => {
    route('u2');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await settle();

    const posts = (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(
      ([u, i]) => u === TURNS_URL && i.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(assistant()?.response).toBe(DRIVER_READ_ONLY_NOTICE);
    expect(assistant()).toMatchObject({ error: true, failed: false });
    expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
    expect(denied()).toBe(true);
    expect(useAppStore.getState().activeCase?.driver_id).toBe('u2');
  });

  it('another driver → the case leaves the sidebar: cache slot dropped, then the list reloads', async () => {
    route('u2');
    const order: string[] = [];
    vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      order.push('invalidate');
    });
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.refreshSessions !== prev.refreshSessions) order.push('refresh');
    });
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why?');
    });
    await settle();
    unsubscribe();

    expect(order.slice(-2)).toEqual(['invalidate', 'refresh']);
  });

  it('message path: the viewer drives it → the server’s message, composer kept, list left alone', async () => {
    route('u1');
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache');
    const refreshBefore = useAppStore.getState().refreshSessions;
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await settle();

    expect(invalidate).not.toHaveBeenCalled();
    expect(useAppStore.getState().refreshSessions).toBe(refreshBefore);
    expect(denied()).toBe(false);
    expect(assistant()?.response).not.toBe(DRIVER_READ_ONLY_NOTICE);
    expect(assistant()?.response).toMatch(/permission/i);
  });

  it('upload path: another driver → read-only message, case marked, reported refused', async () => {
    route('u2');
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({
        query: 'read this log',
        files: [new File(['ERROR x'], 'app.log', { type: 'text/plain' })],
        inputType: 'file',
      });
    });
    await settle();

    expect(outcome).toMatchObject({ success: false, sent: true, refused: true });
    expect(assistant()?.response).toBe(DRIVER_READ_ONLY_NOTICE);
    expect(denied()).toBe(true);
  });

  // The read-back is held open so the test can move the user, or end the
  // session, while it is in flight.
  function routeDeferred(driverId: string) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === TURNS_URL && method === 'POST') return wire(403, { detail: 'refused' });
      if (url === CASE_URL && method === 'GET') {
        await gate;
        return wire(200, row(driverId));
      }
      throw new Error(`unrouted ${method} ${url}`);
    });
    return release;
  }
  const flush = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  };

  it('claims nothing until the read-back lands: the bubble is neutral meanwhile', async () => {
    const release = routeDeferred('u2');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why?');
    });
    await flush();
    expect(assistant()?.response).toBe(CHECKING_ACCESS_NOTICE);
    expect(denied()).toBe(false);

    release();
    await flush();
    expect(assistant()?.response).toBe(DRIVER_READ_ONLY_NOTICE);
    expect(denied()).toBe(true);
  });

  // The viewer drives the refused case A (a different permission refused it);
  // by the time the read lands the user has opened B, which someone else drives.
  // Judging by the open case would mark A.
  it('judges the REFUSED case: opening another case mid-read-back does not mark it', async () => {
    const release = routeDeferred('u1');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why?');
    });
    await flush();
    act(() =>
      useAppStore.setState({
        activeCaseId: 'case-B',
        activeCase: {
          case_id: 'case-B', title: 'B', state: 'investigating', owner_id: 'u1', driver_id: 'u2', enterprise_id: 'e1',
        } as never,
      }),
    );

    release();
    await flush();
    expect(denied()).toBe(false);
    expect(useAppStore.getState().writeDeniedCaseIds['case-B']).toBeUndefined();
    expect(assistant()?.response).not.toBe(DRIVER_READ_ONLY_NOTICE);
  });

  it('a sign-out during the read-back leaves the purged store alone', async () => {
    const release = routeDeferred('u2');
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why?');
    });
    await flush();

    act(() => {
      bumpEpoch();
      useAppStore.setState({ conversations: {}, writeDeniedCaseIds: {} } as never);
    });
    const refreshBefore = useAppStore.getState().refreshSessions;
    release();
    await flush();

    expect(useAppStore.getState().conversations).toEqual({});
    expect(useAppStore.getState().writeDeniedCaseIds).toEqual({});
    expect(useAppStore.getState().refreshSessions).toBe(refreshBefore);
    expect(invalidate).not.toHaveBeenCalled();
  });

  // Every listed case is one the user drives, so a list click names no driver
  // up front: unknown, writable, the 403 above as backstop.
  it('selecting a different case starts unknown (writable) until hydration', async () => {
    fetchWithTimeout.mockImplementation(async () => wire(503, { detail: 'down' }));
    useAppStore.setState({
      activeCase: {
        case_id: 'case-B', title: 'B', state: 'investigating', owner_id: 'u1', driver_id: 'u2', enterprise_id: 'e1',
      } as never,
    });
    act(() => useAppStore.getState().handleCaseSelect(CASE));
    await flush();
    expect(useAppStore.getState().activeCase?.case_id).toBe(CASE);
    expect(useAppStore.getState().activeCase?.driver_id).toBeUndefined();
  });

  it('re-selecting the open case keeps the driver already known', async () => {
    fetchWithTimeout.mockImplementation(async () => wire(503, { detail: 'down' }));
    useAppStore.setState({
      activeCase: {
        case_id: CASE, title: 't', state: 'investigating', owner_id: 'u1', driver_id: 'u2', enterprise_id: 'e1',
      } as never,
    });
    act(() => useAppStore.getState().handleCaseSelect(CASE));
    await flush();
    expect(useAppStore.getState().activeCase?.driver_id).toBe('u2');
  });

  // Handed back: the denial meant "someone else drives it". A fresh row naming
  // the viewer as driver retires it, or the case would stay read-only for the
  // rest of the session.
  it('a fresh row naming the viewer as driver retires the denial', async () => {
    fetchWithTimeout.mockImplementation(async () => wire(200, row('u1')));
    useAppStore.setState({ writeDeniedCaseIds: { [CASE]: true } } as never);
    await act(async () => {
      await useAppStore.getState().refreshActiveCase(CASE);
    });
    expect(denied()).toBe(false);
  });

  it('a fresh row still naming another driver keeps the denial', async () => {
    fetchWithTimeout.mockImplementation(async () => wire(200, row('u2')));
    useAppStore.setState({ writeDeniedCaseIds: { [CASE]: true } } as never);
    await act(async () => {
      await useAppStore.getState().refreshActiveCase(CASE);
    });
    expect(denied()).toBe(true);
  });
});
