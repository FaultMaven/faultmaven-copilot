import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost, hostWrapper } from '../support/host';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { DuplicateUploadNotice } from '@faultmaven/copilot-ui/lib/errors/types';

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
      pinnedCases: new Set()
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

  // #305: the suggestions go through the one builder both turn paths share.
  it("narrows the turn's suggestions, keeping each intent whole", async () => {
    const reclassify = { type: 'file_reclassification', file_id: 'file_42', data_type: 'logs_and_errors' };
    (api.submitTurn as any).mockResolvedValue({
      ...okTurnResponse,
      suggested_actions: [
        { label: 'Logs', type: 'DECIDE', payload: 'Treat it as logs', intent: reclassify },
        { label: 'Compare dashboards', type: 'COMPARE', body: 'Grafana vs logs' },
      ],
    });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'here are the logs' });
    });

    const ai = useAppStore.getState().conversations['case-123']
      .find((m) => m.response === 'Analyzed.');
    expect(ai?.suggestedActions?.map((a) => a.type)).toEqual(['DECIDE', 'UNRECOGNIZED']);
    expect(ai?.suggestedActions?.[0].intent).toEqual(reclassify);
  });

  it('carries TurnResponse.sources onto the assistant item', async () => {
    const kbSource = {
      type: 'knowledge_base' as const,
      content: 'Check the OOMKilled reason in the pod events.',
      confidence: 0.77,
      metadata: { document_id: 'doc-2', title: 'OOMKilled triage', trigger: 'symptom' },
      new_this_turn: true,
    };
    (api.submitTurn as any).mockResolvedValue({ ...okTurnResponse, sources: [kbSource] });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'here are the logs' });
    });

    const ai = useAppStore.getState().conversations['case-123']
      .find((m) => m.response === 'Analyzed.');
    expect(ai?.sources).toEqual([kbSource]);
  });

  // Parity with useMessageSubmission: a state change makes SidePanelApp's
  // transition effect refresh the case list itself, so the post-turn refresh
  // stands down rather than asking for the same list twice.
  describe('the post-turn case-list refresh', () => {
    const inquiryCase = {
      case_id: 'case-123',
      title: 'Test',
      state: 'inquiry' as const,
      created_at: '2026-01-01T00:00:00Z',
      owner_id: 'u1',
      enterprise_id: 'e1',
      closure_reason: null,
      closed_at: null,
      message_count: 0,
    };

    it('does not refetch twice when the turn also changed case state', async () => {
      useAppStore.setState({ activeCase: inquiryCase });
      const before = useAppStore.getState().refreshSessions;
      (api.submitTurn as any).mockResolvedValue({ ...okTurnResponse, case_state: 'investigating' });

      const { result } = render();
      await act(async () => {
        await result.current.handleTurnSubmit({ query: 'here are the logs' });
      });

      expect(useAppStore.getState().activeCase?.state).toBe('investigating');
      expect(useAppStore.getState().refreshSessions).toBe(before);
    });

    it('refetches when the state did not change, so a server-set title reaches the sidebar', async () => {
      useAppStore.setState({ activeCase: inquiryCase });
      const before = useAppStore.getState().refreshSessions;
      (api.submitTurn as any).mockResolvedValue({ ...okTurnResponse, case_state: 'inquiry' });

      const { result } = render();
      await act(async () => {
        await result.current.handleTurnSubmit({ query: 'here are the logs' });
      });

      expect(useAppStore.getState().refreshSessions).toBeGreaterThan(before);
    });
  });

  // An attachment as the server reports a content match: the stored file's id
  // twice, and the clock turn the original arrived on.
  const duplicateOf = (duplicate_turn: number) => ({
    file_id: 'file_1',
    filename: 'app.log',
    file_size: 10,
    processing_status: 'duplicate',
    source_type: 'log',
    upload_source: 'file_upload',
    uploaded_at: '2026-10-07T10:05:00Z',
    duplicate_of: 'file_1',
    duplicate_turn,
  });

  // #306: the contract asks for a non-blocking notice when an upload duplicates
  // a file the case already holds; nothing new was stored for it.
  it('says when an upload duplicated a file the case already has', async () => {
    // A committed exchange on clock 3 that the conversation labels turn 2.
    useAppStore.setState({
      conversations: {
        'case-123': [
          { id: 'msg_1', question: 'logs', timestamp: '2026-10-07T10:00:00Z', optimistic: false, turn_number: 3, investigation_turn: 2 },
        ],
      },
    });
    (api.submitTurn as any).mockResolvedValue({
      ...okTurnResponse,
      turn_number: 4,
      attachments_processed: [duplicateOf(3)],
    });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: '', pastedContent: 'ERROR x', inputType: 'paste' });
    });

    expect(mockShowError).toHaveBeenCalledTimes(1);
    const [notice] = mockShowError.mock.calls[0];
    expect(notice).toBeInstanceOf(DuplicateUploadNotice);
    expect(notice.userMessage).toBe('app.log matches a file the case already has, from turn 2.');
  });

  // A file is committed only with the turn that carried it, so a failed turn
  // leaves nothing and a resend is a fresh upload. A match on the resend is a
  // real one: the notice is the signal that the file already landed (the
  // faultmaven#1882 window, where a turn commits but the client saw an error).
  const failThenResend = async (resendAttachments: unknown[]) => {
    useAppStore.setState({
      conversations: {
        'case-123': [
          { id: 'msg_1', question: 'logs', timestamp: '2026-10-07T10:00:00Z', optimistic: false, turn_number: 3, investigation_turn: 2 },
        ],
      },
    });
    (api.submitTurn as any)
      .mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }))
      .mockResolvedValueOnce({ ...okTurnResponse, turn_number: 4, attachments_processed: resendAttachments });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: '', pastedContent: 'ERROR x', inputType: 'paste' });
    });
    const opId = useAppStore.getState().getFailedOperationsForUser()[0].id;
    await act(async () => {
      await useAppStore.getState().handleUserRetry(opId, vi.fn());
    });
    expect((api.submitTurn as any).mock.calls).toHaveLength(2);
    expect(useAppStore.getState().getFailedOperationsForUser()).toHaveLength(0);
    return mockShowError.mock.calls.filter(([shown]) => shown instanceof DuplicateUploadNotice);
  };

  it('shows the notice when a resent upload matches a file the case already has', async () => {
    const notices = await failThenResend([duplicateOf(3)]);
    expect(notices).toHaveLength(1);
    expect(notices[0][0].userMessage).toBe('app.log matches a file the case already has, from turn 2.');
  });

  it('shows no notice when a resent upload is new to the case', async () => {
    const notices = await failThenResend([{
      file_id: 'file_2',
      filename: 'app.log',
      file_size: 10,
      processing_status: 'completed',
      source_type: 'log',
      upload_source: 'file_upload',
      uploaded_at: '2026-10-07T10:05:00Z',
    }]);
    expect(notices).toEqual([]);
  });

  it('shows no notice for an upload that is new', async () => {
    (api.submitTurn as any).mockResolvedValue({
      ...okTurnResponse,
      attachments_processed: [{
        file_id: 'file_2',
        filename: 'fresh.log',
        file_size: 10,
        processing_status: 'completed',
        source_type: 'log',
        upload_source: 'file_upload',
        uploaded_at: '2026-10-07T10:05:00Z',
      }],
    });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: '', pastedContent: 'ERROR x', inputType: 'paste' });
    });

    expect(mockShowError).not.toHaveBeenCalled();
  });

  // `attachments_processed` is optional in the contract. The hand-written
  // TurnResponse made it required, and the hook spread it unguarded.
  it('commits a turn whose response omits attachments_processed, keeping the local rows', async () => {
    const withoutAttachments: Record<string, unknown> = { ...okTurnResponse };
    delete withoutAttachments.attachments_processed;
    (api.submitTurn as any).mockResolvedValue(withoutAttachments);

    const { result } = render();
    let outcome: { success: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({ query: '', pastedContent: 'ERROR x', inputType: 'paste' });
    });

    expect(outcome?.success).toBe(true);
    const user = useAppStore.getState().conversations['case-123'].find((m) => m.question !== undefined);
    expect(user?.attachments).toHaveLength(1);
  });

  // The origin goes in `upload_source`, which `attachmentOrigin()` reads.
  // `source_type` is the server's data classification, unknown until processed.
  it.each([
    ['paste', 'paste'],
    ['page_capture', 'page_capture'],
  ] as const)('marks an optimistic %s attachment with upload_source %s', async (inputType, origin) => {
    (api.submitTurn as any).mockResolvedValue({ ...okTurnResponse, attachments_processed: [] });

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: '', pastedContent: 'ERROR x', inputType });
    });

    const user = useAppStore.getState().conversations['case-123'].find((m) => m.question !== undefined);
    expect(user?.attachments?.[0]).toMatchObject({ upload_source: origin, source_type: '' });
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

  describe('a failed turn names the files it did not add', () => {
    const file = (name: string) => new File(['x'], name, { type: 'text/plain' });
    const failWith = async (
      payload: Parameters<ReturnType<typeof useDataUpload>['handleTurnSubmit']>[0],
      failure: Error = Object.assign(new Error('Internal error'), { status: 500 }),
    ) => {
      (api.submitTurn as any).mockRejectedValue(failure);
      const { result } = render();
      await act(async () => {
        await result.current.handleTurnSubmit(payload);
      });
      const state = useAppStore.getState();
      const [op] = state.getFailedOperationsForUser();
      const bubble = (state.conversations['case-123'][1] as any).response as string;
      return { op, info: state.getErrorMessageForOperation(op), bubble };
    };

    it('names both files, says they were not added, and keeps Retry', async () => {
      const { op, info, bubble } = await failWith({ query: 'why?', files: [file('app.log'), file('db.log')] });
      expect(info.title).toBe('Failed to Send Message');
      expect(info.recoveryHint).toBe(
        'Your message and 2 files (app.log, db.log) were not added to the case. Retry sends them again.'
      );
      expect(bubble).toContain('Your message and 2 files (app.log, db.log) were not added to the case.');
      expect(typeof op.retryFn).toBe('function');
    });

    it('uses the singular for one file', async () => {
      const { info, bubble } = await failWith({ query: 'why?', files: [file('app.log')] });
      expect(info.recoveryHint).toBe(
        'Your message and 1 file (app.log) were not added to the case. Retry sends them again.'
      );
      expect(bubble).toContain('app.log');
    });

    it('truncates a long list', async () => {
      const { info } = await failWith({ files: ['a', 'b', 'c', 'd', 'e'].map(n => file(`${n}.log`)) });
      expect(info.recoveryHint).toBe(
        '5 files (a.log, b.log, c.log and 2 more) were not added to the case. Retry sends them again.'
      );
    });

    it('says a file-only turn without the message wording (generated query is not the user\'s)', async () => {
      const { info } = await failWith({ query: 'Analyze this file.', queryIsGenerated: true, files: [file('app.log')] });
      expect(info.recoveryHint).toBe('1 file (app.log) was not added to the case. Retry sends it again.');
    });

    it.each([500, 409, 503])('is definite for an HTTP %i (the API answered)', async (status) => {
      const { info } = await failWith({ query: 'why?', files: [file('a.log')] }, Object.assign(new Error('boom'), { status }));
      expect(info.recoveryHint).toBe('Your message and 1 file (a.log) were not added to the case. Retry sends them again.');
    });

    it.each([
      ['a fetch TypeError', () => new TypeError('Failed to fetch')],
      ['an async-poll timeout', () => new Error('Async turn polling timed out after 90s')],
      ['a gateway 504', () => Object.assign(new Error('Gateway Timeout'), { status: 504 })],
      ['a gateway 502', () => Object.assign(new Error('Bad Gateway'), { status: 502 })],
    ])('says "may not have been added" for %s (the API may still commit)', async (_name, make) => {
      const { info, bubble } = await failWith({ query: 'why?', files: [file('a.log')] }, make());
      expect(info.recoveryHint).toBe(
        'Your message and 1 file (a.log) may not have been added to the case. Retry sends them again.'
      );
      expect(bubble).toContain('may not have been added to the case');
    });

    it('keeps the notice in the bubble and the banner when the retry fails again', async () => {
      const { op } = await failWith({ query: 'why?', files: [file('a.log'), file('b.log')] });
      await act(async () => {
        await useAppStore.getState().handleUserRetry(op.id, vi.fn());
      });
      const state = useAppStore.getState();
      const [again] = state.getFailedOperationsForUser();
      expect(state.getErrorMessageForOperation(again).recoveryHint).toContain('2 files (a.log, b.log) were not added');
      expect((state.conversations['case-123'][1] as any).response).toContain('2 files (a.log, b.log) were not added');
    });

    it('names pasted text by what it is, not its minted filename', async () => {
      const { info } = await failWith({ pastedContent: 'ERROR x', inputType: 'paste' });
      expect(info.recoveryHint).toBe('The pasted text was not added to the case. Retry sends it again.');
    });

    it('keeps the message-only copy for a turn with no attachments', async () => {
      const { info, bubble } = await failWith({ query: 'diagnose this' });
      expect(info.recoveryHint).toBe('Your message was not sent. Try sending it again or check your connection.');
      expect(bubble).not.toContain('not added to the case');
    });

    it('resends the same files with the same Idempotency-Key', async () => {
      const files = [file('app.log')];
      const { op } = await failWith({ query: 'why?', files });
      (api.submitTurn as any).mockResolvedValueOnce(okTurnResponse);
      await act(async () => {
        await useAppStore.getState().handleUserRetry(op.id, vi.fn());
      });
      const calls = (api.submitTurn as any).mock.calls;
      expect(calls[1][1].files).toBe(files);
      expect(calls[1][2].idempotencyKey).toBe(calls[0][2].idempotencyKey);
    });
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
      pinnedCases: new Set()
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
      pinnedCases: new Set()
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

  it('lets the backend correct a prediction made from a stale local copy', async () => {
    // The prediction reads the highest investigation turn this client HOLDS.
    // When the local copy is behind the backend — a conversation not yet
    // delta-fetched this session — that is short, and the response is the
    // authoritative value. This is the test that fails if the response value
    // is dropped, because here the two genuinely differ.
    setConversation([{ ...labelledRow, turn_number: 3, investigation_turn: 3 }]);
    (api.submitTurn as any).mockResolvedValue(turnResponse);

    const { result } = render();
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'here are the logs' });
    });

    const committed = (useAppStore.getState().conversations['case-123'] as any[])
      .filter((m) => m.turn_number === 9);
    expect(committed).toHaveLength(2);
    for (const row of committed) {
      // 8 from the response, not 4 from the prediction.
      expect(row.investigation_turn).toBe(8);
    }
  });

  it('does not take the response value when the server sends no per-row field', async () => {
    // A store whose rows all read null is indistinguishable from a server
    // older than contract 3.5.0 — and that is the honest reading, because
    // `TurnResponse.investigation_turn` answers from 2.7.0 either way.
    // Adopting it here would label this row from one counter while every row
    // around it falls back to the other.
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
      expect(row.investigation_turn).toBeNull();
    }
  });
});
