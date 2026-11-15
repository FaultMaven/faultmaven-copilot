/**
 * A case being deleted (contract 14.15.0, #401). A turn refused with 409
 * `CASE_DELETE_IN_PROGRESS` reads the case back; that read could land before
 * the delete committed, find the case live, and nothing read it again, so the
 * composer stayed open until the next write met the 404.
 *
 * Now `GET /cases/{id}` says `deleting: true` while the delete runs. The read
 * flags the case (the panel renders it read-only) and, while it is the open
 * case, reads it again on the contract's backoff (2 s doubling to 10 s, none
 * starting past 60 s) until it is gone (closed, as #384) or the flag clears.
 * Drives the real chain down to `fetchWithTimeout`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { bumpEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { idMappingManager, pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { nextDeletingReread } from '@faultmaven/copilot-ui/lib/cases/deleting';
import { createStubHost, hostWrapper } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/errors')>()),
  useError: () => ({ showError: vi.fn(), dismissError: vi.fn() }),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const BASE = 'http://localhost:8090';
const CASE = 'case-123';
const OTHER = 'case-456';
const CASE_URL = `${BASE}/api/v1/cases/${CASE}`;
const ROW = { case_id: CASE, title: 'Test', state: 'investigating' as const, user_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:30:00Z' };
const DELETING = { ...ROW, deleting: true };
const LIVE = { ...ROW, deleting: false };
const GONE = { detail: 'Case not found or access denied' };

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, headers: new Headers(headers), json: async () => body });

/** What `GET /cases/{id}` answers, read by read. */
let readAnswer: () => ReturnType<typeof wire>;
let stub: ReturnType<typeof createStubHost>;
const reads = () =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(([u, init]) => u === CASE_URL && (init.method ?? 'GET') === 'GET').length;

const openCase = (id = CASE) => useAppStore.setState({
  activeCaseId: id, hasUnsavedNewChat: false, goneCaseNotice: null,
  activeCase: { ...ROW, case_id: id, owner_id: 'u1', closure_reason: null, closed_at: null, message_count: 2 },
});
const readBack = async (id = CASE) => {
  await act(async () => { await useAppStore.getState().readCaseBack(id); });
};
/** Lets `ms` pass, settling each read the timers start. */
const pass = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
const flagged = () => useAppStore.getState().deletingCaseIds[CASE] === true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  pendingOpsManager.clear();
  stub = createStubHost();
  setHostStore(stub.store);
  setApiTransport({ baseUrl: async () => BASE, accessToken: async () => 'test-token', sessionId: async () => null,
    clearSession: async () => undefined, onUnauthorized: async () => 'ended' as const });
  readAnswer = () => wire(200, DELETING);
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === CASE_URL && method === 'GET') return Promise.resolve(readAnswer());
    if (url === `${CASE_URL}/turns` && method === 'POST') {
      return Promise.resolve(wire(409, { detail: 'This case is being deleted.' }, { 'x-error-code': 'CASE_DELETE_IN_PROGRESS' }));
    }
    // The sidebar's list reload: answered, so it settles.
    if (url.startsWith(`${BASE}/api/v1/cases?`) && method === 'GET') return Promise.resolve(wire(200, []));
    return Promise.reject(new Error(`unrouted ${method} ${url}`));
  });
  useAppStore.setState({ sessionId: 'session-123', conversations: { [CASE]: [] }, titleSources: {},
    conversationTitles: {}, pinnedCases: new Set(), deletingCaseIds: {}, writeDeniedCaseIds: {} });
  openCase();
});

afterEach(() => {
  useAppStore.getState().stopDeletingRereads();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the backoff (contract 14.15.0)', () => {
  it('waits 2 s, 4 s, 8 s, then every 10 s', () => {
    expect(nextDeletingReread(null, 0)).toBe(2_000);
    expect(nextDeletingReread(2_000, 2_000)).toBe(4_000);
    expect(nextDeletingReread(4_000, 6_000)).toBe(8_000);
    expect(nextDeletingReread(8_000, 14_000)).toBe(10_000);
    expect(nextDeletingReread(10_000, 24_000)).toBe(10_000);
  });

  it('starts no re-read past 60 s on the wall clock, slow reads included', () => {
    expect(nextDeletingReread(10_000, 50_000)).toBe(10_000);
    expect(nextDeletingReread(10_000, 50_001)).toBeNull();
    // Slow reads: the schedule is wall-clock time, not the sum of the waits.
    expect(nextDeletingReread(4_000, 55_000)).toBeNull();
  });
});

