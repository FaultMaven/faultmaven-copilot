/**
 * The sidebar refresh after a committed turn reads past the list cache (#333).
 *
 * The refresh exists to show what the turn changed on the server, above all a
 * title the server gave a placeholder case while answering (fm#1069). The
 * sidebar's first page sits in a single-slot cache with a 5-minute TTL, and a
 * reload that only bumps the counter is served that slot, so the new title
 * never arrived through it. The slot is dropped FIRST, then the list reloaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { bumpEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { idMappingManager, pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { TurnReplayUnavailableError } from '@faultmaven/copilot-ui/lib/errors/types';
import { createStubHost, hostWrapper } from '../support/host';

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

const A = 'case-a';

const caseRow = (id: string, state: string) => ({
  case_id: id, title: 'Case-261011-1', state, created_at: '2026-01-01T00:00:00Z', owner_id: 'u1',
  enterprise_id: 'e1', closure_reason: null, closed_at: null, message_count: 0,
});

/** A turn that left the case's state where it was. */
const sameStateTurn = {
  agent_response: 'Looking at the connection pool.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'investigating',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

let stub: ReturnType<typeof createStubHost>;

const paths = [
  {
    name: 'message path',
    send: async () => {
      const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
      let p!: Promise<unknown>;
      await act(async () => { p = result.current.handleQuerySubmit('pool is exhausted'); await Promise.resolve(); });
      return () => p;
    },
  },
  {
    name: 'upload path',
    send: async () => {
      const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
      let p!: Promise<unknown>;
      await act(async () => { p = result.current.handleTurnSubmit({ query: 'here is the log' }); await Promise.resolve(); });
      return () => p;
    },
  },
];

describe.each(paths)('post-turn sidebar refresh — $name', ({ send }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    idMappingManager.clear();
    OptimisticIdGenerator.resetCounters();
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: A,
      activeCase: caseRow(A, 'investigating'),
      hasUnsavedNewChat: false,
      conversations: { [A]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
    } as never);
  });

  it('drops the cached list before asking for it again, once', async () => {
    let refreshAtInvalidate: number | undefined;
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      refreshAtInvalidate = useAppStore.getState().refreshSessions;
    });
    (api.submitTurn as any).mockResolvedValue(sameStateTurn);
    const before = useAppStore.getState().refreshSessions;

    const settled = await send();
    await act(async () => { await settled(); });

    await vi.waitFor(() => expect(useAppStore.getState().refreshSessions).toBe(before + 1));
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Dropped while the counter had not moved: the reload reads the server.
    expect(refreshAtInvalidate).toBe(before);
    expect(useAppStore.getState().activeCase?.state).toBe('investigating');
    invalidate.mockRestore();
  });

  it('a turn that changed the open case\'s state leaves the reload to the transition effect', async () => {
    // SidePanelApp's transition effect runs reconcileActiveCaseState, which
    // drops the slot and reloads the list itself.
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockResolvedValue();
    (api.submitTurn as any).mockResolvedValue({ ...sameStateTurn, case_state: 'resolved' });
    const before = useAppStore.getState().refreshSessions;

    const settled = await send();
    await act(async () => { await settled(); });

    expect(useAppStore.getState().activeCase?.state).toBe('resolved');
    expect(invalidate).not.toHaveBeenCalled();
    expect(useAppStore.getState().refreshSessions).toBe(before);
    invalidate.mockRestore();
  });

  it('a session that ended while the slot was being dropped is not reloaded into', async () => {
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      bumpEpoch();
    });
    (api.submitTurn as any).mockResolvedValue(sameStateTurn);
    const before = useAppStore.getState().refreshSessions;

    const settled = await send();
    await act(async () => { await settled(); });

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().refreshSessions).toBe(before);
    invalidate.mockRestore();
  });

  // IDEMPOTENCY_REPLAY_UNAVAILABLE: the turn committed but its reply cannot be
  // served, so there is no `case_state` in hand. The case row is read back and
  // the list re-read once all the same.
  describe('a committed turn whose reply cannot be replayed', () => {
    const reloadCommittedTurn = vi.fn(async () => true);

    it('re-reads the list past its cache, once', async () => {
      let refreshAtInvalidate: number | undefined;
      const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
        refreshAtInvalidate = useAppStore.getState().refreshSessions;
      });
      const refreshActiveCase = vi.fn(async () => caseRow(A, 'investigating') as never);
      useAppStore.setState({ reloadCommittedTurn, refreshActiveCase } as never);
      (api.submitTurn as any).mockRejectedValue(new TurnReplayUnavailableError('committed; reload the case'));
      const before = useAppStore.getState().refreshSessions;

      const settled = await send();
      await act(async () => { await settled(); });

      await vi.waitFor(() => expect(useAppStore.getState().refreshSessions).toBe(before + 1));
      expect(reloadCommittedTurn).toHaveBeenCalled();
      expect(refreshActiveCase).toHaveBeenCalledWith(A);
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(refreshAtInvalidate).toBe(before);
      invalidate.mockRestore();
    });

    it('a read-back that moved the open case\'s state leaves the reload to the transition effect', async () => {
      const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockResolvedValue();
      // The read-back merges the server's row into the open case, as
      // `refreshActiveCase` does for the case asked about.
      const refreshActiveCase = vi.fn(async () => {
        useAppStore.setState({ activeCase: caseRow(A, 'resolved') } as never);
        return caseRow(A, 'resolved') as never;
      });
      useAppStore.setState({ reloadCommittedTurn, refreshActiveCase } as never);
      (api.submitTurn as any).mockRejectedValue(new TurnReplayUnavailableError('committed; reload the case'));
      const before = useAppStore.getState().refreshSessions;

      const settled = await send();
      await act(async () => { await settled(); });

      await vi.waitFor(() => expect(refreshActiveCase).toHaveBeenCalledWith(A));
      await act(async () => { await Promise.resolve(); });
      expect(useAppStore.getState().activeCase?.state).toBe('resolved');
      expect(invalidate).not.toHaveBeenCalled();
      expect(useAppStore.getState().refreshSessions).toBe(before);
      invalidate.mockRestore();
    });
  });
});
