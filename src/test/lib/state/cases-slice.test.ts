import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import * as api from '../../../lib/api';

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

vi.mock('../../../lib/api', () => ({
  createCase: vi.fn(),
  getCaseConversation: vi.fn().mockResolvedValue({ messages: [] }),
  getUserCases: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const resetStore = () =>
  useAppStore.setState({
    activeCaseId: null,
    activeCase: null,
    isCreatingCase: false,
    conversations: {},
    conversationTitles: {},
    titleSources: {},
    optimisticCases: [],
    pinnedCases: new Set<string>(),
    caseEvidence: {},
    sessionId: null
  });

describe('cases-slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('handleCaseSelect — delta offset', () => {
    it('counts only committed messages for the backend offset (regression: optimistic messages must not skew pagination)', async () => {
      useAppStore.setState({
        conversations: {
          'case-1': [
            { id: 'm1', optimistic: false } as any,
            { id: 'm2', optimistic: false } as any,
            { id: 'm3-opt', optimistic: true } as any
          ]
        }
      });

      useAppStore.getState().handleCaseSelect('case-1');
      // allow the fire-and-forget delta fetch to be issued
      await Promise.resolve();

      expect(api.getCaseConversation).toHaveBeenCalledWith('case-1', { offset: 2 });
    });

    it('uses offset 0 when there are no committed messages yet', async () => {
      useAppStore.setState({
        conversations: { 'case-2': [{ id: 'opt', optimistic: true } as any] }
      });

      useAppStore.getState().handleCaseSelect('case-2');
      await Promise.resolve();

      expect(api.getCaseConversation).toHaveBeenCalledWith('case-2', { offset: 0 });
    });

    it('does NOT count failed (non-optimistic) items in the offset', async () => {
      // A failed turn's AI item is optimistic:false but has NO backend row —
      // counting it (the old `!optimistic` filter) would skip a real message.
      useAppStore.setState({
        conversations: {
          'case-3': [
            { id: 'm1', optimistic: false } as any,
            { id: 'm2', optimistic: false, failed: true, error: true } as any
          ]
        }
      });

      useAppStore.getState().handleCaseSelect('case-3');
      await Promise.resolve();

      expect(api.getCaseConversation).toHaveBeenCalledWith('case-3', { offset: 1 });
    });

    it('does not fire a second delta fetch while one is in flight', async () => {
      let resolveFetch: (v: any) => void = () => {};
      (api.getCaseConversation as any).mockReturnValue(new Promise((r) => { resolveFetch = r; }));
      useAppStore.setState({ conversations: { 'case-4': [{ id: 'm1', optimistic: false } as any] } });

      useAppStore.getState().handleCaseSelect('case-4');
      useAppStore.getState().handleCaseSelect('case-4'); // while the first is in flight

      expect(api.getCaseConversation).toHaveBeenCalledTimes(1);
      resolveFetch({ messages: [] });
      await new Promise((r) => setTimeout(r, 0)); // let .finally clear the guard
    });

    it('dedups a message_id already present locally (no duplicate append)', async () => {
      useAppStore.setState({ conversations: { 'case-5': [{ id: 'real-1', optimistic: false } as any] } });
      (api.getCaseConversation as any).mockResolvedValue({
        messages: [
          { message_id: 'real-1', role: 'user', content: 'dup' },   // already present locally
          { message_id: 'real-2', role: 'agent', content: 'new' }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-5');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-5'];
      expect(conv.map((m: any) => m.id)).toEqual(['real-1', 'real-2']);
    });
  });

  describe('togglePinnedCase', () => {
    it('adds then removes a case id, returning a new Set each time', () => {
      const { togglePinnedCase } = useAppStore.getState();

      togglePinnedCase('case-1');
      expect(useAppStore.getState().pinnedCases.has('case-1')).toBe(true);

      togglePinnedCase('case-1');
      expect(useAppStore.getState().pinnedCases.has('case-1')).toBe(false);
    });
  });

  describe('setActiveCase', () => {
    it('supports a functional updater', () => {
      useAppStore.getState().setActiveCase({ case_id: 'case-1', title: 'A' } as any);
      useAppStore.getState().setActiveCase((prev) =>
        prev ? ({ ...prev, title: 'B' } as any) : prev
      );
      expect(useAppStore.getState().activeCase?.title).toBe('B');
    });
  });

  describe('ensureCaseExists', () => {
    it('throws without a session', async () => {
      await expect(useAppStore.getState().ensureCaseExists()).rejects.toThrow(
        'Cannot create case without session'
      );
    });

    it('returns the in-memory active case without hitting the API', async () => {
      useAppStore.setState({ sessionId: 'sess-1', activeCaseId: 'case-existing' });
      const id = await useAppStore.getState().ensureCaseExists();
      expect(id).toBe('case-existing');
      expect(api.createCase).not.toHaveBeenCalled();
    });
  });
});
