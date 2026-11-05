/**
 * A turn refused because a delete of its case is running (409
 * `x-error-code: CASE_DELETE_IN_PROGRESS`, contract 14.14.0, faultmaven#2096):
 * nothing of the turn ran, so neither turn path offers a Retry. The bubble says
 * why, and the case and the list are read back.
 *
 * Drives the real chain down to `authenticatedFetch` and stubs only the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { CaseDeleteInProgressError } from '@faultmaven/copilot-ui/lib/errors/types';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
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
const BUBBLE = "This case is being deleted, so your message wasn't added.";

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

const ROW = {
  case_id: CASE,
  title: 'Test',
  state: 'investigating' as const,
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:30:00Z',
  user_id: 'u1',
  enterprise_id: 'e1',
};

const sent = (method: string, url: string) =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(
    ([u, init]) => u === url && (init.method ?? 'GET') === method,
  );

const assistant = () => (useAppStore.getState().conversations[CASE] ?? []).find((r) => !r.question);

describe('409 CASE_DELETE_IN_PROGRESS on a turn (contract 14.14.0)', () => {
  let stub: ReturnType<typeof createStubHost>;
  const onCaseChanged = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
    fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === TURNS_URL && method === 'POST') {
        return Promise.resolve(
          wire(409, { detail: 'This case is being deleted. Reload the case.' }, { 'x-error-code': 'CASE_DELETE_IN_PROGRESS' }),
        );
      }
      if (url === CASE_URL && method === 'GET') return Promise.resolve(wire(200, ROW));
      return Promise.reject(new Error(`unrouted ${method} ${url}`));
    });
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      activeCase: { ...ROW, owner_id: 'u1', closure_reason: null, closed_at: null, message_count: 2 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sent once, past the keyed-turn deadline; no failed op, so no Retry; case and list read back. */
  const expectReloadedNotRetried = () => {
    expect(sent('POST', TURNS_URL)).toHaveLength(1);
    expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
    expect(sent('GET', CASE_URL)).toHaveLength(1);
    expect(onCaseChanged).toHaveBeenCalledWith(CASE);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(CaseDeleteInProgressError);
    expect(assistant()).toMatchObject({ error: true, failed: false, loading: false, optimistic: false });
  };

  it('message path: the bubble says the case is being deleted', async () => {
    const { result } = renderHook(() => useMessageSubmission(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });

    expectReloadedNotRetried();
    expect(assistant()?.response).toBe(BUBBLE);
  });

  it('upload path: the bubble also names what was not added, and the composer keeps it', async () => {
    const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
    const { result } = renderHook(() => useDataUpload(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    let outcome: { success: boolean; sent: boolean; refused?: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });

    expect(outcome).toMatchObject({ success: false, sent: true, refused: true });
    expectReloadedNotRetried();
    expect(assistant()?.response).toBe(
      `${BUBBLE}\n\nYour message and 1 file (app.log) were not added to the case. They are still in the message box.`,
    );
  });
});
