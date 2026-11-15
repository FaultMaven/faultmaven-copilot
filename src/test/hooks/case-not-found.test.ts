/**
 * A case deleted elsewhere (#384). The API answers 404 "Case not found or
 * access denied" on `GET /cases/{id}` and on the turn route once the case is
 * gone. Before, the read-back swallowed it (the case stayed open with a live
 * composer) and a turn read as "Invalid Input" with a Retry that could only
 * meet the same 404.
 *
 * Now a turn's 404 has no failed op and no Retry. A labelled one
 * (`CASE_NOT_FOUND`, faultmaven#2806) is `CaseNotFoundError`; an unlabelled one
 * (an older core, or the turn route's 404 for evidence or a file inside the
 * case) is read back, and the row decides: gone, or the server's own text with
 * the case left open. The read-back's 404 closes the case when it is still the
 * open one (an optimistic pointer the mapping resolves to it included), raises
 * `goneCaseNotice` for the panel, and reloads the sidebar past its cache.
 * Drives the real chain down to `fetchWithTimeout`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { CaseDeleteInProgressError, CaseNotFoundError } from '@faultmaven/copilot-ui/lib/errors/types';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { bumpEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { applyCaseTitleChange } from '@faultmaven/copilot-ui/lib/state/case-title-change';
import { titleChangeDeps } from '@faultmaven/copilot-ui/lib/state/case-title-deps';
import { idMappingManager } from '@faultmaven/copilot-ui/lib/optimistic';
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

const BASE = 'http://localhost:8090';
const CASE = 'case-123';
const OTHER = 'case-456';
const CASE_URL = `${BASE}/api/v1/cases/${CASE}`;
const BUBBLE = "This case no longer exists, so your message wasn't added.";
const ROW = { case_id: CASE, title: 'Test', state: 'investigating' as const, owner_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:30:00Z' };
const GONE = { detail: 'Case not found or access denied' };

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, headers: new Headers(headers), json: async () => body });
const sent = (method: string, url: string) =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(([u, init]) => u === url && (init.method ?? 'GET') === method);

let stub: ReturnType<typeof createStubHost>;
/** What the turn route answers, in order; the last one repeats. */
let turnAnswers: Array<ReturnType<typeof wire>>;
/** What `GET /cases/{id}` answers. */
let readAnswer: () => ReturnType<typeof wire>;
let refreshOn401: 'refreshed' | 'ended';
const wrapper = () => ({ wrapper: hostWrapper(stub.host) });

const PATHS = [
  {
    path: 'message',
    render: () => {
      const { result } = renderHook(() => useMessageSubmission(vi.fn()), wrapper());
      return () => result.current.handleQuerySubmit('why is the pool exhausted?');
    },
    bubble: BUBBLE,
  },
  {
    path: 'upload',
    render: () => {
      const { result } = renderHook(() => useDataUpload(vi.fn()), wrapper());
      const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
      return () => result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
    },
    bubble: `${BUBBLE}\n\nYour message and 1 file (app.log) were not added to the case. They are still in the message box.`,
    // An unlabelled 404 is read back, as a 403 is: the bubble is the read's.
    unlabelledBubble: BUBBLE,
    outcome: { success: false, sent: true, refused: true },
  },
];

const openCase = (id = CASE) => useAppStore.setState({
  activeCaseId: id, hasUnsavedNewChat: false, goneCaseNotice: null,
  activeCase: { ...ROW, case_id: id, closure_reason: null, closed_at: null, message_count: 2 },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  pendingOpsManager.clear();
  stub = createStubHost();
  setHostStore(stub.store);
  refreshOn401 = 'ended';
  setApiTransport({ baseUrl: async () => BASE, accessToken: async () => 'test-token', sessionId: async () => null,
    clearSession: async () => undefined, onUnauthorized: async () => refreshOn401 });
  turnAnswers = [wire(404, GONE)];
  readAnswer = () => wire(404, GONE);
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === `${CASE_URL}/turns` && method === 'POST') {
      return Promise.resolve(turnAnswers.length > 1 ? turnAnswers.shift()! : turnAnswers[0]);
    }
    if ((url === CASE_URL || url === `${BASE}/api/v1/cases/${OTHER}`) && method === 'GET') return Promise.resolve(readAnswer());
    return Promise.reject(new Error(`unrouted ${method} ${url}`));
  });
  useAppStore.setState({ sessionId: 'session-123', conversations: { [CASE]: [] }, titleSources: {},
    conversationTitles: {}, pinnedCases: new Set() });
  openCase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const assistant = () => (useAppStore.getState().conversations[CASE] ?? []).find((r) => !r.question);

