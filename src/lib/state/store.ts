import { create } from 'zustand';
import { createAppSlice, AppSlice } from './slices/app-slice';
import { createAuthSlice, AuthSlice } from './slices/auth-slice';
import { createSessionSlice, SessionSlice } from './slices/session-slice';
import { createCasesSlice, CasesSlice } from './slices/cases-slice';
import { createPendingOpsSlice, PendingOpsSlice } from './slices/pending-ops-slice';
import { debounce } from '../utils/debounce';
import { browser } from 'wxt/browser';
import { createLogger } from '../utils/logger';
import { idMappingManager, OptimisticConversationItem } from '../optimistic';
import { memoryManager } from '../utils/memory-manager';
import { isSessionEnding } from './session-epoch';
import { getHostStore } from '../host-store';

const log = createLogger('Store');

export type StoreState = AppSlice & AuthSlice & SessionSlice & CasesSlice & PendingOpsSlice;

// The store-state keys that are persisted to host storage and hydrated
// back on load. Shared so the persist trigger (the subscribe change-detection
// below) and the hydrate read (useDataRecovery) draw from one list and can't
// drift apart. NOTE: debouncedPersist's body still writes each key explicitly —
// its per-key logic (empty-key clearing, conversation sanitizing) isn't derivable
// from this list — so a key added here must also be handled there. `idMappings`
// is persisted alongside these but is sourced from idMappingManager, not store
// state, so it is handled explicitly at each site rather than listed here.
/**
 * Schema version of the persisted `conversations` map.
 *
 * The delta fetch in `handleCaseSelect` uses the local committed-message count
 * as an OFFSET into the backend row list, which is only meaningful while the
 * local copy is a lossless prefix of that list. Builds before v2 filtered
 * `role: "system"` rows out at the mapper, so every cached conversation on such
 * a build is short by exactly the rows it dropped — and the offset therefore
 * points PAST them. They can never be re-requested: the fix for #209 would
 * reach new notices only, and miss the case that already has a stuck runbook
 * conversion, which is the one the user is waiting on.
 *
 * v3 (#213) discards caches written before the delta merge reconciled
 * locally-minted ids. Two reasons, and the first is not merely cosmetic:
 *
 *  - A cache that ALREADY holds a duplicated turn cannot repair itself. The
 *    reconciliation skips an incoming row whose id is already present, so the
 *    backend rows can never claim the `opt_` ones — and the inflated committed
 *    count pushes `offset` past the backend's row count, so the fetch returns an
 *    empty page, `incoming` is empty, and the merge never runs again. That case
 *    is frozen for new messages too, not just stuck with the duplicate.
 *  - Rows written by an older build carry a `highestTurn + 1` PREDICTION as
 *    their turn number. The matcher trusts turn numbers, so a wrong prediction
 *    could match a different backend turn in the same slot and adopt its content
 *    — replacing what the user actually said. Discarding is the only way to be
 *    sure every turn number in the cache came from the backend.
 *
 * A version mismatch discards the cached conversations at hydrate
 * (`useDataRecovery`), so each case reopens at offset 0 and re-reads the whole
 * list — notices included, in backend order, with backend message_ids. Nothing
 * is lost: committed messages all live on the backend (transient ones are never
 * persisted), and titles, pins and id-mappings are untouched. Re-merging into a
 * cache written by an older build was the alternative and is worse: a recovered
 * mid-list row would append at the END, out of order.
 *
 * Bump this whenever a change alters WHICH backend rows reach the store, or what
 * the store may assume about the rows it already holds. Both invalidate the
 * prefix assumption the offset depends on.
 */
export const CONVERSATION_CACHE_VERSION = 3;

/** Storage key holding {@link CONVERSATION_CACHE_VERSION} for the persisted map. */
export const CONVERSATION_CACHE_VERSION_KEY = 'conversationCacheVersion';

export const PERSISTED_STATE_KEYS = [
  'conversationTitles',
  'titleSources',
  'conversations',
  'pinnedCases'
] as const;

export const useAppStore = create<StoreState>()((set, get, store) => ({
  ...createAppSlice(set, get, store),
  ...createAuthSlice(set, get, store),
  ...createSessionSlice(set, get, store),
  ...createCasesSlice(set, get, store),
  ...createPendingOpsSlice(set, get, store)
}));

