import { create } from 'zustand';
import { createAppSlice, AppSlice } from './slices/app-slice';
import { createAuthSlice, AuthSlice } from './slices/auth-slice';
import { createSessionSlice, SessionSlice } from './slices/session-slice';
import { createCasesSlice, CasesSlice } from './slices/cases-slice';
import { createPendingOpsSlice, PendingOpsSlice } from './slices/pending-ops-slice';
import { debounce } from '../utils/debounce';
import { browser } from 'wxt/browser';
import { createLogger } from '../utils/logger';
import { idMappingManager } from '../optimistic';

const log = createLogger('Store');

export type StoreState = AppSlice & AuthSlice & SessionSlice & CasesSlice & PendingOpsSlice;

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
    conversations: Record<string, any[]>;
    pendingOperations: Record<string, any>;
    optimisticCases: any[];
    pinnedCases: string[];
  }) => {
    try {
      const storageData: Record<string, any> = {};
      const keysToRemove: string[] = [];

      if (Object.keys(stateToSave.conversationTitles).length > 0) {
        storageData.conversationTitles = stateToSave.conversationTitles;
      }

      if (Object.keys(stateToSave.titleSources).length > 0) {
        storageData.titleSources = stateToSave.titleSources;
      }

      if (Object.keys(stateToSave.conversations).length > 0) {
        storageData.conversations = stateToSave.conversations;
      }

      if (Object.keys(stateToSave.pendingOperations).length > 0) {
        storageData.pendingOperations = stateToSave.pendingOperations;
      } else {
        keysToRemove.push('pendingOperations');
      }

      if (stateToSave.optimisticCases.length > 0) {
        storageData.optimisticCases = stateToSave.optimisticCases;
      } else {
        keysToRemove.push('optimisticCases');
      }

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
  if (
    state.conversationTitles !== previousState.conversationTitles ||
    state.titleSources !== previousState.titleSources ||
    state.conversations !== previousState.conversations ||
    state.pendingOperations !== previousState.pendingOperations ||
    state.optimisticCases !== previousState.optimisticCases ||
    state.pinnedCases !== previousState.pinnedCases
  ) {
    previousState = state;
    debouncedPersist({
      conversationTitles: state.conversationTitles,
      titleSources: state.titleSources,
      conversations: state.conversations,
      pendingOperations: state.pendingOperations,
      optimisticCases: state.optimisticCases,
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
