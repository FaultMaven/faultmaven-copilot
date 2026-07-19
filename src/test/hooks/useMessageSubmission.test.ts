import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageSubmission } from '../../shared/ui/hooks/useMessageSubmission';
import * as api from '../../lib/api';
import { pendingOpsManager, OptimisticIdGenerator, idMappingManager } from '../../lib/optimistic';
import { useAppStore } from '../../lib/state/store';
import { bumpEpoch } from '../../lib/state/session-epoch';
import { browser } from 'wxt/browser';

const mockShowError = vi.fn();
const mockShowErrorWithRetry = vi.fn();

// Mock dependencies
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        set: vi.fn(),
        remove: vi.fn()
      }
    }
  }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  authManager: {
    isAuthenticated: vi.fn().mockResolvedValue(true)
  },
  generateCaseTitle: vi.fn(),
  getCaseConversation: vi.fn()
}));

vi.mock('../../lib/errors', () => ({
  useError: () => ({
    showError: mockShowError,
    showErrorWithRetry: mockShowErrorWithRetry,
    dismissError: vi.fn(),
    handleError: vi.fn()
  }),
  useErrorHandler: () => ({
    errors: [],
    showError: mockShowError,
    dismissError: vi.fn(),
    dismissAll: vi.fn(),
    getErrorsByType: () => [],
    hasError: () => false,
    setRetryAction: vi.fn()
  })
}));

vi.mock('../../lib/optimistic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/optimistic')>();
  return {
    ...actual,
    pendingOpsManager: {
      add: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      remove: vi.fn(),
      getByStatus: vi.fn().mockReturnValue([])
    },
    OptimisticIdGenerator: {
      generateMessageId: vi.fn().mockReturnValue('mock-message-id'),
      generateCaseId: vi.fn().mockReturnValue('mock-case-id')
    }
  };
});

// Mock logger
vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// Mock retry logic to execute immediately
vi.mock('../../lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn) => fn())
}));

