import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import {
  createCase,
  CreateCaseRequest,
  getCaseConversation,
  getUserCases
} from '../../../lib/api';
import type { UserCase } from '../../../types/case';
import {
  idMappingManager,
  OptimisticConversationItem,
  OptimisticUserCase
} from '../../../lib/optimistic';
import { isOptimisticId } from '../../../lib/utils/data-integrity';
import { caseCacheManager } from '../../../lib/cache/case-cache';
import { createLogger } from '../../../lib/utils/logger';
import { isCommittedMessage } from '../../../lib/utils/memory-manager';

const log = createLogger('CasesSlice');

export interface CasesSlice {
  activeCaseId: string | null;
  activeCase: UserCase | null;
  isCreatingCase: boolean;
  conversations: Record<string, OptimisticConversationItem[]>;
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  optimisticCases: OptimisticUserCase[];
  pinnedCases: Set<string>;
  caseEvidence: Record<string, any[]>;

  // Actions
  setActiveCaseId: (caseId: string | null | undefined) => Promise<void>;
  setActiveCase: (caseObj: UserCase | null | ((prev: UserCase | null) => UserCase | null)) => void;
  setConversations: (updater: Record<string, OptimisticConversationItem[]> | ((prev: Record<string, OptimisticConversationItem[]>) => Record<string, OptimisticConversationItem[]>)) => void;
  setConversationTitles: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setTitleSources: (updater: Record<string, 'user' | 'backend' | 'system'> | ((prev: Record<string, 'user' | 'backend' | 'system'>) => Record<string, 'user' | 'backend' | 'system'>)) => void;
  setOptimisticCases: (updater: OptimisticUserCase[] | ((prev: OptimisticUserCase[]) => OptimisticUserCase[])) => void;
  setPinnedCases: (pinned: Set<string>) => void;
  togglePinnedCase: (caseId: string) => void;
  setCaseEvidence: (updater: Record<string, any[]> | ((prev: Record<string, any[]>) => Record<string, any[]>)) => void;
  ensureCaseExists: (sessionId?: string | null) => Promise<string>;
  createNewCase: (sessionId?: string | null) => Promise<string>;
  clearCurrentCase: () => Promise<void>;
  handleCaseSelect: (caseId: string) => void;
  reconcileActiveCaseState: () => Promise<void>;
}

