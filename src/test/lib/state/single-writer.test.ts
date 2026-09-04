/**
 * `faultmaven_current_case` has exactly one writer.
 *
 * It had two. `setActiveCaseId` persisted the pointer, and three call sites in
 * `src/shared/ui` persisted it again immediately after calling that — the same
 * value, by two code paths, only one of which also handled the clear. Nothing
 * failed, because in the extension both wrote to the same store; the cost was
 * that "who set this key" had no answer, and a fix to one path was invisible to
 * the other.
 *
 * Two assertions, and the second is the one that bites: not just that the value
 * is right, but that ONE call produced it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { createStubHost, hostWrapper } from '../../support/host';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { pendingOpsManager, OptimisticIdGenerator } from '@faultmaven/copilot-ui/lib/optimistic';

vi.mock('@faultmaven/copilot-ui/lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn(),
}));
vi.mock('@faultmaven/copilot-ui/lib/errors', () => ({
  useError: () => ({ showError: vi.fn(), dismissError: vi.fn() }),
  useErrorHandler: () => ({
    errors: [], showError: vi.fn(), dismissError: vi.fn(), dismissAll: vi.fn(),
    getErrorsByType: () => [], hasError: () => false,
  }),
}));

const POINTER = 'faultmaven_current_case';

describe('the active-case pointer has a single writer', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
    setHostStore(stub.store);
    pendingOpsManager.clear();
    OptimisticIdGenerator.resetCounters();
    useAppStore.setState({
      sessionId: 's1', activeCaseId: null, conversations: {},
      titleSources: {}, conversationTitles: {}, pinnedCases: new Set(), caseEvidence: {},
    });
  });

  const writesOfPointer = () =>
    stub.set.mock.calls.filter(([items]) => items && POINTER in items);

  it('is written exactly once when a case becomes active', async () => {
    await act(async () => {
      await useAppStore.getState().setActiveCaseId('case-1');
    });

    const writes = writesOfPointer();
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toEqual({ [POINTER]: 'case-1' });
  });

  it('is cleared through the same writer, which is the only one that clears', async () => {
    await act(async () => {
      await useAppStore.getState().setActiveCaseId(null);
    });

    expect(stub.remove).toHaveBeenCalledWith([POINTER]);
    expect(writesOfPointer()).toHaveLength(0);
  });

  // The sharpest form: give the HOOK one store and the SLICE another. Every
  // write of the pointer must land on the slice's. A hook that persisted it
  // itself — which all three of them did — puts a write on its own store, and
  // no amount of "the value is right" would have shown that.
  it('is never written by the shared-UI hooks, only by the slice', async () => {
    const hookStore = createStubHost();      // what the hooks see via useHost()
    const sliceStore = createStubHost();     // what getHostStore() answers
    setHostStore(sliceStore.store);

    (api.createCase as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      case_id: 'real-case-id', title: 'Case-0625-1', state: 'inquiry',
    });
    (api.submitTurn as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_response: 'ok', turn_number: 1, milestones_completed: [],
      case_state: 'inquiry', progress_made: true, attachments_processed: [], suggested_actions: [],
    });

    const { result } = renderHook(() => useDataUpload(), {
      wrapper: hostWrapper(hookStore.host),
    });
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    const hookWrites = hookStore.set.mock.calls.filter(([i]) => i && POINTER in i);
    const sliceWrites = sliceStore.set.mock.calls.filter(([i]) => i && POINTER in i);

    expect(hookWrites, 'a shared-UI hook wrote the active-case pointer').toEqual([]);
    expect(sliceWrites.length).toBeGreaterThan(0);
    // Whatever the slice was asked to persist, it agreed with itself.
    expect(new Set(sliceWrites.map(([i]) => i[POINTER]))).toEqual(new Set(['real-case-id']));
    expect(sliceStore.data[POINTER]).toBe('real-case-id');
  });
});
