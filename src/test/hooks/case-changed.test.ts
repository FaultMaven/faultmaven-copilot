/**
 * `onCaseChanged` on the two hooks that commit a turn (dashboard#204): the host
 * is told once, with the real case id, after the turn commits, and a host
 * callback that throws cannot break the turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { notifyCaseChanged } from '@faultmaven/copilot-ui/shared/ui/hooks/case-changed';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { createStubHost, hostWrapper } from '../support/host';

const okTurn = {
  agent_response: 'Done.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'inquiry',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn(),
}));
vi.mock('@faultmaven/copilot-ui/lib/errors', () => ({
  useError: () => ({ showError: vi.fn(), dismissError: vi.fn() }),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

describe('onCaseChanged on a committed turn', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();
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
        enterprise_id: 'e1',
        closure_reason: null,
        closed_at: null,
        message_count: 0,
      },
    });
  });

  it('message path: fires once with the case id after the turn commits', async () => {
    (api.submitTurn as any).mockResolvedValue(okTurn);
    const onCaseChanged = vi.fn();
    const { result } = renderHook(() => useMessageSubmission(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('hello');
    });
    expect(onCaseChanged).toHaveBeenCalledTimes(1);
    expect(onCaseChanged).toHaveBeenCalledWith('case-123');
  });

  it('upload path: fires once with the case id after the turn commits', async () => {
    (api.submitTurn as any).mockResolvedValue(okTurn);
    const onCaseChanged = vi.fn();
    const { result } = renderHook(() => useDataUpload(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });
    expect(onCaseChanged).toHaveBeenCalledTimes(1);
    expect(onCaseChanged).toHaveBeenCalledWith('case-123');
  });

  it('does not fire when the turn fails', async () => {
    (api.submitTurn as any).mockRejectedValue(new Error('boom'));
    const onCaseChanged = vi.fn();
    const { result } = renderHook(() => useMessageSubmission(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('hello');
    });
    expect(onCaseChanged).not.toHaveBeenCalled();
  });

  it('a throwing callback does not break the turn (both paths)', async () => {
    (api.submitTurn as any).mockResolvedValue(okTurn);
    const onCaseChanged = vi.fn(() => {
      throw new Error('host bug');
    });
    const msg = renderHook(() => useMessageSubmission(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await msg.result.current.handleQuerySubmit('hello');
    });
    const afterMsg = useAppStore.getState().conversations['case-123'];
    expect(afterMsg).toHaveLength(2);
    expect(afterMsg.some((r) => r.error || r.failed)).toBe(false);
    expect(afterMsg.find((r) => !r.question)?.response).toBe('Done.');

    const up = renderHook(() => useDataUpload(onCaseChanged), { wrapper: hostWrapper(stub.host) });
    let uploaded: { success: boolean } | undefined;
    await act(async () => {
      uploaded = await up.result.current.handleTurnSubmit({ query: 'diagnose this' });
    });
    expect(uploaded?.success).toBe(true);
    expect(onCaseChanged).toHaveBeenCalledTimes(2);
  });

  it('works with no callback (the extension passes none)', async () => {
    (api.submitTurn as any).mockResolvedValue(okTurn);
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('hello');
    });
    expect(useAppStore.getState().conversations['case-123']).toHaveLength(2);
  });
});

describe('notifyCaseChanged', () => {
  it('never announces an optimistic or empty id', () => {
    const cb = vi.fn();
    notifyCaseChanged(cb, 'opt_case_1');
    notifyCaseChanged(cb, '');
    notifyCaseChanged(cb, null);
    expect(cb).not.toHaveBeenCalled();
    notifyCaseChanged(cb, 'case-9');
    expect(cb).toHaveBeenCalledWith('case-9');
  });
});
