import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';

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

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
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

    it('names the attachments of a failed turn, and keeps the message-only copy otherwise', () => {
      const { getErrorMessageForOperation } = useAppStore.getState();
      const op = (optimisticData: unknown) => ({ type: 'submit_query', optimisticData } as any);
      const unsent = (extra = {}) => ({
        unsent: { hasQuery: true, attachments: [{ name: 'a.log', isFile: true }], ...extra },
      });

      expect(getErrorMessageForOperation(op(unsent())).recoveryHint).toBe(
        'Your message and 1 file (a.log) were not added to the case. Retry sends them again.'
      );
      expect(getErrorMessageForOperation(op(unsent({ ambiguous: true }))).recoveryHint).toBe(
        'Your message and 1 file (a.log) may not have been added to the case. Retry sends them again.'
      );
      expect(getErrorMessageForOperation(op(unsent({ hasQuery: false }))).recoveryHint).toBe(
        '1 file (a.log) was not added to the case. Retry sends it again.'
      );
      expect(getErrorMessageForOperation(op({ unsent: { hasQuery: true, attachments: [] } })).recoveryHint).toBe(
        'Your message was not sent. Try sending it again or check your connection.'
      );
      expect(getErrorMessageForOperation(op(undefined)).recoveryHint).toBe(
        'Your message was not sent. Try sending it again or check your connection.'
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
