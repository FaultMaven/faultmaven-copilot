/**
 * A turn refused because a delete of its case is running (409
 * `x-error-code: CASE_DELETE_IN_PROGRESS`, contract 14.14.0, faultmaven#2096):
 * nothing of the turn ran, so neither turn path offers a Retry. The bubble says
 * why, and the case and the list are read back. Drives the real chain down to
 * `authenticatedFetch` and stubs only the wire.
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

const BASE = 'http://localhost:8090';
const CASE = 'case-123';
const CASE_URL = `${BASE}/api/v1/cases/${CASE}`;
const BUBBLE = "This case is being deleted, so your message wasn't added.";
const ROW = { case_id: CASE, title: 'Test', state: 'investigating' as const, owner_id: 'u1', enterprise_id: 'e1',
  created_at: '2026-10-09T09:00:00Z', updated_at: '2026-10-09T09:30:00Z' };

const wire = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, headers: new Headers(headers), json: async () => body });
const sent = (method: string, url: string) =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(([u, init]) => u === url && (init.method ?? 'GET') === method);

let stub: ReturnType<typeof createStubHost>;
const wrapper = () => ({ wrapper: hostWrapper(stub.host) });

/** Each path renders its hook, then returns the submit to run inside `act`. */
const PATHS = [
  {
    path: 'message',
    render: (onCaseChanged: (caseId: string) => void) => {
      const { result } = renderHook(() => useMessageSubmission(onCaseChanged), wrapper());
      return () => result.current.handleQuerySubmit('why is the pool exhausted?');
    },
    bubble: BUBBLE,
  },
  {
    path: 'upload',
    render: (onCaseChanged: (caseId: string) => void) => {
      const { result } = renderHook(() => useDataUpload(onCaseChanged), wrapper());
      const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
      return () => result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
    },
    // Also names what was not added; `refused` keeps it in the composer.
    bubble: `${BUBBLE}\n\nYour message and 1 file (app.log) were not added to the case. They are still in the message box.`,
    outcome: { success: false, sent: true, refused: true },
  },
];

describe('409 CASE_DELETE_IN_PROGRESS on a turn (contract 14.14.0)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    pendingOpsManager.clear();
    stub = createStubHost();
    setHostStore(stub.store);
    setApiTransport({ baseUrl: async () => BASE, accessToken: async () => 'test-token', sessionId: async () => null,
      clearSession: async () => undefined, onUnauthorized: async () => 'ended' as const });
    fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === `${CASE_URL}/turns` && method === 'POST') {
        return Promise.resolve(wire(409, { detail: 'This case is being deleted.' }, { 'x-error-code': 'CASE_DELETE_IN_PROGRESS' }));
      }
      if (url === CASE_URL && method === 'GET') return Promise.resolve(wire(200, ROW));
      return Promise.reject(new Error(`unrouted ${method} ${url}`));
    });
    useAppStore.setState({ sessionId: 'session-123', activeCaseId: CASE, hasUnsavedNewChat: false, conversations: { [CASE]: [] },
      titleSources: {}, conversationTitles: {}, pinnedCases: new Set(),
      activeCase: { ...ROW, closure_reason: null, closed_at: null, message_count: 2 } });
  });

  afterEach(() => vi.useRealTimers());

  it.each(PATHS)('$path path: sent once, no failed op and no Retry, the bubble says why, case and list read back',
    async ({ render, bubble, outcome }) => {
      const onCaseChanged = vi.fn();
      const submit = render(onCaseChanged);
      let result: unknown;
      await act(async () => { result = await submit(); });
      // Long past the keyed-turn deadline: nothing re-sends it.
      await act(async () => { await vi.advanceTimersByTimeAsync(700_000); });

      if (outcome) expect(result).toMatchObject(outcome);
      expect(sent('POST', `${CASE_URL}/turns`)).toHaveLength(1);
      // The failed-operation banner is the only Retry a turn has.
      expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
      expect(sent('GET', CASE_URL)).toHaveLength(1);
      expect(onCaseChanged).toHaveBeenCalledWith(CASE);
      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(CaseDeleteInProgressError);
      const assistant = (useAppStore.getState().conversations[CASE] ?? []).find((r) => !r.question);
      expect(assistant).toMatchObject({ response: bubble, error: true, failed: false, loading: false, optimistic: false });
    });
});
