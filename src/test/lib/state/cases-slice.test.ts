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
  getCaseConversation: vi.fn().mockResolvedValue({ messages: [] }),
  getUserCases: vi.fn().mockResolvedValue([]),
  getCase: vi.fn().mockRejectedValue(new Error('no backend row in this test')),
  DEFAULT_CASE_LIST_LIMIT: 100
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const resetStore = () =>
  useAppStore.setState({
    activeCaseId: null,
    activeCase: null,
    conversations: {},
    conversationTitles: {},
    titleSources: {},
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
          { message_id: 'real-2', role: 'assistant', content: 'new' }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-5');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-5'];
      expect(conv.map((m: any) => m.id)).toEqual(['real-1', 'real-2']);
    });

    it('drops system turns instead of creating empty ghost items', async () => {
      // The backend role CHECK admits 'system' (e.g. the runbook-conversion
      // notification). This conversation model is strictly question/response, so
      // a system row would map to an item with BOTH fields undefined — invisible
      // in ChatWindow, yet still holding an id and a turn slot.
      (api.getCaseConversation as any).mockResolvedValue({
        messages: [
          { message_id: 'm-1', role: 'user', content: 'why is it broken', turn_number: 1 },
          { message_id: 'm-2', role: 'system', content: 'Runbook created', turn_number: 1 },
          { message_id: 'm-3', role: 'assistant', content: 'looking into it', turn_number: 1 }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-sys');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-sys'];
      expect(conv.map((m: any) => m.id)).toEqual(['m-1', 'm-3']);
      // Nothing retained may be contentless — that is the defect being guarded.
      expect(conv.every((m: any) => m.question || m.response)).toBe(true);
    });

    it('drops an out-of-vocabulary role instead of committing a contentless item', async () => {
      // The role filter is an ALLOW-list (user/assistant), not a 'system'
      // deny-list. A role outside the contract vocabulary must degrade the
      // same way 'system' does — dropped, offset under-counted — because a
      // retained unmapped row would be an invisible committed item whose
      // message_id permanently blocks a corrected re-fetch via id dedup.
      (api.getCaseConversation as any).mockResolvedValue({
        messages: [
          { message_id: 'm-1', role: 'user', content: 'why is it broken', turn_number: 1 },
          { message_id: 'm-x', role: 'tool', content: 'hypothetical future role', turn_number: 1 },
          { message_id: 'm-2', role: 'assistant', content: 'looking into it', turn_number: 1 }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-vocab');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-vocab'];
      expect(conv.map((m: any) => m.id)).toEqual(['m-1', 'm-2']);
      expect(conv.every((m: any) => m.question || m.response)).toBe(true);
    });

    it('does not re-grow a bounded (suffix) conversation: incoming below the local turn floor is dropped', async () => {
      // Local copy has been trimmed to a most-recent suffix (floor turn = 200).
      // The delta fetch over-reads and returns the trimmed head (turn 50); it must
      // be dropped, not re-appended, while a genuinely new turn (201) is kept.
      useAppStore.setState({
        conversations: { 'case-6': [{ id: 'm200', optimistic: false, turn_number: 200 } as any] }
      });
      (api.getCaseConversation as any).mockResolvedValue({
        messages: [
          { message_id: 'old50', role: 'user', content: 'trimmed head', turn_number: 50 },
          { message_id: 'm200', role: 'user', content: 'overlap', turn_number: 200 },
          { message_id: 'new201', role: 'assistant', content: 'genuinely new', turn_number: 201 }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-6');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-6'];
      expect(conv.map((m: any) => m.id)).toEqual(['m200', 'new201']);
    });

    it('appends the missing half of the floor/ceiling turn (same turn_number, new id)', async () => {
      // Only the user message of turn 250 is present locally; the agent reply for
      // that same turn arrives on the delta. `turn >= floor` (not `> ceiling`) keeps it.
      useAppStore.setState({
        conversations: { 'case-7': [{ id: 'u250', optimistic: false, turn_number: 250 } as any] }
      });
      (api.getCaseConversation as any).mockResolvedValue({
        messages: [
          { message_id: 'u250', role: 'user', content: 'q', turn_number: 250 },
          { message_id: 'a250', role: 'assistant', content: 'a', turn_number: 250 }
        ]
      });

      useAppStore.getState().handleCaseSelect('case-7');
      await new Promise((r) => setTimeout(r, 0));

      const conv = useAppStore.getState().conversations['case-7'];
      expect(conv.map((m: any) => m.id)).toEqual(['u250', 'a250']);
    });
  });

  describe('refreshActiveCase', () => {
    const closedRow = {
      case_id: 'case-h1',
      title: 'Hydrated',
      state: 'closed',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      owner_id: 'u1',
      organization_id: 'o1',
      closure_reason: 'inquiry_only',
      closed_at: '2026-07-02T00:00:00Z'
    };

    it('hydrates activeCase state and closure fields from the backend case row on select', async () => {
      // The /messages rows never carry case-level state, so reopening a
      // terminal case must get state/closure_reason/closed_at from the case
      // row — ResolutionActionsCard reads them off activeCase.
      (api.getCase as any).mockResolvedValue(closedRow);

      useAppStore.getState().handleCaseSelect('case-h1');
      // Placeholder first: synchronous select renders immediately.
      expect(useAppStore.getState().activeCase?.state).toBe('inquiry');
      await new Promise((r) => setTimeout(r, 0));

      const ac = useAppStore.getState().activeCase!;
      expect(ac.state).toBe('closed');
      expect(ac.closure_reason).toBe('inquiry_only');
      expect(ac.closed_at).toBe('2026-07-02T00:00:00Z');
      expect(api.getCase).toHaveBeenCalledWith('case-h1');
    });

    it('does not regress a terminal activeCase to an active state from an out-of-order response', async () => {
      (api.getCase as any).mockResolvedValue(
        { ...closedRow, case_id: 'case-h2', state: 'investigating', closure_reason: null, closed_at: null }
      );
      useAppStore.setState({
        activeCase: {
          ...closedRow,
          case_id: 'case-h2',
          state: 'resolved',
          closure_reason: null
        } as any
      });

      await useAppStore.getState().refreshActiveCase('case-h2');

      expect(useAppStore.getState().activeCase?.state).toBe('resolved');
    });

    it('does not touch activeCase when the user switched cases mid-fetch', async () => {
      let resolveFetch: (v: any) => void;
      (api.getCase as any).mockReturnValue(new Promise((r) => { resolveFetch = r; }));
      useAppStore.setState({
        activeCase: { ...closedRow, case_id: 'case-other', state: 'inquiry', closure_reason: null, closed_at: null } as any
      });

      const p = useAppStore.getState().refreshActiveCase('case-h3');
      resolveFetch!({ ...closedRow, case_id: 'case-h3' });
      await p;

      expect(useAppStore.getState().activeCase?.case_id).toBe('case-other');
      expect(useAppStore.getState().activeCase?.state).toBe('inquiry');
    });

    it('leaves activeCase unchanged and does not throw when the fetch fails', async () => {
      (api.getCase as any).mockRejectedValue(new Error('network down'));
      useAppStore.setState({
        activeCase: { ...closedRow, case_id: 'case-h4', state: 'inquiry' } as any
      });

      await expect(
        useAppStore.getState().refreshActiveCase('case-h4')
      ).resolves.toBeUndefined();

      expect(useAppStore.getState().activeCase?.state).toBe('inquiry');
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

});
