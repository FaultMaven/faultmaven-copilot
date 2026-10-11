/**
 * A lazy case-create that finishes after the user opened another case does not
 * pull the panel back to the new case (#334).
 *
 * The first message (or upload) on a new chat creates the case before its turn
 * is sent. If the user opens case B from the sidebar meanwhile, the create's
 * completion still reconciles the new case everywhere it lives (id mapping,
 * conversation) and its turn still goes out, but the active pointer and row
 * stay on B; the new case reaches the sidebar instead. A create that fails
 * after the switch leaves B open too.
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

const NEW = 'case-new';
const B = 'case-b';

const caseRow = (id: string, state = 'inquiry') => ({
  case_id: id, title: 'Case-261011-1', state, created_at: '2026-01-01T00:00:00Z', owner_id: 'u1',
  enterprise_id: 'e1', closure_reason: null, closed_at: null, message_count: 0,
});

const okTurn = {
  agent_response: 'Tell me what changed before it broke.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'inquiry',
  progress_made: true,
  attachments_processed: [],
  suggested_actions: [],
};

/** Hold the case create until the test settles it. */
const deferredCreate = () => {
  let settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
  (api.createCase as any).mockImplementation(
    () => new Promise((resolve, reject) => { settle = { resolve, reject }; }),
  );
  const ready = () => vi.waitFor(() => expect(settle).not.toBeNull());
  return {
    resolve: async (v: unknown) => { await ready(); settle!.resolve(v); },
    reject: async (e: unknown) => { await ready(); settle!.reject(e); },
  };
};

const openB = () =>
  act(() => useAppStore.setState({ activeCaseId: B, activeCase: caseRow(B), hasUnsavedNewChat: false } as never));

let stub: ReturnType<typeof createStubHost>;

const paths = [
  {
    name: 'message path',
    send: async () => {
      const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
      let p!: Promise<unknown>;
      await act(async () => { p = result.current.handleQuerySubmit('the API is returning 502s'); await Promise.resolve(); });
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

describe.each(paths)('lazy case-create completion — $name', ({ name, send }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    idMappingManager.clear();
    OptimisticIdGenerator.resetCounters();
    // A new chat: no case yet, the composer open.
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: true,
      conversations: { [B]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
    } as never);
    (api.submitTurn as any).mockResolvedValue(okTurn);
  });

  it('a create finishing after the user opened B leaves B open', async () => {
    const create = deferredCreate();
    const settled = await send();
    openB();
    // Only what the COMPLETION writes.
    stub.set.mockClear();

    await act(async () => { await create.resolve(caseRow(NEW)); await settled(); });

    const state = useAppStore.getState();
    expect(state.activeCaseId).toBe(B);
    expect(state.activeCase?.case_id).toBe(B);
    expect(state.hasUnsavedNewChat).toBe(false);
    expect(stub.set).not.toHaveBeenCalledWith({ faultmaven_current_case: NEW });
  });

  it('the new case is still reconciled, its turn sent, and it reaches the sidebar', async () => {
    let refreshAtInvalidate: number | undefined;
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      refreshAtInvalidate ??= useAppStore.getState().refreshSessions;
    });
    const create = deferredCreate();
    const settled = await send();
    // The message path points the panel at an optimistic id while it creates.
    const optimisticId = useAppStore.getState().activeCaseId;
    openB();
    const before = useAppStore.getState().refreshSessions;

    await act(async () => { await create.resolve(caseRow(NEW)); await settled(); });

    expect(api.submitTurn).toHaveBeenCalledWith(NEW, expect.anything(), expect.anything());
    const rows = useAppStore.getState().conversations[NEW];
    expect(rows.find((r) => !r.question)?.response).toBe(okTurn.agent_response);
    expect(Object.keys(useAppStore.getState().conversations).some((id) => id.startsWith('opt_'))).toBe(false);
    if (name === 'message path') {
      expect(optimisticId).toMatch(/^opt_case_/);
      expect(idMappingManager.getRealId(optimisticId!)).toBe(NEW);
    }
    // The slot is dropped before the list is asked for, so the reload is the
    // server's page and carries the new case.
    await vi.waitFor(() => expect(useAppStore.getState().refreshSessions).toBeGreaterThan(before));
    expect(invalidate).toHaveBeenCalled();
    expect(refreshAtInvalidate).toBe(before);
    invalidate.mockRestore();
  });

  it('a create finishing while the user is still on the new chat opens the new case', async () => {
    const create = deferredCreate();
    const settled = await send();

    await act(async () => { await create.resolve(caseRow(NEW)); await settled(); });

    const state = useAppStore.getState();
    expect(state.activeCaseId).toBe(NEW);
    expect(state.activeCase?.case_id).toBe(NEW);
    expect(state.hasUnsavedNewChat).toBe(false);
  });

  it('a create failing after the user opened B leaves B open', async () => {
    const create = deferredCreate();
    const settled = await send();
    openB();

    await act(async () => { await create.reject(new Error('create failed')); await settled(); });

    const state = useAppStore.getState();
    expect(state.activeCaseId).toBe(B);
    expect(state.activeCase?.case_id).toBe(B);
    expect(state.hasUnsavedNewChat).toBe(false);
    expect(api.submitTurn).not.toHaveBeenCalled();
  });
});
