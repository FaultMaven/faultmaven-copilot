/**
 * Who wrote a turn's query reaches the turn request (faultmaven#2717).
 *
 * The server searches only a TYPED query for system output to offer back as
 * data, so a chosen suggestion or status change says `chosen`, and the
 * auto-query this client writes for an attachment sent with an empty box says
 * `generated`. The server fingerprints the source with the Idempotency-Key, so
 * every retry of a turn carries the source its first send did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { createStubHost, hostWrapper } from '../support/host';

const recovery = vi.hoisted(() => ({ onRetry: null as null | (() => void | Promise<void>) }));

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn(),
}));

vi.mock('@faultmaven/copilot-ui/lib/errors', () => ({
  useError: () => ({ showError: vi.fn(), dismissError: vi.fn() }),
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// The recovery plan's Retry is the second retry closure the query hook builds;
// keep the one it was handed so the test can run it.
vi.mock('@faultmaven/copilot-ui/lib/errors/recovery-strategies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@faultmaven/copilot-ui/lib/errors/recovery-strategies')>();
  return {
    ...actual,
    getRecoveryPlan: (error: unknown, callbacks: Parameters<typeof actual.getRecoveryPlan>[1]) => {
      recovery.onRetry = callbacks.onRetry;
      return actual.getRecoveryPlan(error, callbacks);
    },
  };
});

const okTurnResponse = {
  agent_response: 'OK',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'investigating',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

const sentSources = () =>
  (api.submitTurn as ReturnType<typeof vi.fn>).mock.calls.map(([, request]) => request.querySource);

const chip = { type: 'confirmation', confirmation_value: true, proposal_id: 'p-1' };

describe('query source on the turn request (faultmaven#2717)', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    recovery.onRetry = null;
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      conversations: { 'case-123': [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
    });
  });

  describe('a query-only turn', () => {
    const render = () => renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });

    it('says typed for text typed into the box (no source given)', async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>).mockResolvedValue(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleQuerySubmit('why is the pool exhausted?');
      });

      expect(sentSources()).toEqual(['typed']);
    });

    it('says chosen for a chosen suggestion, with its intent', async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>).mockResolvedValue(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleQuerySubmit('Yes, mark it resolved.', chip, 'chosen');
      });

      expect(api.submitTurn).toHaveBeenCalledWith(
        'case-123',
        expect.objectContaining({ querySource: 'chosen', intentType: 'confirmation' }),
        expect.anything()
      );
    });

    it('keeps chosen when the failed turn is retried from the banner', async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(Object.assign(new Error('Request timeout'), { status: 504 }))
        .mockResolvedValueOnce(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleQuerySubmit('Yes, mark it resolved.', chip, 'chosen');
      });
      await waitFor(() => expect(useAppStore.getState().getFailedOperationsForUser()).toHaveLength(1));
      const opId = useAppStore.getState().getFailedOperationsForUser()[0].id;

      await act(async () => {
        await useAppStore.getState().handleUserRetry(opId, vi.fn());
      });

      expect(sentSources()).toEqual(['chosen', 'chosen']);
    });

    it("keeps chosen when the recovery plan's Retry resends the turn", async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(Object.assign(new Error('Request timeout'), { status: 504 }))
        .mockResolvedValueOnce(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleQuerySubmit('Yes, mark it resolved.', chip, 'chosen');
      });
      await waitFor(() => expect(recovery.onRetry).toBeTypeOf('function'));

      await act(async () => {
        await recovery.onRetry!();
      });

      expect(sentSources()).toEqual(['chosen', 'chosen']);
    });
  });

  describe('a turn with attachments', () => {
    const render = () => renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });

    it('says generated for the auto-query of a paste sent with an empty box, and keeps it on retry', async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(Object.assign(new Error('Request timeout'), { status: 504 }))
        .mockResolvedValueOnce(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleTurnSubmit({
          query: 'Please analyze this pasted data.',
          queryIsGenerated: true,
          pastedContent: 'ERROR connection refused',
          inputType: 'paste',
        });
      });
      const opId = useAppStore.getState().getFailedOperationsForUser()[0].id;
      await act(async () => {
        await useAppStore.getState().handleUserRetry(opId, vi.fn());
      });

      expect(sentSources()).toEqual(['generated', 'generated']);
    });

    it('names no source for text the user typed beside the paste (absent means typed)', async () => {
      (api.submitTurn as ReturnType<typeof vi.fn>).mockResolvedValue(okTurnResponse);
      const { result } = render();

      await act(async () => {
        await result.current.handleTurnSubmit({
          query: 'this started after the deploy, why?',
          pastedContent: 'ERROR connection refused',
          inputType: 'paste',
        });
      });

      expect(api.submitTurn).toHaveBeenCalledTimes(1);
      expect(sentSources()).toEqual([undefined]);
    });
  });
});