describe('useMessageSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowError.mockClear();
    mockShowErrorWithRetry.mockClear();

    (OptimisticIdGenerator.generateMessageId as any)
      .mockReturnValueOnce('user-msg-id')
      .mockReturnValueOnce('ai-msg-id');

    // Setup Zustand store state
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      hasUnsavedNewChat: false,
      conversations: { 'case-123': [] },
      titleSources: {},
      conversationTitles: {},
      optimisticCases: [],
      pinnedCases: new Set(),
      activeCase: {
        case_id: 'case-123',
        title: 'Test',
        state: 'inquiry',
        created_at: '2026-01-01T00:00:00Z',
        owner_id: 'u1',
        organization_id: 'o1',
        closure_reason: null,
        closed_at: null,
        message_count: 0
      }
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useMessageSubmission());
    expect(result.current.submitting).toBe(false);
  });

  it('should handle successful query submission via submitTurn', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    // Mock successful TurnResponse
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'AI Response',
      turn_number: 1,
      milestones_completed: [],
      case_state: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // 1. Optimistic updates
    expect(result.current.submitting).toBe(false);
    expect(useAppStore.getState().conversations['case-123']).toHaveLength(2);
    expect(pendingOpsManager.add).toHaveBeenCalled();

    // 2. API Call - now uses submitTurn with TurnRequest + an abort signal
    // (so an unmount cancels the turn's async polling).
    expect(api.submitTurn).toHaveBeenCalledWith(
      'case-123',
      expect.objectContaining({ query: 'test query' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    // 3. Success handling
    expect(pendingOpsManager.complete).toHaveBeenCalledWith('ai-msg-id');
  });

  it('should sync activeCase.state from TurnResponse.case_state', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Starting the investigation.',
      turn_number: 2,
      milestones_completed: [],
      case_state: 'investigating',
      progress_made: true,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('Yes, let us investigate');
    });

    expect(useAppStore.getState().activeCase?.state).toBe('investigating');
  });

  it('should create new case if no active case exists', async () => {
    useAppStore.setState({ activeCaseId: null, hasUnsavedNewChat: true, conversations: {} });
    const { result } = renderHook(() => useMessageSubmission());

    // Must be a well-formed optimistic id (opt_ prefix) — IdMappingManager
    // rejects anything else when reconciling to the real case id.
    (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt_case_test');
    (api.createCase as any).mockResolvedValue({
      case_id: 'real-case-id',
      title: 'Case-0625-1',
      state: 'inquiry'
    });
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Response',
      turn_number: 1,
      milestones_completed: [],
      case_state: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // The optimistic case id doubles as the Idempotency-Key so an ambiguous
    // network failure can be safely auto-retried without creating a second case.
    expect(api.createCase).toHaveBeenCalledWith(
      expect.objectContaining({ title: null }),
      { idempotencyKey: 'opt_case_test' }
    );
    expect(useAppStore.getState().activeCaseId).toBe('real-case-id');
  });

  it('should handle API errors gracefully', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    // Mock API failure
    (api.submitTurn as any).mockRejectedValue(new Error('Network Error'));

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // Wait for retries to complete and failure to be handled
    await waitFor(() => {
      // Must fail WITHOUT rollback (third arg false) so the failed turn stays visible.
      expect(pendingOpsManager.fail).toHaveBeenCalledWith('ai-msg-id', expect.stringContaining('Network Error'), false);
    });

    expect(mockShowError).toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  // Regression: issue #101 — a successful retry must clear the error/failed
  // flags set by the prior failed attempt, or the answer renders red and gets
  // dropped from committed-only persistence.
  it('clears error/failed flags when a retried submission succeeds', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    // First attempt fails → the AI item is marked error/failed (kept visible).
    (api.submitTurn as any).mockRejectedValue(new Error('Network Error'));
    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });
    await waitFor(() => {
      expect(pendingOpsManager.fail).toHaveBeenCalledWith('ai-msg-id', expect.any(String), false);
    });
    const failedItem = (useAppStore.getState().conversations['case-123'] || [])
      .find((m: any) => m.id === 'ai-msg-id');
    expect(failedItem?.error).toBe(true);
    expect(failedItem?.failed).toBe(true);

    // Retry (same message ids) now succeeds. Grab the retryFn the failed op
    // registered — it re-runs the submission against the existing failed item.
    const registeredOp = (pendingOpsManager.add as any).mock.calls.at(-1)?.[0];
    expect(registeredOp?.retryFn).toBeTypeOf('function');
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Recovered response',
      turn_number: 1,
      milestones_completed: [],
      case_state: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });
    await act(async () => {
      await registeredOp.retryFn();
    });

    const healed = (useAppStore.getState().conversations['case-123'] || [])
      .find((m: any) => m.id === 'ai-msg-id');
    expect(healed?.response).toBe('Recovered response');
    expect(healed?.error).toBe(false);
    expect(healed?.failed).toBe(false);
    expect(healed?.errorMessage).toBeUndefined();
  });

  // Regression: issue #132 — logout must fence in-flight background writers so a
  // createCase/turn that resolves AFTER the logout purge can't repopulate state.
  describe('session-epoch fence (issue #132)', () => {
    it('does not re-create case pointer / id-mapping / conversations when logout lands mid-createCase', async () => {
      // No active case → handleQuerySubmit goes through createOptimisticCaseInBackground.
      useAppStore.setState({ activeCaseId: null, hasUnsavedNewChat: true, conversations: {} });
      (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt_case_test');

      const addMappingSpy = vi.spyOn(idMappingManager, 'addMapping');

      // Simulate a logout that lands WHILE createCase is in flight: the network
      // resolves, but the session epoch has already moved (handleLogout bumped it).
      (api.createCase as any).mockImplementation(async () => {
        bumpEpoch();
        return { case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry' };
      });

      const { result } = renderHook(() => useMessageSubmission());
      await act(async () => {
        await result.current.handleQuerySubmit('a query typed just before logout');
      });

      // The stale continuation must NOT reconcile the optimistic case into the
      // purged store: no id-mapping, no real-case conversation, and the active
      // case pointer is never re-pointed at the ended session's real case id.
      expect(addMappingSpy).not.toHaveBeenCalled();
      expect(useAppStore.getState().conversations['real-case-id']).toBeUndefined();
      expect(browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ faultmaven_current_case: 'real-case-id' })
      );
      // The turn itself is never fired for the ended session.
      expect(api.submitTurn).not.toHaveBeenCalled();

      addMappingSpy.mockRestore();
    });

    it('does not write turn success back into a store purged mid-flight', async () => {
      // Active case exists; the turn resolves after a logout bumps the epoch.
      (api.submitTurn as any).mockImplementation(async () => {
        bumpEpoch();
        return {
          agent_response: 'AI Response (stale — session already ended)',
          turn_number: 1,
          milestones_completed: [],
          case_state: 'inquiry',
          progress_made: false,
          is_stuck: false,
          attachments_processed: []
        };
      });

      const { result } = renderHook(() => useMessageSubmission());
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      // Success handler is fenced: the pending op is never completed against the
      // ended session and the stale agent_response never lands in the store.
      expect(pendingOpsManager.complete).not.toHaveBeenCalled();
      const conv = useAppStore.getState().conversations['case-123'] || [];
      expect(conv.some((m: any) => m.response?.includes('stale'))).toBe(false);
    });
  });
});
