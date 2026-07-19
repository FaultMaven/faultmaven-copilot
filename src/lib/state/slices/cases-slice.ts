import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import {
  AttachmentResult,
  DEFAULT_CASE_LIST_LIMIT,
  getCaseConversation,
  getUserCases
} from '../../../lib/api';
import type { UserCase } from '../../../types/case';
import {
  idMappingManager,
  OptimisticConversationItem
} from '../../../lib/optimistic';
import { isOptimisticId } from '../../../lib/utils/data-integrity';
import { caseCacheManager } from '../../../lib/cache/case-cache';
import { getEpoch } from '../session-epoch';
import { createLogger } from '../../../lib/utils/logger';
import { isCommittedMessage } from '../../../lib/utils/memory-manager';
import type { StoreState } from '../store';

const log = createLogger('CasesSlice');

// The raw per-message shape the backend `/messages` endpoint returns, as consumed
// by the delta fetch below. `getCaseConversation` is currently untyped (returns
// `any`); this narrows the fields we actually read so the mapping is type-checked.
interface BackendConversationMessage {
  message_id: string;
  created_at: string;
  turn_number: number;
  role: string;
  content: string;
  case_state?: UserCase['state'];
  closure_reason?: string | null;
  closed_at?: string | null;
}

export interface CasesSlice {
  activeCaseId: string | null;
  activeCase: UserCase | null;
  conversations: Record<string, OptimisticConversationItem[]>;
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  pinnedCases: Set<string>;
  caseEvidence: Record<string, AttachmentResult[]>;

  // Actions
  setActiveCaseId: (caseId: string | null | undefined) => Promise<void>;
  setActiveCase: (caseObj: UserCase | null | ((prev: UserCase | null) => UserCase | null)) => void;
  setConversations: (updater: Record<string, OptimisticConversationItem[]> | ((prev: Record<string, OptimisticConversationItem[]>) => Record<string, OptimisticConversationItem[]>)) => void;
  setConversationTitles: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setTitleSources: (updater: Record<string, 'user' | 'backend' | 'system'> | ((prev: Record<string, 'user' | 'backend' | 'system'>) => Record<string, 'user' | 'backend' | 'system'>)) => void;
  setPinnedCases: (pinned: Set<string>) => void;
  togglePinnedCase: (caseId: string) => void;
  setCaseEvidence: (updater: Record<string, AttachmentResult[]> | ((prev: Record<string, AttachmentResult[]>) => Record<string, AttachmentResult[]>)) => void;
  handleCaseSelect: (caseId: string) => void;
  reconcileActiveCaseState: () => Promise<void>;
}

