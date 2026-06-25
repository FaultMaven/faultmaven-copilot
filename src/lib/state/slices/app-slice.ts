import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { getApiUrl } from '../../../config';
import { capabilitiesManager, BackendCapabilities } from '../../capabilities';
import { createLogger } from '../../utils/logger';

const log = createLogger('AppSlice');

export interface AppSlice {
  activeTab: 'copilot';
  hasCompletedFirstRun: boolean | null;
  capabilities: BackendCapabilities | null;
  initializingCapabilities: boolean;
  capabilitiesError: string | null;
  sidebarCollapsed: boolean;
  refreshSessions: number;
  viewingDocument: any | null;
  isDocumentModalOpen: boolean;
  hasUnsavedNewChat: boolean;

  // Actions
  setActiveTab: (tab: 'copilot') => void;
  setHasCompletedFirstRun: (completed: boolean | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setViewingDocument: (doc: any | null) => void;
  setIsDocumentModalOpen: (open: boolean) => void;
  triggerRefreshSessions: () => void;
  setHasUnsavedNewChat: (hasUnsaved: boolean) => void;
  initializeApp: () => Promise<void>;
  loadCapabilities: () => Promise<void>;
}

export const createAppSlice: StateCreator<any, [], [], AppSlice> = (set, get) => ({
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
    browser.storage.local.set({ sidebarCollapsed: collapsed }).catch((err) => {
      log.error('Failed to persist sidebar state', err);
    });
  },
  setViewingDocument: (doc) => set({ viewingDocument: doc }),
  setIsDocumentModalOpen: (open) => set({ isDocumentModalOpen: open }),
  triggerRefreshSessions: () => set((state: any) => ({ refreshSessions: state.refreshSessions + 1 })),
  setHasUnsavedNewChat: (hasUnsaved) => set({ hasUnsavedNewChat: hasUnsaved }),

  initializeApp: async () => {
    try {
      // Load first-run status
      const stored = await browser.storage.local.get(['hasCompletedFirstRun']);
      const completedFirstRun = stored.hasCompletedFirstRun || false;
      set({ hasCompletedFirstRun: completedFirstRun });

      // Load sidebar state
      const sidebarStored = await browser.storage.local.get(['sidebarCollapsed']);
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
      const apiEndpoint = await getApiUrl();
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