describe('a turn on a case that answers 404 (#384)', () => {
  /** Submits on the path, long past the keyed-turn deadline (nothing re-sends it). */
  async function submit(render: (typeof PATHS)[number]['render']) {
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache');
    const reloads = useAppStore.getState().refreshSessions;
    const run = render();
    let result: unknown;
    await act(async () => { result = await run(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });
    return { result, invalidate, reloads: () => useAppStore.getState().refreshSessions - reloads };
  }

  it.each(PATHS.flatMap((p) => [
    { ...p, label: 'CASE_NOT_FOUND', labelled: true },
    { ...p, label: 'unlabelled (an older core)', labelled: false },
  ]))('$path path, $label: sent once, no Retry, the bubble says the case is gone, and the read-back closes it',
    async ({ render, bubble, unlabelledBubble, outcome, labelled }) => {
      if (labelled) {
        turnAnswers = [wire(404, GONE, { 'x-error-code': 'CASE_NOT_FOUND' })];
        readAnswer = () => wire(404, GONE, { 'x-error-code': 'CASE_NOT_FOUND' });
      }
      const { result, invalidate, reloads } = await submit(render);

      if (outcome) expect(result).toMatchObject(outcome);
      expect(sent('POST', `${CASE_URL}/turns`)).toHaveLength(1);
      // The failed-operation banner is the only Retry a turn has.
      expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
      expect(assistant()).toMatchObject({
        response: labelled ? bubble : (unlabelledBubble ?? bubble),
        error: true, failed: false, loading: false, optimistic: false,
      });
      // The labelled refusal is shown at once; the read-back's notice is the
      // panel's toast (`goneCaseNotice`) either way.
      if (labelled) {
        expect(mockShowError).toHaveBeenCalledTimes(1);
        expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(CaseNotFoundError);
      } else {
        expect(mockShowError).not.toHaveBeenCalled();
      }

      // The read-back met the same 404: the case closed and its row leaves the list.
      expect(sent('GET', CASE_URL)).toHaveLength(1);
      const state = useAppStore.getState();
      expect(state.activeCaseId).toBeNull();
      expect(state.activeCase).toBeNull();
      expect(state.hasUnsavedNewChat).toBe(false);
      expect(state.goneCaseNotice).toEqual({ caseId: CASE });
      expect(invalidate).toHaveBeenCalled();
      expect(reloads()).toBe(1);
      // The persisted pointer goes too, so a reopened panel does not restore it.
      expect(await stub.store.get(['faultmaven_current_case'])).toEqual({});
    });

  it('a 404 arriving as an HttpError (after a credential refresh) reads the same', async () => {
    refreshOn401 = 'refreshed';
    turnAnswers = [wire(401, { detail: 'token expired' }), wire(404, GONE)];
    await submit(PATHS[0].render);

    expect(sent('POST', `${CASE_URL}/turns`)).toHaveLength(2);
    expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
    expect(assistant()).toMatchObject({ response: BUBBLE, failed: false });
    expect(useAppStore.getState().goneCaseNotice).toEqual({ caseId: CASE });
  });

  it.each(PATHS)('$path path: an unlabelled 404 for something inside a case that reads back leaves it open, with the server’s text',
    async ({ render }) => {
      // A reclassification of a file removed since: the turn route's 404 for
      // the file, not the case. The case reads back.
      const missing = { detail: 'UploadedFile not found: file_0001' };
      turnAnswers = [wire(404, missing)];
      readAnswer = () => wire(200, ROW);
      await submit(render);

      expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
      expect(assistant()).toMatchObject({ response: missing.detail, error: true, failed: false });
      const state = useAppStore.getState();
      expect(state.activeCaseId).toBe(CASE);
      expect(state.goneCaseNotice).toBeNull();
      expect(mockShowError).not.toHaveBeenCalled();
    });

  it('a gone case whose open pointer is still its optimistic id closes', async () => {
    const OPT = 'opt_case_0001';
    idMappingManager.addMapping(OPT, CASE);
    try {
      openCase(OPT);
      useAppStore.setState({ conversations: { [CASE]: [], [OPT]: [] } });
      let row: unknown;
      await act(async () => { row = await useAppStore.getState().refreshActiveCase(CASE); });
      expect(row).toBeNull();
      expect(useAppStore.getState()).toMatchObject({ activeCaseId: null, activeCase: null, goneCaseNotice: { caseId: CASE } });
    } finally {
      idMappingManager.removeMapping(OPT);
    }
  });

  it('a turn refused while a delete runs, whose read-back finds the delete done, closes the case', async () => {
    turnAnswers = [wire(409, { detail: 'This case is being deleted.' }, { 'x-error-code': 'CASE_DELETE_IN_PROGRESS' })];
    await submit(PATHS[0].render);

    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(CaseDeleteInProgressError);
    expect(useAppStore.getState().activeCase).toBeNull();
    expect(useAppStore.getState().goneCaseNotice).toEqual({ caseId: CASE });
  });
});

describe('the read-back of a case that answers 404 (#384)', () => {
  const refresh = async (id = CASE) => {
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache');
    const reloads = useAppStore.getState().refreshSessions;
    let row: unknown;
    await act(async () => { row = await useAppStore.getState().refreshActiveCase(id); });
    return { row, invalidate, reloads: () => useAppStore.getState().refreshSessions - reloads };
  };

  it('closes the open case, raises the notice and reloads the list', async () => {
    const { row, invalidate, reloads } = await refresh();
    expect(row).toBeNull();
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: null, activeCase: null, goneCaseNotice: { caseId: CASE } });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(reloads()).toBe(1);
  });

  it('a case the user moved away from leaves the list only: the open case stays, no notice', async () => {
    openCase(OTHER);
    const { reloads } = await refresh(CASE);
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: OTHER, goneCaseNotice: null });
    expect(useAppStore.getState().activeCase?.case_id).toBe(OTHER);
    expect(reloads()).toBe(1);
  });

  it('a 404 landing after a session change writes nothing', async () => {
    readAnswer = () => { bumpEpoch(); return wire(404, GONE); };
    const { invalidate, reloads } = await refresh();
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: CASE, goneCaseNotice: null });
    expect(invalidate).not.toHaveBeenCalled();
    expect(reloads()).toBe(0);
  });

  it.each([
    { what: 'a 500', answer: () => wire(500, { detail: 'boom' }) },
    { what: 'a 403', answer: () => wire(403, { detail: 'forbidden' }) },
  ])('$what is not a gone case: the case stays open', async ({ answer }) => {
    readAnswer = answer;
    const { row, reloads } = await refresh();
    expect(row).toBeNull();
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: CASE, goneCaseNotice: null });
    expect(useAppStore.getState().activeCase?.case_id).toBe(CASE);
    expect(reloads()).toBe(0);
  });

  it('a row that reads back closes nothing', async () => {
    readAnswer = () => wire(200, ROW);
    const { row } = await refresh();
    expect(row).toMatchObject({ case_id: CASE });
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: CASE, goneCaseNotice: null });
  });
});