export const createCasesSlice: StateCreator<StoreState, [], [], CasesSlice> = (set, get) => {
  // Cases with a delta fetch currently in flight — guards against a double-click /
  // rapid A→B→A firing two fetches for the same case with the same offset (which
  // would append the same rows twice and PERSIST the duplicates).
  const inFlightDeltaFetches = new Set<string>();

  return {
    activeCaseId: null,
    activeCase: null,
    conversations: {},
    conversationTitles: {},
    titleSources: {},
    pinnedCases: new Set(),
    caseEvidence: {},

    setActiveCaseId: async (caseId) => {
      const targetId = caseId || null;
      log.debug('Setting active case ID:', targetId);
      set({ activeCaseId: targetId });

      if (targetId) {
        await browser.storage.local.set({ faultmaven_current_case: targetId });
      } else {
        await browser.storage.local.remove(['faultmaven_current_case']);
      }
    },

    setActiveCase: (caseObj) => {
      if (typeof caseObj === 'function') {
        set((state) => ({ activeCase: caseObj(state.activeCase) }));
      } else {
        set({ activeCase: caseObj });
      }
    },

    setConversations: (updater) => {
      if (typeof updater === 'function') {
        set((state) => ({ conversations: updater(state.conversations) }));
      } else {
        set({ conversations: updater });
      }
    },

    setConversationTitles: (updater) => {
      if (typeof updater === 'function') {
        set((state) => ({ conversationTitles: updater(state.conversationTitles) }));
      } else {
        set({ conversationTitles: updater });
      }
    },

    setTitleSources: (updater) => {
      if (typeof updater === 'function') {
        set((state) => ({ titleSources: updater(state.titleSources) }));
      } else {
        set({ titleSources: updater });
      }
    },

    setPinnedCases: (pinned) => set({ pinnedCases: pinned }),

    togglePinnedCase: (caseId) => {
      set((state) => {
        const next = new Set(state.pinnedCases);
        if (next.has(caseId)) {
          next.delete(caseId);
        } else {
          next.add(caseId);
        }
        return { pinnedCases: next };
      });
    },

    setCaseEvidence: (updater) => {
      if (typeof updater === 'function') {
        set((state) => ({ caseEvidence: updater(state.caseEvidence) }));
      } else {
        set({ caseEvidence: updater });
      }
    },

    handleCaseSelect: (caseId) => {
      get().setActiveCaseId(caseId);
      set({ hasUnsavedNewChat: false, activeTab: 'copilot' });

      const caseMessages = get().conversations[caseId] || [];
      const lastStatusMessage = [...caseMessages].reverse().find(m => m.case_state);
      set({
        activeCase: {
          case_id: caseId,
          title: get().conversationTitles[caseId] || 'Loading...',
          state: (lastStatusMessage?.case_state || 'inquiry') as UserCase['state'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          owner_id: '',
          organization_id: '',
          closure_reason: null,
          closed_at: null,
          message_count: caseMessages.length || 0
        }
      });

      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;

      if (isOptimisticId(resolvedCaseId)) {
        log.debug('Optimistic case not yet reconciled, using local data', { caseId });
        return;
      }

      if (inFlightDeltaFetches.has(caseId)) {
        log.debug('Delta fetch already in flight for case; skipping', { caseId });
        return;
      }

      // Offset is a LOWER-BOUND fetch hint, not a correctness boundary. It counts
      // only COMMITTED messages (those that exist on the backend): `!optimistic` is
      // wrong because a failed turn's AI item is non-optimistic but has NO backend
      // row, so it would inflate the offset and skip a real message — use
      // isCommittedMessage (drops optimistic / loading / failed / error).
      //
      // When the local copy is the backend PREFIX (the common case), this offset is
      // exact and we fetch only the tail. When the local copy is a most-recent
      // SUFFIX (after `sanitizeAndCapForPersistence` bounds a very long conversation),
      // the count is smaller than the true tail position, so the fetch OVER-reads:
      // the result is still a superset of the new messages and the merge below
      // (turn-floor + id dedup) drops the re-read head instead of re-growing it, so
      // it's correct — but a capped conversation re-downloads its whole tail on each
      // open. Accepted here because that only bites pathologically long single
      // conversations; a backend `after_turn` filter would make the fetch delta-sized.
      const offset = (get().conversations[caseId] ?? []).filter(isCommittedMessage).length;

      // Fence the delta-fetch continuation: a logout while the fetch is in flight
      // must not merge the ended session's messages back into a purged store.
      const epoch = getEpoch();

      inFlightDeltaFetches.add(caseId);
      getCaseConversation(resolvedCaseId, { offset })
        .then(data => {
          if (epoch !== getEpoch()) {
            log.info('Session changed during delta fetch — discarding conversation delta', { caseId });
            return;
          }
          const messages = (data.messages ?? []) as BackendConversationMessage[];
          const incoming: OptimisticConversationItem[] = messages.map((msg) => ({
            id: msg.message_id,
            timestamp: msg.created_at,
            turn_number: msg.turn_number,
            optimistic: false,
            originalId: msg.message_id,
            question: msg.role === 'user' ? msg.content : undefined,
            response: (msg.role === 'agent' || msg.role === 'assistant') ? msg.content : undefined,
            case_state: msg.case_state,
            closure_reason: msg.closure_reason ?? null,
            closed_at: msg.closed_at ?? null
          }));
          if (incoming.length > 0) {
            set((state) => {
              const existing = state.conversations[caseId] || [];
              const existingIds = new Set(existing.map((m) => m.id));

              // Turn floor: the lowest turn_number we still hold locally. When a very
              // long conversation has been bounded to a most-recent suffix (see
              // `sanitizeAndCapForPersistence`), the delta fetch over-reads and hands
              // us messages BELOW this floor — the trimmed head. Dropping them here is
              // what keeps a bounded conversation from re-growing on every case open.
              // With no committed local messages yet (0), the floor lets everything
              // through (a cold hydrate). The cap keeps whole turns, so the floor turn
              // is fully present locally and its messages fall out via id dedup — no
              // half-turn is ever re-read out of order.
              const committedTurns = existing
                .filter(isCommittedMessage)
                .map((m) => m.turn_number)
                .filter((t): t is number => typeof t === 'number');
              const minLocalTurn = committedTurns.length ? Math.min(...committedTurns) : 0;

              // Append only messages that are (a) not already present (id dedup, vs
              // offset drift / races) and (b) not below the retained-turn floor.
              const fresh = incoming.filter(
                (m) =>
                  !existingIds.has(m.id) &&
                  (typeof m.turn_number !== 'number' || m.turn_number >= minLocalTurn)
              );
              if (fresh.length === 0) return state;

              let splitAt = existing.length;
              for (let i = existing.length - 1; i >= 0; i--) {
                if (existing[i].optimistic) {
                  splitAt = i;
                } else {
                  break;
                }
              }
              const committed = existing.slice(0, splitAt);
              const trailingOptimistic = existing.slice(splitAt);
              return {
                conversations: {
                  ...state.conversations,
                  [caseId]: [...committed, ...fresh, ...trailingOptimistic]
                }
              };
            });
            log.info('Conversation delta applied', { caseId, added: incoming.length, offset });
          }
        })
        .catch(err => log.error('Failed to fetch conversation delta', { caseId, offset, err }))
        .finally(() => inFlightDeltaFetches.delete(caseId));
    },

    reconcileActiveCaseState: async () => {
      const activeCase = get().activeCase;
      if (!activeCase) return;

      const transitionedCaseId = activeCase.case_id;
      const isTerminal = activeCase.state === 'resolved' || activeCase.state === 'closed';
      const epoch = getEpoch();

      try {
        await caseCacheManager.invalidateCache();
        if (isTerminal) {
          const cases = await getUserCases({ limit: DEFAULT_CASE_LIST_LIMIT, offset: 0 });
          // A logout during the refetch must not re-hydrate an activeCase for the
          // ended session. The set() below is also guarded on case_id identity,
          // but the epoch check stops it before a purge is undone.
          if (epoch !== getEpoch()) {
            log.info('Session changed during reconcile — discarding active-case refresh', { transitionedCaseId });
            return;
          }
          const fresh = cases.find(c => c.case_id === transitionedCaseId);
          if (fresh) {
            set((state) => {
              if (state.activeCase && state.activeCase.case_id === fresh.case_id) {
                return { activeCase: { ...state.activeCase, ...fresh } };
              }
              return {};
            });
          }
        }
        get().triggerRefreshSessions();
      } catch (error) {
        log.debug('Post-transition case refresh failed', error);
      }
    }
  };
};
