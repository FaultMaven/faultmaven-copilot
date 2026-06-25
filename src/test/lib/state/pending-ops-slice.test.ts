import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import { pendingOpsManager } from '../../../lib/optimistic';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  }
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

describe('pending-ops-slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeCaseId: null, pendingOperations: {} });
  });

  describe('getFailedOperationsForUser', () => {
    it('returns only failed operations belonging to the active case', () => {
      useAppStore.setState({ activeCaseId: 'case-1' });

      const ops = [
        { id: 'a', type: 'submit_query', status: 'failed', optimisticData: { caseId: 'case-1' } },
        { id: 'b', type: 'submit_query', status: 'failed', optimisticData: { caseId: 'case-2' } },
        { id: 'c', type: 'create_case', status: 'failed', optimisticData: { case_id: 'case-1' } }
      ];
      vi.spyOn(pendingOpsManager, 'getByStatus').mockReturnValue(ops as any);

      const result = useAppStore.getState().getFailedOperationsForUser();
      expect(result.map((o) => o.id)).toEqual(['a', 'c']);
    });
  });

  describe('getErrorMessageForOperation', () => {
    it('maps each operation type to a distinct user-facing title', () => {
      const { getErrorMessageForOperation } = useAppStore.getState();

      expect(getErrorMessageForOperation({ type: 'create_case' } as any).title).toBe(
        'Failed to Create Chat'
      );
      expect(getErrorMessageForOperation({ type: 'submit_query' } as any).title).toBe(
        'Failed to Send Message'
      );
      expect(getErrorMessageForOperation({ type: 'update_title' } as any).title).toBe(
        'Failed to Update Title'
      );
      expect(getErrorMessageForOperation({ type: 'unknown_op' } as any).title).toBe(
        'Operation Failed'
      );
    });

    it('surfaces the operation error as the message when present', () => {
      const msg = useAppStore
        .getState()
        .getErrorMessageForOperation({ type: 'submit_query', error: 'boom' } as any);
      expect(msg.message).toBe('boom');
    });
  });
});
