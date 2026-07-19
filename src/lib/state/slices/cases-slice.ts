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

      // Offset must count only COMMITTED messages (those that exist on the backend).
      // `!optimistic` is wrong: a failed turn's AI item is non-optimistic but has NO
      // backend row, so it would inflate the offset and skip a real message. Use
      // isCommittedMessage (drops optimistic / loading / failed / error).
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
              // id-dedup (belt-and-suspenders vs offset drift / races): never append
              // a message_id already present locally.
              const existingIds = new Set(existing.map((m) => m.id));
              const fresh = incoming.filter(m => !existingIds.has(m.id));
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