// Debounced persistence helper
export const debouncedPersist = debounce(
  async (stateToSave: {
    conversationTitles: Record<string, string>;
    titleSources: Record<string, 'user' | 'backend' | 'system'>;
    conversations: Record<string, OptimisticConversationItem[]>;
    pinnedCases: string[];
  }) => {
    // Never persist during a teardown/hand-off reload: the pending call snapshots the
    // ending session's state, which can be a prior user's just-purged residue. The
    // beforeunload handler already cancels the pending call; this guard also covers the
    // millisecond window where the debounce timer could expire naturally between
    // reload() and beforeunload, making the teardown invariant independent of event
    // ordering (#164).
    if (isSessionEnding()) return;

    try {
      const storageData: Record<string, unknown> = {};
      const keysToRemove: string[] = [];

      if (Object.keys(stateToSave.conversationTitles).length > 0) {
        storageData.conversationTitles = stateToSave.conversationTitles;
      } else {
        keysToRemove.push('conversationTitles');
      }

      if (Object.keys(stateToSave.titleSources).length > 0) {
        storageData.titleSources = stateToSave.titleSources;
      } else {
        keysToRemove.push('titleSources');
      }

      // Persist committed conversation data only: drop transient (optimistic /
      // loading / failed) messages and cap growth, so a reload never rehydrates
      // a stuck "thinking" spinner or a soon-to-be-duplicated optimistic turn,
      // and storage cannot grow without bound across a long-lived side panel.
      const safeConversations = memoryManager.sanitizeAndCapForPersistence(
        stateToSave.conversations,
        useAppStore.getState().activeCaseId ?? undefined
      );
      if (Object.keys(safeConversations).length > 0) {
        storageData.conversations = safeConversations;
        // Stamp the schema alongside the data it describes, so the hydrate can
        // tell a cache this build wrote from one an older build did. Written
        // only when conversations are, and cleared with them, so the version can
        // never outlive the map it refers to.
        storageData[CONVERSATION_CACHE_VERSION_KEY] = CONVERSATION_CACHE_VERSION;
      } else {
        keysToRemove.push('conversations');
        keysToRemove.push(CONVERSATION_CACHE_VERSION_KEY);
      }

      // NOTE: pendingOperations is deliberately NOT persisted. Its retry/rollback
      // functions are closures that cannot survive JSON serialization, so a
      // "restored" pending operation could never actually retry or roll back.
      // pendingOpsManager is the single in-session source of truth; after a
      // reload, in-flight/failed turns are reconciled from the backend instead.

      storageData.pinnedCases = stateToSave.pinnedCases;

      // Persist idMappings
      const currentMappings = idMappingManager.getState();
      if (currentMappings) {
        const optToReal = Object.fromEntries(currentMappings.optimisticToReal.entries());
        const realToOpt = Object.fromEntries(currentMappings.realToOptimistic.entries());
        if (Object.keys(optToReal).length > 0 || Object.keys(realToOpt).length > 0) {
          storageData.idMappings = {
            optimisticToReal: optToReal,
            realToOptimistic: realToOpt
          };
        }
      }

      if (Object.keys(storageData).length > 0) {
        await getHostStore().set(storageData);
        log.debug('Store batched save completed', {
          keys: Object.keys(storageData),
          removedKeys: keysToRemove
        });
      }

      if (keysToRemove.length > 0) {
        await getHostStore().remove(keysToRemove);
        log.debug('Store cleared empty keys', keysToRemove);
      }
    } catch (error) {
      log.error('Store batched save failed', error);
    }
  },
  { wait: 1000 }
);

// Subscribe to store updates
let previousState = useAppStore.getState();

useAppStore.subscribe((state) => {
  if (PERSISTED_STATE_KEYS.some((key) => state[key] !== previousState[key])) {
    previousState = state;
    debouncedPersist({
      conversationTitles: state.conversationTitles,
      titleSources: state.titleSources,
      conversations: state.conversations,
      pinnedCases: Array.from(state.pinnedCases)
    });
  }
});

// Flush any pending persist on a normal unload so the last committed turn isn't
// lost. But on a teardown/hand-off reload (logout / identity switch), CANCEL
// instead: the pending persist snapshots the ending session's in-memory state,
// which can be a prior user's just-purged residue — flushing it would write that
// residue back to storage after the purge and re-home it under the new owner
// (#164). The reload paths call `markSessionEnding()` before reloading.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (isSessionEnding()) {
      debouncedPersist.cancel();
    } else {
      debouncedPersist.flush();
    }
  });
}
