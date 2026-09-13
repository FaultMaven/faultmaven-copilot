import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost, hostWrapper } from '../support/host';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

const okTurnResponse = {
  agent_response: 'Analyzed.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'inquiry',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

const mockShowError = vi.fn();

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn()
}));

vi.mock('@faultmaven/copilot-ui/lib/errors', () => ({
  useError: () => ({
    showError: mockShowError,
    dismissError: vi.fn()
  }),
  useErrorHandler: () => ({
    errors: [],
    showError: mockShowError,
    dismissError: vi.fn(),
    dismissAll: vi.fn(),
    getErrorsByType: () => [],
    hasError: () => false
  })
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn())
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  })
}));

describe('useDataUpload — error surfacing regression guard', () => {
  let stub: ReturnType<typeof createStubHost>;
  const render = () =>
    renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    // The slice is the single writer of the active-case pointer and reaches
    // storage through the host, so the bridge points at the same stub: what
    // these assert is that ONE writer wrote, not which layer called it.
    setHostStore(stub.store);
    mockShowError.mockClear();
    // The pending-ops manager is a module singleton that outlives a render, so
    // clear it (and the id counters) between tests to avoid cross-test leakage.
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();

    // Set initial Zustand store state for the test
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      conversations: { 'case-123': [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      caseEvidence: {}
    });
  });

  it('calls showError when submitTurn throws (e.g. 504 timeout)', async () => {
    (api.submitTurn as any).mockRejectedValue(
      Object.assign(new Error('Request timeout - processing is taking longer than expected. Please try again.'), {
        status: 504
      })
    );

    const { result } = render();

    let submissionResult: { success: boolean; message: string } | undefined;
    await act(async () => {
      submissionResult = await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    // The user-facing surface: global toast must fire.
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'turn_submit' })
    );

    // And the existing contract with UnifiedInputBar stays intact.
    expect(submissionResult?.success).toBe(false);
    expect(submissionResult?.message).toBeTruthy();
  });

  it('uses opt_ optimistic IDs for the user and AI messages (data-integrity rule)', async () => {
    (api.submitTurn as any).mockResolvedValue(okTurnResponse);

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    const messages = useAppStore.getState().conversations['case-123'];
    expect(messages).toHaveLength(2);
    for (const msg of messages) {
      expect(OptimisticIdGenerator.isOptimisticMessage(msg.id)).toBe(true);
    }
  });

  it('registers a retryable submit_query pending op when the turn fails', async () => {
    (api.submitTurn as any).mockRejectedValue(
      Object.assign(new Error('Request timeout'), { status: 504 })
    );

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    // The failed-operation banner reads getFailedOperationsForUser(); it must now
    // find the upload turn (previously nothing was registered → no retry path).
    const failed = useAppStore.getState().getFailedOperationsForUser();
    expect(failed).toHaveLength(1);
    expect(failed[0].type).toBe('submit_query');
    expect(failed[0].optimisticData?.caseId).toBe('case-123');
    expect(typeof failed[0].retryFn).toBe('function');
    expect(OptimisticIdGenerator.isOptimisticMessage(failed[0].id)).toBe(true);

    // The failed turn stays visible (not rolled back) so the user can retry it,
    // and the AI bubble carries the error text (parity with useMessageSubmission)
    // rather than rendering an empty red bubble.
    const messages = useAppStore.getState().conversations['case-123'];
    expect(messages).toHaveLength(2);
    const aiItem = messages[1] as any;
    expect(aiItem.error).toBe(true);
    expect(aiItem.failed).toBe(true);
    expect(aiItem.response).toBeTruthy();
  });

  it('retry re-sends the same turn (stable Idempotency-Key) and clears the failure', async () => {
    (api.submitTurn as any)
      .mockRejectedValueOnce(Object.assign(new Error('Request timeout'), { status: 504 }))
      .mockResolvedValueOnce(okTurnResponse);

    const onError = vi.fn();
    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    const opId = useAppStore.getState().getFailedOperationsForUser()[0].id;

    await act(async () => {
      await useAppStore.getState().handleUserRetry(opId, onError);
    });

    // Two submissions total, both carrying the same per-turn Idempotency-Key so
    // the backend dedupes rather than committing a second turn.
    expect((api.submitTurn as any).mock.calls).toHaveLength(2);
    const firstKey = (api.submitTurn as any).mock.calls[0][2].idempotencyKey;
    const secondKey = (api.submitTurn as any).mock.calls[1][2].idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(OptimisticIdGenerator.isOptimisticMessage(firstKey)).toBe(true);

    // The successful retry clears the failed affordance.
    expect(useAppStore.getState().getFailedOperationsForUser()).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
  });

  // Regression: issue #147 — a stale opt_case_* left in activeCaseId by a prior
  // failed case-create must not be POSTed against (backend 404s). With no mapping,
  // the guard discards it and a fresh real case is created.
  it('creates a fresh real case instead of submitting a turn against a stale opt_case_*', async () => {
    useAppStore.setState({ activeCaseId: 'opt_case_stale', conversations: {} });
    (api.createCase as any).mockResolvedValue({
      case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry'
    });
    (api.submitTurn as any).mockResolvedValue(okTurnResponse);

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    expect(api.createCase).toHaveBeenCalled();
    expect(api.submitTurn).toHaveBeenCalledWith(
      'real-case-id', expect.anything(), expect.anything()
    );
    expect(api.submitTurn).not.toHaveBeenCalledWith(
      'opt_case_stale', expect.anything(), expect.anything()
    );
  });
});

