import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import {
  AttachmentResult,
  DEFAULT_CASE_LIST_LIMIT,
  getCaseConversation,
  getUserCases
} from '../../../lib/api';
import type { Message, UserCase } from '../../../types/case';
import {
  idMappingManager,
  OptimisticConversationItem
} from '../../../lib/optimistic';
import { isOptimisticId } from '../../../lib/utils/data-integrity';
import { caseCacheManager } from '../../../lib/cache/case-cache';
import { getEpoch } from '../session-epoch';
import { createLogger } from '../../../lib/utils/logger';
import { isCommittedMessage } from '../../../lib/utils/memory-manager';
import { selectCaseTitle } from '../case-title';
import type { StoreState } from '../store';

const log = createLogger('CasesSlice');

// The `/messages` row shape is the generated contract `Message` type directly.
// `getCaseConversation` is currently untyped (returns `any`); the cast in the
// delta fetch below makes the mapping type-checked against the contract.
// Case-level fields (state, closure_reason, closed_at) are deliberately NOT
// read off message rows — the backend Message model never carries them; the
// case-list row is the authoritative source (see refreshActiveCaseFromList).

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
  refreshActiveCaseFromList: (caseId: string, opts?: { bypassCache?: boolean }) => Promise<void>;
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
      set({
        activeCase: {
          case_id: caseId,
          title: selectCaseTitle({ store: get().conversationTitles[caseId] }, 'Loading...'),
          // Placeholder until the list-row hydration below lands. Case-level
          // state is NOT derivable from conversation items — the backend
          // /messages rows never carry it.
          state: 'inquiry',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          owner_id: '',
          organization_id: '',
          closure_reason: null,
          closed_at: null,
          message_count: caseMessages.length || 0
        }
      });

      // Hydrate the placeholder from the authoritative case-list row
      // (cache-first — warm whenever the sidebar just rendered the list).
      // This is what restores state/closure_reason/closed_at on reopening a
      // terminal case: ResolutionActionsCard and the case header read them
      // off activeCase, and the ChatWindow /ui sync copies only `state`.
      void get().refreshActiveCaseFromList(caseId);

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
      // conversations. A server-side delta fetch would need an INCLUSIVE `from_turn`
      // filter (NOT exclusive `after_turn`: a user msg and its agent reply share a
      // turn_number, so excluding the highest local turn drops a late agent reply)
      // AND would still keep this id-dedup merge to absorb the inclusive overlap.
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
          // Keep only the roles this strictly question/response model can
          // display. 'system' rows (e.g. the runbook-conversion notification)
          // are deliberately dropped, and this allow-list extends the same
          // treatment to any role outside the contract vocabulary: an unmapped
          // row would otherwise become an item with BOTH `question` and
          // `response` undefined — invisible in ChatWindow, yet committed, so
          // its message_id would permanently block a corrected re-fetch via
          // the id-dedup below. Dropping is safe against the offset — it only
          // ever UNDER-counts, the tolerated direction (see the offset
          // comment: a lower-bound hint, with the turn-floor + id-dedup merge
          // absorbing the over-read). Surfacing system turns to the user is a
          // UI decision, tracked separately.
          const messages = ((data.messages ?? []) as Message[]).filter(
            (msg) => msg.role === 'user' || msg.role === 'assistant'
          );
          const incoming: OptimisticConversationItem[] = messages.map((msg) => ({
            id: msg.message_id,
            timestamp: msg.created_at,
            turn_number: msg.turn_number,
            optimistic: false,
            originalId: msg.message_id,
            question: msg.role === 'user' ? msg.content : undefined,
            response: msg.role === 'assistant' ? msg.content : undefined
          }));
          if (incoming.length > 0) {
            let appended = 0;
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
              appended = fresh.length;

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
            // `appended` is the post-dedup count actually merged; the raw
            // fetch size would over-report on the capped-conversation
            // over-read, where everything is dropped by the merge.
            if (appended > 0) {
              log.info('Conversation delta applied', { caseId, added: appended, offset });
            }
          }
        })
        .catch(err => log.error('Failed to fetch conversation delta', { caseId, offset, err }))
        .finally(() => inFlightDeltaFetches.delete(caseId));
    },

    refreshActiveCaseFromList: async (caseId, opts) => {
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;
      if (isOptimisticId(resolvedCaseId)) return; // no backend row yet

      const epoch = getEpoch();
      try {
        let row: UserCase | undefined;
        if (opts?.bypassCache) {
          // Post-409 path: our copy of the case is known-stale, so the cached
          // list (same age or older) is too.
          await caseCacheManager.invalidateCache();
        } else {
          const cached = await caseCacheManager.getCachedCases();
          row = cached?.find((c) => c.case_id === resolvedCaseId);
        }
        if (!row) {
          const cases = await getUserCases({ limit: DEFAULT_CASE_LIST_LIMIT, offset: 0 });
          row = cases.find((c) => c.case_id === resolvedCaseId);
        }
        if (!row) return;
        if (epoch !== getEpoch()) {
          log.info('Session changed during case refresh — discarding', { caseId });
          return;
        }

        const freshRow = row;
        set((state) => {
          const current = state.activeCase;
          // Guard on identity: the user may have switched cases while the
          // fetch was in flight. The optimistic id may have been reconciled
          // to the real id in the meantime, so accept either.
          if (!current || (current.case_id !== caseId && current.case_id !== resolvedCaseId)) {
            return {};
          }
          // Never move a terminal activeCase back to an active state off a
          // stale list row (the cache TTL is minutes; a case resolved this
          // session can be ahead of it). Same-direction updates apply fully.
          const currentIsTerminal = current.state === 'resolved' || current.state === 'closed';
          const rowIsTerminal = freshRow.state === 'resolved' || freshRow.state === 'closed';
          if (currentIsTerminal && !rowIsTerminal) return {};

          // Keep the current id: swapping identity mid-reconciliation is the
          // id-mapping manager's job, not a side effect of hydration.
          return { activeCase: { ...current, ...freshRow, case_id: current.case_id } };
        });
      } catch (error) {
        log.debug('Active-case refresh from case list failed', { caseId, error });
      }
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
