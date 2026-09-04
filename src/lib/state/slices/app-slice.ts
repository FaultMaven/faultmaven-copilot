import { getHostEndpoints } from '../../host-endpoints';
import { StateCreator } from 'zustand';
import { capabilitiesManager, BackendCapabilities } from '../../capabilities';
import { createLogger } from '../../utils/logger';
import type { KnowledgeDocument } from '../../../lib/api';
import type { StoreState } from '../store';
import { getHostStore } from '../../host-store';

const log = createLogger('AppSlice');

export interface AppSlice {
  activeTab: 'copilot';
  hasCompletedFirstRun: boolean | null;
  capabilities: BackendCapabilities | null;
  initializingCapabilities: boolean;
  capabilitiesError: string | null;
  sidebarCollapsed: boolean;
  refreshSessions: number;
  viewingDocument: KnowledgeDocument | null;
  isDocumentModalOpen: boolean;
  hasUnsavedNewChat: boolean;

  // Actions
  setActiveTab: (tab: 'copilot') => void;
  setHasCompletedFirstRun: (completed: boolean | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setViewingDocument: (doc: KnowledgeDocument | null) => void;
  setIsDocumentModalOpen: (open: boolean) => void;
  triggerRefreshSessions: () => void;
  setHasUnsavedNewChat: (hasUnsaved: boolean) => void;
  initializeApp: () => Promise<void>;
  loadCapabilities: () => Promise<void>;
}

export const createAppSlice: StateCreator<StoreState, [], [], AppSlice> = (set, get) => ({
  activeTab: 'copilot',
  hasCompletedFirstRun: null,
  capabilities: null,
  initializingCapabilities: true,
  capabilitiesError: null,
  sidebarCollapsed: false,
  refreshSessions: 0,
  viewingDocument: null,
  isDocumentModalOpen: false,
  hasUnsavedNewChat: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setHasCompletedFirstRun: (completed) => set({ hasCompletedFirstRun: completed }),
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    getHostStore().set({ sidebarCollapsed: collapsed }).catch((err) => {
      log.error('Failed to persist sidebar state', err);
    });
  },
  setViewingDocument: (doc) => set({ viewingDocument: doc }),
  setIsDocumentModalOpen: (open) => set({ isDocumentModalOpen: open }),
  triggerRefreshSessions: () => set((state) => ({ refreshSessions: state.refreshSessions + 1 })),
  setHasUnsavedNewChat: (hasUnsaved) => set({ hasUnsavedNewChat: hasUnsaved }),

  initializeApp: async () => {
    try {
      // Load first-run status
      const stored = (await getHostStore().get(['hasCompletedFirstRun'])) as {
        hasCompletedFirstRun?: boolean;
      };
      const completedFirstRun = stored.hasCompletedFirstRun || false;
      set({ hasCompletedFirstRun: completedFirstRun });

      // Load sidebar state
      const sidebarStored = (await getHostStore().get(['sidebarCollapsed'])) as {
        sidebarCollapsed?: boolean;
      };
      if (sidebarStored.sidebarCollapsed !== undefined) {
        set({ sidebarCollapsed: sidebarStored.sidebarCollapsed });
      }

      if (!completedFirstRun) {
        set({ initializingCapabilities: false });
        return;
      }

      // Load capabilities if first run is completed
      await get().loadCapabilities();
    } catch (err) {
      log.error('Failed to initialize app state:', err);
      set({ initializingCapabilities: false });
    }
  },

  loadCapabilities: async () => {
    set({ initializingCapabilities: true });
    try {
      const apiEndpoint = await getHostEndpoints().apiUrl();
      const caps = await capabilitiesManager.fetch(apiEndpoint);
      set({ capabilities: caps, capabilitiesError: null });
    } catch (error) {
      log.error('Failed to load backend capabilities:', error);
      set({ capabilitiesError: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ initializingCapabilities: false });
    }
  }
});