describe('useDataUpload — reaches storage through the host', () => {
  let stub: ReturnType<typeof createStubHost>;
  const render = () =>
    renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    // The slice is the single writer of the active-case pointer and reaches
    // storage through the host, so the bridge points at the same stub: what
    // these assert is that ONE writer wrote, not which layer called it.
    setHostStore(stub.store);
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: null,
      conversations: {},
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      caseEvidence: {}
    });
  });

  // The single converted call site in this hook. Nothing here mocks the
  // extension APIs, so an unconverted `browser.storage.local.set` would be
  // swallowed by the global mock in setup.ts and this assertion would fail.
  it('writes the new active-case pointer through host.store.set', async () => {
    (api.createCase as any).mockResolvedValue({
      case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry'
    });
    (api.submitTurn as any).mockResolvedValue(okTurnResponse);

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    expect(stub.set).toHaveBeenCalledWith({ faultmaven_current_case: 'real-case-id' });
    expect(stub.data.faultmaven_current_case).toBe('real-case-id');
  });
});

describe('useDataUpload — the submitted row\'s investigation turn (#251)', () => {
  let stub: ReturnType<typeof createStubHost>;
  const render = () =>
    renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });

  const setConversation = (rows: unknown[]) =>
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      conversations: { 'case-123': rows as any },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      caseEvidence: {}
    });

  /** An earlier aside: the clock is at 8, the investigation only at 7. */
  const labelledRow = {
    id: 'm-8',
    question: 'write me a haiku',
    timestamp: '2026-09-01T10:00:00Z',
    turn_number: 8,
    investigation_turn: 7,
    optimistic: false
  };

  /** The same row as persisted before this field existed. */
  const unlabelledRow = { ...labelledRow, investigation_turn: undefined };

  const turnResponse = {
    agent_response: 'Reading the logs now.',
    turn_number: 9,
    investigation_turn: 8,
    milestones_completed: [],
    case_state: 'investigating',
    progress_made: true,
    attachments_processed: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();
  });

  it('predicts the next investigation turn while the upload is in flight', async () => {
    // A turn carrying an attachment is never an aside — the backend's
    // out-of-band triage never runs on one — so the prediction is the answer.
    // Without it the in-flight bubble falls back to the clock and reads 9.
    setConversation([labelledRow]);
    let inFlight: any[] = [];
    (api.submitTurn as any).mockImplementation(async () => {
      inFlight = (useAppStore.getState().conversations['case-123'] as any[])
        .filter((m) => m.optimistic);
      return turnResponse;
    });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'here are the logs' });
    });

    expect(inFlight.map((m) => m.investigation_turn)).toEqual([8, 8]);
    expect(inFlight.map((m) => m.turn_number)).toEqual([9, 9]);
  });

  it('takes the backend value where this client could not predict one', async () => {
    // A store persisted before the field existed holds no investigation turn,
    // so there is nothing to predict from and the optimistic rows carry null.
    // The response is then the only source of the label — which is what makes
    // this the test that fails if the response value is dropped.
    setConversation([unlabelledRow]);
    (api.submitTurn as any).mockResolvedValue(turnResponse);

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'here are the logs' });
    });

    const committed = (useAppStore.getState().conversations['case-123'] as any[])
      .filter((m) => m.turn_number === 9);
    expect(committed).toHaveLength(2);
    for (const row of committed) {
      expect(row.investigation_turn).toBe(8);
    }
  });
});
