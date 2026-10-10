/**
 * Two readers of `GET /cases`, one cache slot (ADR-020 D8, fm#1898).
 *
 * The sidebar lists the cases its user DRIVES (`access=write`) and is the one
 * query the single-slot list cache holds. `reconcileActiveCaseState` runs in
 * both hosts and looks the open case up among every case the user can READ —
 * a case reassigned away while open is still one of those. The two must not
 * share answers: reconcile never asks for `access=write`, never fills the slot
 * the sidebar reads, and the sidebar's next read is its own query.
 *
 * Driven down to `fetchWithTimeout`, with the real case service and the real
 * cache over a stub host store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { getUserCases, SIDEBAR_CASE_LIST_QUERY } from '@faultmaven/copilot-ui/lib/api';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';

const caseRow = (id: string, driver: string, state = 'investigating') => ({
  case_id: id,
  title: id,
  state,
  closure_reason: state === 'closed' ? 'abandoned' : null,
  closed_at: state === 'closed' ? '2026-10-09T10:00:00Z' : null,
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  user_id: 'u1',
  driver_id: driver,
  enterprise_id: 'e1',
});

// The viewer (u1) drives A. B was handed to u2 while it was open, and u2 closed it.
const DRIVEN = [caseRow('case-A', 'u1')];
const READABLE = [caseRow('case-A', 'u1'), caseRow('case-B', 'u2', 'closed')];

const wire = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });

/** `GET /cases` answers by the access filter, as the server does. */
const listCalls = () =>
  (fetchWithTimeout.mock.calls as [string][])
    .map(([u]) => new URL(u))
    .filter((u) => u.pathname === '/api/v1/cases');

beforeEach(async () => {
  vi.clearAllMocks();
  const stub = createStubHost();
  setHostStore(stub.store);
  setApiTransport({
    baseUrl: async () => BASE,
    accessToken: async () => 'test-token',
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'ended' as const,
  });
  fetchWithTimeout.mockImplementation(async (url: string) => {
    const u = new URL(url);
    if (u.pathname !== '/api/v1/cases') throw new Error(`unrouted ${url}`);
    return wire({ cases: u.searchParams.get('access') === 'write' ? DRIVEN : READABLE });
  });
  await caseCacheManager.invalidateCache();
  useAppStore.setState({
    currentUser: { id: 'u1', username: 'me', roles: [] } as never,
    activeCaseId: 'case-B',
    // Closed by its new driver; the panel holds no closure details yet.
    activeCase: {
      case_id: 'case-B', title: 'case-B', state: 'closed', owner_id: 'u1', driver_id: 'u2',
      enterprise_id: 'e1', closure_reason: null, closed_at: null,
    },
  } as never);
});

describe('the sidebar list and reconcile do not share a cache slot', () => {
  it('reconcile reads every case the user can read: no access filter', async () => {
    await useAppStore.getState().reconcileActiveCaseState();

    const calls = listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.has('access')).toBe(false);
    // And it found the case the sidebar would not list.
    expect(useAppStore.getState().activeCase?.closed_at).toBe('2026-10-09T10:00:00Z');
  });

  it('reconcile never fills the slot the sidebar reads', async () => {
    await useAppStore.getState().reconcileActiveCaseState();

    expect(await caseCacheManager.getCachedCases()).toBeNull();
    const sidebar = await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    expect(sidebar.map((c) => c.case_id)).toEqual(['case-A']);
    expect(listCalls().at(-1)?.searchParams.get('access')).toBe('write');
  });

  it('a cached sidebar page is never reconcile’s answer', async () => {
    // The sidebar has listed and cached its page.
    await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    expect((await caseCacheManager.getCachedCases())?.map((c) => c.case_id)).toEqual(['case-A']);

    // Reconcile's own query, straight at the service: the slot holds a page,
    // and it must still go to the server.
    const before = listCalls().length;
    const all = await getUserCases({ limit: SIDEBAR_CASE_LIST_QUERY.limit, offset: 0 });
    expect(listCalls()).toHaveLength(before + 1);
    expect(all.map((c) => c.case_id)).toEqual(['case-A', 'case-B']);
    // ...and leaves the sidebar's page where it was.
    expect((await caseCacheManager.getCachedCases())?.map((c) => c.case_id)).toEqual(['case-A']);
  });

  it('the sidebar is served from the slot on its second read', async () => {
    await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    expect(listCalls()).toHaveLength(1);
  });
});

// A sidebar fetch in flight across an invalidation (a case reassigned away, a
// sign-out) lands AFTER it, with the page from before. It must not refill the
// slot, or the reload that follows is served the case it was meant to drop.
describe('a fetch in flight across an invalidation', () => {
  it('does not refill the slot with its older page', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    fetchWithTimeout.mockImplementationOnce(async () => {
      await held;
      return wire({ cases: DRIVEN });
    });

    // 1. The sidebar's fetch starts and is held at the wire.
    const inFlight = getUserCases(SIDEBAR_CASE_LIST_QUERY);
    await vi.waitFor(() => expect(listCalls()).toHaveLength(1));
    // 2. The slot is invalidated while it is out.
    await caseCacheManager.invalidateCache();
    // 3. The old page lands.
    release();
    expect((await inFlight).map((c) => c.case_id)).toEqual(['case-A']);

    // The caller still gets its answer; the slot stays empty.
    expect(await caseCacheManager.getCachedCases()).toBeNull();
  });

  // The cache read itself invalidates an expired slot. The generation is
  // captured after it, as the request goes out, or the fresh page that
  // replaces the expired one would be refused by its own read's invalidation.
  it('an expired slot is replaced by the fresh page', async () => {
    await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 6 * 60 * 1000);
    try {
      await getUserCases(SIDEBAR_CASE_LIST_QUERY);
      expect(listCalls()).toHaveLength(2);
      expect((await caseCacheManager.getCachedCases())?.map((c) => c.case_id)).toEqual(['case-A']);
    } finally {
      clock.mockRestore();
    }
  });

  it('contrast: a fetch with no invalidation in between fills the slot', async () => {
    await getUserCases(SIDEBAR_CASE_LIST_QUERY);
    expect((await caseCacheManager.getCachedCases())?.map((c) => c.case_id)).toEqual(['case-A']);
  });
});
