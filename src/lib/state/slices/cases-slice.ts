import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import {
  AttachmentResult,
  DEFAULT_CASE_LIST_LIMIT,
  getCase,
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
import { selectCaseTitle } from '../case-title';
import { messageKind } from '../message-kind';
import { reconcileOptimisticIds } from '../reconcile-message-ids';
import type { StoreState } from '../store';
import { getHostStore } from '../../host-store';

const log = createLogger('CasesSlice');

// Case-level fields (state, closure_reason, closed_at) are deliberately NOT
// read off `/messages` rows — the backend Message model never carries them.
// The backend case row is the authoritative source (see refreshActiveCase).

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
  refreshActiveCase: (caseId: string) => Promise<void>;
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

      // THE single writer of this key. It was not: three call sites in
      // src/shared/ui set it as well, immediately after calling this, so the
      // same pointer was written twice by two code paths — and only this one
      // handles the clear, which those sites relied on without doing. One owner
      // of the value, one place to look when it is wrong.
      if (targetId) {
        await getHostStore().set({ faultmaven_current_case: targetId });
      } else {
        await getHostStore().remove(['faultmaven_current_case']);
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

      // Hydrate the placeholder from the backend case row — this restores
      // state/closure_reason/closed_at on reopening a terminal case (the
      // ChatWindow /ui sync copies only `state`).
      void get().refreshActiveCase(caseId);

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
          // Every retained row populates exactly one content slot, chosen by
          // `messageKind`: `question`, `response`, or `notice`. No row is
          // dropped for its ROLE.
          //
          // The previous allow-list kept only user/assistant and discarded the
          // rest, because an unmapped row would commit with BOTH `question` and
          // `response` undefined — invisible in ChatWindow, yet holding a
          // message_id that permanently blocks a corrected re-fetch through the
          // id-dedup below. Dropping was also silence, and silence was the
          // defect (#209): the runbook-conversion FAILURE notice travels on
          // `role: "system"` and is the only signal that the conversion failed
          // at all, as well as where the way out is named.
          // `notice` replaces the allow-list — a non-conversational row is now
          // renderable, so an unrecognised role no longer has to be discarded to
          // keep it out of the store.
          //
          // Blank-content rows are skipped: no committed item may be one that
          // renders nothing. Kind decides WHICH slot is populated and cannot
          // make an empty string render, and every content guard in ChatWindow
          // is a truthiness test, so such a row would sit in the conversation
          // as an item the user can never see. `QueryRequest.query` is
          // `min_length=1`, which admits a whitespace-only message, so this is
          // reachable rather than theoretical.
          //
          // Known cost, accepted deliberately — do not "fix" it by adding a
          // compensating counter without reading this: `offset` is a count of
          // local rows used as an INDEX into the backend list, so skipping one
          // leaves that case's offset permanently one short. Later opens
          // re-read the tail, and the id-dedup that would normally absorb an
          // over-read cannot see locally-submitted turns —
          // `useMessageSubmission` mints `opt_msg_*` ids and `TurnResponse`
          // carries no message ids for the client to adopt — so a re-read turn
          // can append as a duplicate. The blast radius is one case, only if it
          // holds a blank row, and it clears on the next
          // CONVERSATION_CACHE_VERSION bump. Since #213 the consequence is
          // milder still: a re-read locally-submitted turn is reconciled to its
          // backend id rather than appended twice, so the skew costs a repeated
          // fetch of the tail but no longer corrupts the conversation.
          //
          // A parallel skipped-row counter was considered
          // and rejected — it double-counts on the capped-conversation
          // over-read, turning a duplicate into a SKIPPED real message, which is
          // the worse direction.
          //
          // `turn_number` is carried on a notice even though it is never shown
          // (see ChatWindow): the turn-floor guard below needs it to place the
          // row against a bounded local suffix. What is suppressed is the CLAIM
          // that the notice belongs to that turn, not the ordering fact.
          const incoming: OptimisticConversationItem[] = (data.messages ?? [])
            .filter((msg) => (msg.content ?? '').trim() !== '')
            .map((msg) => {
              const kind = messageKind(msg.role);
              return {
                id: msg.message_id,
                timestamp: msg.created_at,
                turn_number: msg.turn_number,
                optimistic: false,
                originalId: msg.message_id,
                question: kind === 'user' ? msg.content : undefined,
                response: kind === 'assistant' ? msg.content : undefined,
                notice: kind === 'notice' ? msg.content : undefined
              };
            });
          if (incoming.length > 0) {
            let appended = 0;
            let reconciledCount = 0;
            set((state) => {
              const stored = state.conversations[caseId] || [];

              // Give locally-minted turns their backend identity BEFORE dedup
              // (#213). `useMessageSubmission` mints `opt_msg_*` ids and
              // `TurnResponse` carries none to adopt, so without this a re-read
              // of a turn the client submitted matches nothing by id and
              // appends a second copy. Matching on turn AND slot is what keeps
              // a notice — which shares a turn with the exchange it landed
              // during, but never its slot — from being swallowed here.
              const { rows: existing, adopted } = reconcileOptimisticIds(stored, incoming);
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
              // offset drift / races), (b) not just adopted onto a local row by
              // the reconciliation above, and (c) not below the retained-turn
              // floor.
              const fresh = incoming.filter(
                (m) =>
                  !existingIds.has(m.id) &&
                  !adopted.has(m.id) &&
                  (typeof m.turn_number !== 'number' || m.turn_number >= minLocalTurn)
              );
              // `existing !== stored` means a row adopted a backend id, which is
              // a state change even when nothing new is appended — returning
              // `state` here would discard it.
              if (fresh.length === 0 && existing === stored) return state;
              appended = fresh.length;
              reconciledCount = adopted.size;

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
            if (appended > 0 || reconciledCount > 0) {
              log.info('Conversation delta applied', {
                caseId,
                added: appended,
                // Rows that adopted a backend id instead of being appended as a
                // duplicate. Logged because it is the only outward sign the
                // reconciliation ran (#213).
                reconciled: reconciledCount,
                offset
              });
            }
          }
        })
        .catch(err => log.error('Failed to fetch conversation delta', { caseId, offset, err }))
        .finally(() => inFlightDeltaFetches.delete(caseId));
    },

    refreshActiveCase: async (caseId) => {
      const resolvedCaseId = isOptimisticId(caseId)
        ? idMappingManager.getRealId(caseId) || caseId
        : caseId;
      if (isOptimisticId(resolvedCaseId)) return; // no backend row yet

      const epoch = getEpoch();
      try {
        // Single-case GET: always fresh, immune to list pagination (a case
        // ranked beyond the first list page would never be found there), and
        // no coupling to the sidebar's list cache.
        const row = await getCase(resolvedCaseId);
        if (!row) return;
        if (epoch !== getEpoch()) {
          log.info('Session changed during case refresh — discarding', { caseId });
          return;
        }

        set((state) => {
          const current = state.activeCase;
          // Guard on identity: the user may have switched cases while the
          // fetch was in flight. The optimistic id may have been reconciled
          // to the real id in the meantime, so accept either.
          if (!current || (current.case_id !== caseId && current.case_id !== resolvedCaseId)) {
            return {};
          }
          // Belt-and-braces against out-of-order landings of concurrent
          // refreshes: never move a terminal activeCase back to an active
          // state.
          const currentIsTerminal = current.state === 'resolved' || current.state === 'closed';
          const rowIsTerminal = row.state === 'resolved' || row.state === 'closed';
          if (currentIsTerminal && !rowIsTerminal) return {};

          // Keep the current id: swapping identity mid-reconciliation is the
          // id-mapping manager's job, not a side effect of hydration.
          return { activeCase: { ...current, ...row, case_id: current.case_id } };
        });
      } catch (error) {
        // warn, not debug: this is the only recovery on the post-409 path and
        // the only source of closure metadata on case select, and debug logs
        // are dropped in production builds.
        log.warn('Active-case refresh failed', { caseId, error });
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
