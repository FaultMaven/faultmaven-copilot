import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageSubmission } from '../../shared/ui/hooks/useMessageSubmission';
import * as api from '../../lib/api';
import { pendingOpsManager, OptimisticIdGenerator, idMappingManager } from '../../lib/optimistic';
import { useAppStore } from '../../lib/state/store';
import { bumpEpoch } from '../../lib/state/session-epoch';
import { createStubHost, hostWrapper } from '../support/host';

const mockShowError = vi.fn();

// Mock dependencies
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
  // The host every render below mounts. Nothing in this file mocks the
  // extension APIs any more, so an unconverted `browser.storage.local.set`
  // would be swallowed by the global mock in setup.ts and the assertions on
  // `stub.set` would find nothing.
  let stub: ReturnType<typeof createStubHost>;
  const render = () =>
    renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });

  beforeEach(() => {
    stub = createStubHost();
    vi.clearAllMocks();
    mockShowError.mockClear();

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
    const { result } = render();
    expect(result.current.submitting).toBe(false);
  });

  it('should handle successful query submission via submitTurn', async () => {
    const { result } = render();

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
    const { result } = render();

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
    const { result } = render();

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
    const { result } = render();

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
    const { result } = render();

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

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('a query typed just before logout');
      });

      // The stale continuation must NOT reconcile the optimistic case into the
      // purged store: no id-mapping, no real-case conversation, and the active
      // case pointer is never re-pointed at the ended session's real case id.
      expect(addMappingSpy).not.toHaveBeenCalled();
      expect(useAppStore.getState().conversations['real-case-id']).toBeUndefined();
      expect(stub.set).not.toHaveBeenCalledWith(
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

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      // Success handler is fenced: the pending op is never completed against the
      // ended session and the stale agent_response never lands in the store.
      expect(pendingOpsManager.complete).not.toHaveBeenCalled();
      const conv = useAppStore.getState().conversations['case-123'] || [];
      expect(conv.some((m: any) => m.response?.includes('stale'))).toBe(false);
    });

    // The #143 hazard — a logout landing DURING the multi-second title-generation
    // LLM call, whose result then lands in the purged store — is closed by
    // construction now: this hook does not generate titles at all. The backend
    // names a placeholder-titled case in the background when the turn is
    // processed (fm#1069), so there is no client-side title round-trip left for a
    // logout to race. The test below pins that absence; if a client-side trigger
    // is ever reintroduced here, it fails and #143 has to be answered again.
    it('never generates a title client-side, at any turn number (#143, fm#1069)', async () => {
      useAppStore.setState({
        activeCaseId: 'case-123',
        conversations: { 'case-123': [] },
        conversationTitles: {},
        titleSources: {} // no source — under the old code this made it "eligible"
      });

      // Turn 5 is the exact turn number the removed client gate fired on.
      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'ok',
        turn_number: 5,
        milestones_completed: [],
        case_state: 'inquiry',
        progress_made: false,
        is_stuck: false,
        attachments_processed: []
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('the fifth turn');
      });

      expect(api.generateCaseTitle).not.toHaveBeenCalled();
      // ...and nothing was written to the title store, so a server-set title is
      // free to render via selectCaseTitle's backend source.
      expect(useAppStore.getState().conversationTitles['case-123']).toBeUndefined();
    });

    it('does not refetch twice when the turn also changed case state', async () => {
      // A state change makes SidePanelApp's transition effect run
      // reconcileActiveCaseState, which invalidates the list cache and bumps this
      // same counter itself. Firing both spends two list GETs to answer one
      // question.
      const before = useAppStore.getState().refreshSessions;

      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'Starting the investigation.',
        turn_number: 2,
        milestones_completed: [],
        case_state: 'investigating', // activeCase starts at 'inquiry'
        progress_made: true,
        is_stuck: false,
        attachments_processed: []
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('Yes, let us investigate');
      });

      expect(useAppStore.getState().activeCase?.state).toBe('investigating');
      expect(useAppStore.getState().refreshSessions).toBe(before);
    });

    it('refetches the case list after a turn so a server-set title reaches the sidebar', async () => {
      const before = useAppStore.getState().refreshSessions;

      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'ok',
        turn_number: 1,
        milestones_completed: [],
        case_state: 'inquiry',
        progress_made: false,
        is_stuck: false,
        attachments_processed: []
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('why is the pod crashing?');
      });

      expect(useAppStore.getState().refreshSessions).toBeGreaterThan(before);
    });
  });

  // Regression: issue #147 — a prior failed case-create can leave activeCaseId as
  // a stale opt_case_* with no id-mapping. A turn must never be POSTed against an
  // optimistic id (backend 404s); the stale pointer is resolved or discarded.
  describe('stale optimistic active-case guard (#147)', () => {
    it('creates a fresh real case instead of POSTing a turn against an unreconciled opt_case_*', async () => {
      // Stale optimistic pointer with NO mapping (prior create failed).
      useAppStore.setState({ activeCaseId: 'opt_case_stale', conversations: {} });
      (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt_case_new');
      (api.createCase as any).mockResolvedValue({
        case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry'
      });
      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'ok', turn_number: 1, milestones_completed: [],
        case_state: 'inquiry', progress_made: false, is_stuck: false, attachments_processed: []
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      // A fresh case was created and the turn went to the REAL id, never the stale opt id.
      expect(api.createCase).toHaveBeenCalled();
      expect(api.submitTurn).toHaveBeenCalledWith(
        'real-case-id', expect.anything(), expect.anything()
      );
      expect(api.submitTurn).not.toHaveBeenCalledWith(
        'opt_case_stale', expect.anything(), expect.anything()
      );
    });

    it('resolves a reconciled opt_case_* via the id-mapping without creating a new case', async () => {
      idMappingManager.addMapping('opt_case_reconciled', 'real-mapped-id');
      useAppStore.setState({ activeCaseId: 'opt_case_reconciled', conversations: { 'real-mapped-id': [] } });
      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'ok', turn_number: 1, milestones_completed: [],
        case_state: 'inquiry', progress_made: false, is_stuck: false, attachments_processed: []
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      expect(api.createCase).not.toHaveBeenCalled();
      expect(api.submitTurn).toHaveBeenCalledWith(
        'real-mapped-id', expect.anything(), expect.anything()
      );
    });

    it('rolls back the optimistic active-case pointer when case creation fails', async () => {
      useAppStore.setState({ activeCaseId: null, hasUnsavedNewChat: true, conversations: {} });
      (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt_case_test');
      (api.createCase as any).mockRejectedValue(new Error('create failed'));

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      // The failed optimistic pointer is cleared so the next submit starts fresh
      // rather than POSTing a turn against the dead opt id, and the UI returns to
      // the unsaved-new-chat composer state.
      expect(useAppStore.getState().activeCaseId).toBeNull();
      expect(useAppStore.getState().hasUnsavedNewChat).toBe(true);
      expect(api.submitTurn).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
      expect(result.current.submitting).toBe(false);
    });
  });

  // One named assertion per converted call site in this hook. Both writes go to
  // the same key from different points in the optimistic-case lifecycle, so
  // asserting the VALUE is what tells them apart.
  describe('reaches storage through the host', () => {
    beforeEach(() => {
      useAppStore.setState({ activeCaseId: null, hasUnsavedNewChat: true, conversations: {} });
      (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt_case_probe');
      (api.submitTurn as any).mockResolvedValue({
        agent_response: 'ok', turn_number: 1, milestones_completed: [],
        case_state: 'inquiry', progress_made: false, is_stuck: false, attachments_processed: []
      });
    });

    it('writes the OPTIMISTIC case pointer through host.store.set before the backend create', async () => {
      // Creation never resolves a real id here, so the only write that can have
      // happened is the optimistic one.
      (api.createCase as any).mockRejectedValue(new Error('create failed'));

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      expect(stub.set).toHaveBeenCalledWith({ faultmaven_current_case: 'opt_case_probe' });
    });

    it('writes the REAL case pointer through host.store.set once creation reconciles', async () => {
      (api.createCase as any).mockResolvedValue({
        case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry'
      });

      const { result } = render();
      await act(async () => {
        await result.current.handleQuerySubmit('test query');
      });

      expect(stub.set).toHaveBeenCalledWith({ faultmaven_current_case: 'opt_case_probe' });
      expect(stub.set).toHaveBeenCalledWith({ faultmaven_current_case: 'real-case-id' });
      // The reconciled id is what survives.
      expect(stub.data.faultmaven_current_case).toBe('real-case-id');
    });
  });
});