describe('the labelled 404 (faultmaven#2806) reads the same as the unlabelled one', () => {
  it('a turn answered 404 CASE_NOT_FOUND: no Retry, the ruled bubble, the case closes', async () => {
    turnAnswers = [wire(404, GONE, { 'x-error-code': 'CASE_NOT_FOUND' })];
    readAnswer = () => wire(404, GONE, { 'x-error-code': 'CASE_NOT_FOUND' });
    const run = PATHS[0].render();
    await act(async () => { await run(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });

    expect(sent('POST', `${CASE_URL}/turns`)).toHaveLength(1);
    expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
    expect(assistant()).toMatchObject({ response: BUBBLE, failed: false });
    expect(useAppStore.getState()).toMatchObject({ activeCase: null, goneCaseNotice: { caseId: CASE } });
  });
});

describe('a refused rename is read back (#384, faultmaven#2806)', () => {
  const showError = vi.fn();
  /** The PUT answers `put`; the read-back answers `readAnswer`. */
  async function rename(put: ReturnType<typeof wire>) {
    const base = fetchWithTimeout.getMockImplementation()!;
    fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) =>
      (url === CASE_URL && init.method === 'PUT' ? Promise.resolve(put) : base(url, init)));
    const reloads = useAppStore.getState().refreshSessions;
    await act(async () => {
      await applyCaseTitleChange(CASE, 'Renamed', 'user', titleChangeDeps(showError));
    });
    return () => useAppStore.getState().refreshSessions - reloads;
  }
  beforeEach(() => {
    showError.mockClear();
    useAppStore.setState({ currentUser: { id: 'u1', username: 'me', roles: [] } as never, writeDeniedCaseIds: {} });
  });

  it('an unlabelled 404 whose read-back 404s: the case is gone — closed, off the list, the ruled toast', async () => {
    const reloads = await rename(wire(404, GONE));
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError.mock.calls[0][0]).toBeInstanceOf(CaseNotFoundError);
    expect(useAppStore.getState()).toMatchObject({ activeCase: null, goneCaseNotice: { caseId: CASE } });
    expect(reloads()).toBe(1);
  });

  it('an unlabelled 404 whose read-back names another driver: handed off — read-only, off the list, the driver notice', async () => {
    readAnswer = () => wire(200, { ...ROW, driver_id: 'u2' });
    const reloads = await rename(wire(404, GONE));
    expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: "Only the case's driver can add to it." }));
    expect(useAppStore.getState().writeDeniedCaseIds[CASE]).toBe(true);
    expect(useAppStore.getState().activeCase?.case_id).toBe(CASE);
    expect(useAppStore.getState().goneCaseNotice).toBeNull();
    expect(reloads()).toBe(1);
  });

  it('403 CASE_NOT_DRIVER reads the same', async () => {
    readAnswer = () => wire(200, { ...ROW, driver_id: 'u2' });
    await rename(wire(403, { detail: 'Only the driver may rename this case.' }, { 'x-error-code': 'CASE_NOT_DRIVER' }));
    expect(useAppStore.getState().writeDeniedCaseIds[CASE]).toBe(true);
  });

  it('a 404 whose read-back names the viewer as driver says what the server said', async () => {
    readAnswer = () => wire(200, { ...ROW, driver_id: 'u1' });
    await rename(wire(404, GONE));
    expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: GONE.detail }));
    expect(useAppStore.getState()).toMatchObject({ activeCaseId: CASE, goneCaseNotice: null, writeDeniedCaseIds: {} });
  });
});

describe('a turn refused 403 whose read-back finds the case gone', () => {
  it('the bubble says the case is gone, not the server’s permission text', async () => {
    turnAnswers = [wire(403, { detail: 'Only the driver may add to this case.' }, { 'x-error-code': 'CASE_NOT_DRIVER' })];
    const run = PATHS[0].render();
    await act(async () => { await run(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });
    expect(assistant()).toMatchObject({ response: BUBBLE, failed: false });
    expect(useAppStore.getState().activeCase).toBeNull();
  });
});