export const createCasesSlice: StateCreator<any, [], [], CasesSlice> = (set, get) => {
  let caseCreationPromise: Promise<string> | null = null;
  // Cases with a delta fetch currently in flight — guards against a double-click /
  // rapid A→B→A firing two fetches for the same case with the same offset (which
  // would append the same rows twice and PERSIST the duplicates).
  const inFlightDeltaFetches = new Set<string>();

  const createNewCaseViaAPI = async (sessionId: string | null): Promise<string> => {
    log.debug('Creating new case via /api/v1/cases (v2.0)');
    const request: CreateCaseRequest = {
      title: null,
      priority: 'medium',
      metadata: {
        created_via: 'browser_extension',
        auto_generated: true
      }
    };
    const caseData = await createCase(request);
    if (!caseData.case_id) {
      throw new Error('Backend response missing case_id');
    }
    log.info('Case created via v2.0 API', { caseId: caseData.case_id });
    return caseData.case_id;
  };

  return {
    activeCaseId: null,
    activeCase: null,
    isCreatingCase: false,
    conversations: {},
    conversationTitles: {},
    titleSources: {},
    optimisticCases: [],
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
        set((state: any) => ({ activeCase: caseObj(state.activeCase) }));
      } else {
        set({ activeCase: caseObj });
      }
    },

    setConversations: (updater) => {
      if (typeof updater === 'function') {
        set((state: any) => ({ conversations: updater(state.conversations) }));
      } else {
        set({ conversations: updater });
      }
    },

    setConversationTitles: (updater) => {
      if (typeof updater === 'function') {
        set((state: any) => ({ conversationTitles: updater(state.conversationTitles) }));
      } else {
        set({ conversationTitles: updater });
      }
    },

    setTitleSources: (updater) => {
      if (typeof updater === 'function') {
        set((state: any) => ({ titleSources: updater(state.titleSources) }));
      } else {
        set({ titleSources: updater });
      }
    },

    setOptimisticCases: (updater) => {
      if (typeof updater === 'function') {
        set((state: any) => ({ optimisticCases: updater(state.optimisticCases) }));
      } else {
        set({ optimisticCases: updater });
      }
    },

    setPinnedCases: (pinned) => set({ pinnedCases: pinned }),

    togglePinnedCase: (caseId) => {
      set((state: any) => {
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
        set((state: any) => ({ caseEvidence: updater(state.caseEvidence) }));
      } else {
        set({ caseEvidence: updater });
      }
    },

    ensureCaseExists: async (overrideSessionId?: string | null): Promise<string> => {
      const sessionId = overrideSessionId || get().sessionId;
      if (!sessionId) {
        throw new Error('Cannot create case without session');
      }

      const activeCaseId = get().activeCaseId;
      if (activeCaseId) {
        log.debug('Case exists in memory:', activeCaseId);
        return activeCaseId;
      }

      try {
        const stored = await browser.storage.local.get(['faultmaven_current_case']);
        if (stored.faultmaven_current_case) {
          log.debug('Case restored from storage:', stored.faultmaven_current_case);
          set({ activeCaseId: stored.faultmaven_current_case });
          return stored.faultmaven_current_case;
        }
      } catch (error) {
        log.warn('Failed to read from storage:', error);
      }

      if (caseCreationPromise) {
        log.debug('Case creation already in progress, waiting...');
        return await caseCreationPromise;
      }

      log.info('No case exists, creating new case for session:', sessionId);
      set({ isCreatingCase: true });

      caseCreationPromise = createNewCaseViaAPI(sessionId);

      try {
        const caseId = await caseCreationPromise;
        await browser.storage.local.set({ faultmaven_current_case: caseId });
        set({ activeCaseId: caseId, isCreatingCase: false });
        log.info('Case created successfully:', caseId);
        return caseId;
      } catch (error) {
        set({ isCreatingCase: false });
        log.error('Case creation failed:', error);
        throw error;
      } finally {
        caseCreationPromise = null;
      }
    },

    createNewCase: async (overrideSessionId?: string | null): Promise<string> => {
      const sessionId = overrideSessionId || get().sessionId;
      if (!sessionId) {
        throw new Error('Cannot create case without session');
      }

      log.info('Force creating new case for session:', sessionId);
      set({ isCreatingCase: true });

      try {
        const caseId = await createNewCaseViaAPI(sessionId);
        await browser.storage.local.set({ faultmaven_current_case: caseId });
        set({ activeCaseId: caseId, isCreatingCase: false });
        log.info('New case created successfully:', caseId);
        return caseId;
      } catch (error) {
        set({ isCreatingCase: false });
        log.error('New case creation failed:', error);
        throw error;
      }
    },

    clearCurrentCase: async () => {
      log.debug('Clearing current case (no backend call)');
      set({ activeCaseId: null });
      await browser.storage.local.remove(['faultmaven_current_case']);
    },

    handleCaseSelect: (caseId) => {
      get().setActiveCaseId(caseId);
      set({ hasUnsavedNewChat: false, activeTab: 'copilot' });

      const optimisticCase = get().optimisticCases.find((c: any) => c.case_id === caseId);
      if (optimisticCase) {
        set({
          activeCase: {
            case_id: optimisticCase.case_id,
            title: optimisticCase.title || get().conversationTitles[caseId] || 'New Case',
            state: (optimisticCase.state || 'inquiry') as UserCase['state'],
            created_at: optimisticCase.created_at || new Date().toISOString(),
            updated_at: optimisticCase.updated_at || new Date().toISOString(),
            owner_id: optimisticCase.owner_id || '',
            organization_id: '',
            closure_reason: null,
            closed_at: null,
            message_count: get().conversations[caseId]?.length || 0
          }
        });
      } else {
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
      }

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

      inFlightDeltaFetches.add(caseId);
      getCaseConversation(resolvedCaseId, { offset })
        .then(data => {
          const incoming: OptimisticConversationItem[] = (data.messages || []).map((msg: any) => ({
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
            set((state: any) => {
              const existing = state.conversations[caseId] || [];
              // id-dedup (belt-and-suspenders vs offset drift / races): never append
              // a message_id already present locally.
              const existingIds = new Set(existing.map((m: OptimisticConversationItem) => m.id));
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

      try {
        await caseCacheManager.invalidateCache();
        if (isTerminal) {
          const cases = await getUserCases({ limit: 100, offset: 0 });
          const fresh = cases.find(c => c.case_id === transitionedCaseId);
          if (fresh) {
            set((state: any) => {
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
