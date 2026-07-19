import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataUpload } from '../../shared/ui/hooks/useDataUpload';
import * as api from '../../lib/api';
import { useAppStore } from '../../lib/state/store';
import { pendingOpsManager, OptimisticIdGenerator } from '../../lib/optimistic';

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

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { set: vi.fn(), remove: vi.fn() } } }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn()
}));

vi.mock('../../lib/errors', () => ({
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

vi.mock('../../lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn())
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  })
}));

describe('useDataUpload — error surfacing regression guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { result } = renderHook(() => useDataUpload());

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

    const { result } = renderHook(() => useDataUpload());
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

    const { result } = renderHook(() => useDataUpload());
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
    const { result } = renderHook(() => useDataUpload());
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

    const { result } = renderHook(() => useDataUpload());
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
