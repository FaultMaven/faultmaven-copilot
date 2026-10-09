/**
 * A terminal-case 409 (`x-error-code: CASE_TERMINAL`, contract 12.3.0,
 * faultmaven#1908) on every path this client sends one on: the turn route
 * (a status change or a file reclassification from the message path, new data
 * from the upload path) and the title rename (`PUT /cases/{id}`).
 *
 * Each drives the real chain down to `authenticatedFetch` and stubs only the
 * wire (`fetchWithTimeout`), with a closed case row served for the read-back,
 * so "the panel shows the case closed" is asserted on the store, not on a spy.
 * This client never calls `POST /cases/{id}/close`: closing is a
 * `status_transition` turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { updateCaseTitle } from '@faultmaven/copilot-ui/lib/api/services/case-service';
import { applyCaseTitleChange } from '@faultmaven/copilot-ui/lib/state/case-title-change';
import { IntentType, type TurnIntent } from '@faultmaven/copilot-ui/lib/api/types';
import { CaseTerminalError, CaseVersionConflictError } from '@faultmaven/copilot-ui/lib/errors/types';
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

interface WireResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
}

const wire = (status: number, body: unknown, headers: Record<string, string> = {}): WireResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

const caseTerminal = (detail: string) => wire(409, { detail }, { 'x-error-code': 'CASE_TERMINAL' });

/** The case row as the server holds it: closed elsewhere (the Dashboard, another tab). */
const CLOSED_ROW = {
  case_id: CASE,
  title: 'Test',
  state: 'closed',
  closure_reason: 'abandoned',
  closed_at: '2026-10-09T09:30:00Z',
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:30:00Z',
  user_id: 'u1',
  enterprise_id: 'e1',
};

/** Turn POSTs and title PUTs get `refusal`; the case read gets the closed row. */
function routeWire(refusal: () => WireResponse) {
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === TURNS_URL && method === 'POST') return Promise.resolve(refusal());
    if (url === CASE_URL && method === 'PUT') return Promise.resolve(refusal());
    if (url === CASE_URL && method === 'GET') return Promise.resolve(wire(200, CLOSED_ROW));
    return Promise.reject(new Error(`unrouted ${method} ${url}`));
  });
}

const sent = (method: string, url: string) =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(
    ([u, init]) => u === url && (init.method ?? 'GET') === method,
  );

const rows = (): OptimisticConversationItem[] => useAppStore.getState().conversations[CASE] ?? [];
const assistant = () => rows().find((r) => !r.question);
const failedOps = () => pendingOpsManager.getByStatus('failed');

describe('409 CASE_TERMINAL (contract 12.3.0)', () => {
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
    // The panel still believes the case is live.
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      activeCase: {
        case_id: CASE,
        title: 'Test',
        state: 'investigating',
        created_at: '2026-10-09T09:00:00Z',
        owner_id: 'u1',
        enterprise_id: 'e1',
        closure_reason: null,
        closed_at: null,
        message_count: 2,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /** What every path must show: the closed state, read back; one toast; no Retry anywhere. */
  const expectClosedAndFinal = () => {
    expect(sent('GET', CASE_URL)).toHaveLength(1);
    expect(useAppStore.getState().activeCase?.state).toBe('closed');
    expect(useAppStore.getState().activeCase?.closed_at).toBe('2026-10-09T09:30:00Z');
    expect(mockShowError).toHaveBeenCalledTimes(1);
    const shown = mockShowError.mock.calls[0][0];
    expect(shown).toBeInstanceOf(CaseTerminalError);
    expect(shown).not.toBeInstanceOf(CaseVersionConflictError);
    // The failed-operation banner is the only Retry a turn has.
    expect(failedOps()).toHaveLength(0);
  };

  const intents: Array<[string, TurnIntent]> = [
    ['a status change', { type: IntentType.StatusTransition, from_state: 'investigating', to_state: 'closed', user_confirmed: true }],
    ['a file reclassification', { type: 'file_reclassification', file_id: 'file_1', data_type: 'log' }],
  ];

  it.each(intents)('message path, %s: sent once, the bubble says closed, the case is read back', async (_label, intent) => {
    routeWire(() => caseTerminal('Cannot change status of a closed case.'));
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('Please close this case.', intent);
    });
    // Long past the keyed-turn deadline: nothing re-sends it.
    await advance(700_000);

    expect(sent('POST', TURNS_URL)).toHaveLength(1);
    expectClosedAndFinal();
    const bubble = assistant();
    expect(bubble?.response).toBe('This case is closed and read-only. You can still ask questions about it.');
    expect(bubble).toMatchObject({ error: true, failed: false, loading: false, optimistic: false });
    expect(bubble?.response).not.toMatch(/updated|retry/i);
  });

  it('upload path, new data: sent once, names what was not added (no Retry), the case is read back', async () => {
    routeWire(() => caseTerminal('Cannot submit new data to a closed case. Only questions about the case are allowed.'));
    const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: { success: boolean; sent: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
    });
    await advance(700_000);

    expect(sent('POST', TURNS_URL)).toHaveLength(1);
    // Sent and refused: the composer clears (the attachment controls are off now).
    expect(outcome).toMatchObject({ success: false, sent: true });
    expectClosedAndFinal();
    const bubble = assistant();
    expect(bubble?.response).toBe(
      'This case is closed and read-only. You can still ask questions about it.\n\n' +
        'Your message and 1 file (app.log) were not added to the case.',
    );
    expect(bubble).toMatchObject({ error: true, failed: false });
    expect(bubble?.response).not.toMatch(/updated|retry/i);
  });

  it('title rename (PUT /cases/{id}): sent once, CaseTerminalError shown, rolled back, the case is read back', async () => {
    routeWire(() => caseTerminal('Case is closed'));
    useAppStore.setState({ conversationTitles: { [CASE]: 'Prior title' } });
    const store = useAppStore.getState();

    await act(async () => {
      await applyCaseTitleChange(CASE, 'Attempted rename', 'user', {
        readStore: () => useAppStore.getState(),
        setConversationTitles: store.setConversationTitles,
        setTitleSources: store.setTitleSources,
        persistTitle: updateCaseTitle,
        onPersistError: mockShowError,
        refreshCase: (id) => { void useAppStore.getState().refreshActiveCase(id); },
      });
    });
    await advance(10);

    expect(sent('PUT', CASE_URL)).toHaveLength(1);
    expectClosedAndFinal();
    expect(useAppStore.getState().conversationTitles[CASE]).toBe('Prior title');
  });

  it('contrast: an unlabelled 409 on the message path keeps today’s version-conflict path and its Retry', async () => {
    routeWire(() => wire(409, { detail: 'conflict' }));
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await advance(10);

    expect(sent('POST', TURNS_URL)).toHaveLength(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(CaseVersionConflictError);
    expect(failedOps()).toHaveLength(1);
    expect(assistant()).toMatchObject({ failed: true });
  });
});