describe('a read that says the case is being deleted (#401)', () => {
  it('flags the case and reads it again until it is gone, then closes it', async () => {
    await readBack();
    expect(flagged()).toBe(true);
    expect(reads()).toBe(1);

    await pass(1_999);
    expect(reads()).toBe(1);
    await pass(1);
    expect(reads()).toBe(2);

    readAnswer = () => wire(404, GONE);
    await pass(4_000);

    expect(reads()).toBe(3);
    expect(flagged()).toBe(false);
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: null, activeCase: null, goneCaseNotice: { caseId: CASE } });
    await pass(60_000);
    expect(reads()).toBe(3);
  });

  it('stops, and the case is writable again, when the flag clears', async () => {
    await readBack();
    readAnswer = () => wire(200, LIVE);
    await pass(2_000);

    expect(flagged()).toBe(false);
    expect(useAppStore.getState().activeCaseId).toBe(CASE);
    await pass(60_000);
    expect(reads()).toBe(2);
  });

  it('keeps to the backoff and stops at the cap, leaving the case read-only', async () => {
    await readBack();
    await pass(120_000);

    // 2, 6, 14, 24, 34, 44, 54 s after the first read: seven re-reads.
    expect(reads()).toBe(8);
    expect(flagged()).toBe(true);
  });

  it('a failed re-read keeps to the backoff', async () => {
    await readBack();
    readAnswer = () => wire(400, { detail: 'nope' });
    await pass(2_000);
    expect(reads()).toBe(2);
    expect(flagged()).toBe(true);

    readAnswer = () => wire(404, GONE);
    await pass(4_000);
    expect(reads()).toBe(3);
    expect(useAppStore.getState().activeCaseId).toBeNull();
  });

  it('a second read while re-reads run opens no second chain', async () => {
    await readBack();
    await readBack();
    await pass(2_000);

    expect(reads()).toBe(3); // two reads, one re-read
  });

  it('opening the case again after the cap starts a fresh window', async () => {
    await readBack();
    await pass(120_000);
    const before = reads();

    await readBack(); // what opening the case does (`handleCaseSelect` → `refreshActiveCase`)
    await pass(2_000);

    expect(reads()).toBe(before + 2);
  });

  it('stops when another case is opened; the flag stays for when it is opened again', async () => {
    await readBack();
    openCase(OTHER);
    await pass(60_000);

    expect(reads()).toBe(1);
    expect(flagged()).toBe(true);
  });

  it('stops when the session changes', async () => {
    await readBack();
    bumpEpoch();
    await pass(60_000);

    expect(reads()).toBe(1);
  });

  it('stops when the panel unmounts (`stopDeletingRereads`)', async () => {
    await readBack();
    useAppStore.getState().stopDeletingRereads();
    await pass(60_000);

    expect(reads()).toBe(1);
  });

  it('a read of a case that is not open flags it and does not re-read it', async () => {
    openCase(OTHER);
    await readBack(CASE);
    await pass(60_000);

    expect(flagged()).toBe(true);
    expect(reads()).toBe(1);
  });

  it('an open pointer still optimistic is the case: flagged under the real id, re-read', async () => {
    idMappingManager.addMapping('opt_case_1', CASE);
    openCase('opt_case_1');
    await readBack('opt_case_1');
    await pass(2_000);

    expect(flagged()).toBe(true);
    expect(reads()).toBe(2);
  });
});

describe('a turn refused while a delete runs (14.14.0 + 14.15.0)', () => {
  it('whose read-back says deleting: read-only now, closed once the delete lands', async () => {
    const { result } = renderHook(() => useMessageSubmission(vi.fn()), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      const done = result.current.handleQuerySubmit('why is the pool exhausted?');
      await vi.advanceTimersByTimeAsync(0);
      await done;
    });

    expect(flagged()).toBe(true);
    expect(useAppStore.getState().activeCaseId).toBe(CASE);

    readAnswer = () => wire(404, GONE);
    await pass(2_000);

    expect(useAppStore.getState()).toMatchObject({ activeCaseId: null, goneCaseNotice: { caseId: CASE } });
    expect(flagged()).toBe(false);
  });
});

describe('sign-out', () => {
  it('clears the flags', async () => {
    await readBack();
    await act(async () => { useAppStore.getState().setSignedInUser(null); await vi.advanceTimersByTimeAsync(0); });
    expect(useAppStore.getState().deletingCaseIds).toEqual({});
  });
});
