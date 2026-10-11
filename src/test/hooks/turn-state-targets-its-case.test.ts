/**
 * A turn's `case_state` belongs to the case the turn was sent for (#321).
 *
 * In the extension the user can open another case from the sidebar while a
 * turn is in flight. The response then lands while case B is open, and its
 * state is case A's: it must not be written onto B (B showed `resolved`
 * because A resolved), and the panel must stay on B. A's row in the sidebar's
 * cached list is stale instead, so the slot is dropped and the list reloaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { idMappingManager, pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
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
const B = 'case-b';

const caseRow = (id: string, state: string) => ({
  case_id: id, title: id, state, created_at: '2026-01-01T00:00:00Z', owner_id: 'u1',
  enterprise_id: 'e1', closure_reason: null, closed_at: null, message_count: 0,
});

const resolvedTurn = {
  agent_response: 'Root cause confirmed; marking the case resolved.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'resolved',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

/** Hold the turn's response until the test lands it. */
const deferredTurn = () => {
  let resolve: ((v: unknown) => void) | null = null;
  (api.submitTurn as any).mockImplementation(() => new Promise((r) => { resolve = r; }));
  return async (v: unknown) => {
    await vi.waitFor(() => expect(resolve).not.toBeNull());
    resolve!(v);
  };
};

const openCase = (id: string, state: string) =>
  act(() => useAppStore.setState({ activeCaseId: id, activeCase: caseRow(id, state) } as never));

type Path = {
  name: string;
  send: (onCaseChanged?: (id: string) => void) => Promise<() => Promise<unknown>>;
};

let stub: ReturnType<typeof createStubHost>;

const paths: Path[] = [
  {
    name: 'message path',
    send: async (onCaseChanged) => {
      const { result } = renderHook(() => useMessageSubmission(onCaseChanged), { wrapper: hostWrapper(stub.host) });
      let p!: Promise<unknown>;
      await act(async () => { p = result.current.handleQuerySubmit('is it fixed?'); await Promise.resolve(); });
      return () => p;
    },
  },
  {
    name: 'upload path',
    send: async (onCaseChanged) => {
      const { result } = renderHook(() => useDataUpload(onCaseChanged), { wrapper: hostWrapper(stub.host) });
      let p!: Promise<unknown>;
      await act(async () => { p = result.current.handleTurnSubmit({ query: 'here is the log' }); await Promise.resolve(); });
      return () => p;
    },
  },
];

describe.each(paths)('a turn\'s case state targets its own case — $name', ({ send }) => {
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
      conversations: { [A]: [], [B]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
    } as never);
  });

  it('a turn on A landing after the user opened B leaves B\'s state alone', async () => {
    const land = deferredTurn();
    const settled = await send();
    expect(api.submitTurn).toHaveBeenCalledWith(A, expect.anything(), expect.anything());

    openCase(B, 'inquiry');
    await act(async () => { await land(resolvedTurn); await settled(); });

    const { activeCase } = useAppStore.getState();
    expect(activeCase?.case_id).toBe(B);
    expect(activeCase?.state).toBe('inquiry');
    // The turn's own rows still land on A.
    expect(useAppStore.getState().conversations[A].find((r) => !r.question)?.response)
      .toBe(resolvedTurn.agent_response);
  });

  it('the panel stays on B: the response does not move the active-case pointer back to A', async () => {
    const land = deferredTurn();
    const settled = await send();
    // Only what the RESPONSE writes: the send itself may persist A.
    stub.set.mockClear();
    openCase(B, 'inquiry');
    await act(async () => { await land(resolvedTurn); await settled(); });

    // A pointer on A under B's row would show A's conversation in B's header.
    expect(useAppStore.getState().activeCaseId).toBe(B);
    expect(stub.set).not.toHaveBeenCalledWith({ faultmaven_current_case: A });
  });

  it('drops the sidebar\'s cached list and reloads it, since A\'s row changed out of sight', async () => {
    // The reload counter as the slot is dropped: it must not have moved yet,
    // or the reload is served the cached page that still shows A as it was.
    let refreshAtInvalidate: number | undefined;
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      refreshAtInvalidate = useAppStore.getState().refreshSessions;
    });
    const land = deferredTurn();
    const settled = await send();
    openCase(B, 'inquiry');
    const before = useAppStore.getState().refreshSessions;

    await act(async () => { await land(resolvedTurn); await settled(); });

    await vi.waitFor(() => expect(useAppStore.getState().refreshSessions).toBe(before + 1));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refreshAtInvalidate).toBe(before);
    invalidate.mockRestore();
  });

  it('still tells the host about A, the case the turn changed', async () => {
    const cb = vi.fn();
    const land = deferredTurn();
    const settled = await send(cb);
    openCase(B, 'inquiry');
    await act(async () => { await land(resolvedTurn); await settled(); });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(A);
  });

  it('a turn landing on the case still open applies its state', async () => {
    (api.submitTurn as any).mockResolvedValue(resolvedTurn);
    const settled = await send();
    await act(async () => { await settled(); });
    expect(useAppStore.getState().activeCase?.case_id).toBe(A);
    expect(useAppStore.getState().activeCase?.state).toBe('resolved');
  });

  it('an open row still carrying the reconciled optimistic id is the turn\'s case', async () => {
    // The pointer and row were minted before the case-create reconciled; the
    // turn went to the real id the mapping resolves them to.
    idMappingManager.addMapping('opt_case_1', A);
    useAppStore.setState({ activeCaseId: 'opt_case_1', activeCase: caseRow('opt_case_1', 'investigating') } as never);
    (api.submitTurn as any).mockResolvedValue(resolvedTurn);

    const settled = await send();
    await act(async () => { await settled(); });

    expect(api.submitTurn).toHaveBeenCalledWith(A, expect.anything(), expect.anything());
    expect(useAppStore.getState().activeCase?.state).toBe('resolved');
  });
});
