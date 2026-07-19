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

const log = createLogger('Store');

export type StoreState = AppSlice & AuthSlice & SessionSlice & CasesSlice & PendingOpsSlice;

// The store-state keys that are persisted to browser.storage.local and hydrated
// back on load. Shared so the persist trigger (the subscribe change-detection
// below) and the hydrate read (useDataRecovery) draw from one list and can't
// drift apart. NOTE: debouncedPersist's body still writes each key explicitly —
// its per-key logic (empty-key clearing, conversation sanitizing) isn't derivable
// from this list — so a key added here must also be handled there. `idMappings`
// is persisted alongside these but is sourced from idMappingManager, not store
// state, so it is handled explicitly at each site rather than listed here.
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
      } else {
        keysToRemove.push('conversations');
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
        await browser.storage.local.set(storageData);
        log.debug('Store batched save completed', {
          keys: Object.keys(storageData),
          removedKeys: keysToRemove
        });
      }

      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
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

// Flush on window beforeunload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    debouncedPersist.flush();
  });
}
