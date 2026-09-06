import { getHostEndpoints } from '../../host-endpoints';
import { StateCreator } from 'zustand';
import { capabilitiesManager, BackendCapabilities } from '../../capabilities';
import { createLogger } from '../../utils/logger';
import type { KnowledgeDocument } from '../../../lib/api';
import type { StoreState } from '../store';
import { ownedStorage } from '../../owned-storage';
import { hasAppBootstrapped, markAppBootstrapped } from '../app-bootstrap';

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
  /**
   * @param skipOnboardingGate a host that embeds the panel owns onboarding, so
   *   the extension's first-run flag must not decide whether capabilities load.
   */
  initializeApp: (options?: { skipOnboardingGate?: boolean }) => Promise<void>;
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
    ownedStorage.set({ sidebarCollapsed: collapsed }).catch((err) => {
      log.error('Failed to persist sidebar state', err);
    });
  },
  setViewingDocument: (doc) => set({ viewingDocument: doc }),
  setIsDocumentModalOpen: (open) => set({ isDocumentModalOpen: open }),
  triggerRefreshSessions: () => set((state) => ({ refreshSessions: state.refreshSessions + 1 })),
  setHasUnsavedNewChat: (hasUnsaved) => set({ hasUnsavedNewChat: hasUnsaved }),

  initializeApp: async ({ skipOnboardingGate = false } = {}) => {
    // One bootstrap per page load, however many components ask for one.
    //
    // Two do. Since #240 split the extension's entry out of the shared UI,
    // ExtensionApp bootstraps before it will mount the panel, and CopilotPanel
    // bootstraps on mount — and the entry ALSO renders a loading screen while
    // `initializingCapabilities` is true, so the panel's call unmounted the
    // panel that made it: mount → initializeApp → the flag goes true → the
    // entry swaps the panel for its loading screen → unmount → capabilities
    // settle → the flag goes false → remount → initializeApp → … The panel
    // remounted for as long as the renderer survived, refetching capabilities
    // every cycle, and the side-panel document died under it (#251).
    //
    // Guarding here rather than in either component is what makes it a property
    // of the bootstrap instead of an arrangement two call sites have to keep:
    // `loadCapabilities` is the only thing that raises the flag, so a bootstrap
    // that runs once can no longer raise it a second time, and no host gating on
    // it can be made to unmount the component that asked.
    if (hasAppBootstrapped()) return;
    try {
      // Load first-run status
      const stored = (await ownedStorage.get(['hasCompletedFirstRun'])) as {
        hasCompletedFirstRun?: boolean;
      };
      const completedFirstRun = stored.hasCompletedFirstRun || false;
      set({ hasCompletedFirstRun: completedFirstRun });

      // Load sidebar state
      const sidebarStored = (await ownedStorage.get(['sidebarCollapsed'])) as {
        sidebarCollapsed?: boolean;
      };
      if (sidebarStored.sidebarCollapsed !== undefined) {
        set({ sidebarCollapsed: sidebarStored.sidebarCollapsed });
      }

      // First-run onboarding is the EXTENSION's: a fresh install must choose an
      // endpoint before anything can be fetched. A host that EMBEDS the panel
      // has already onboarded its user and already knows where its backend is,
      // so gating on a flag it never sets left capabilities permanently
      // unloaded — and the only way round it was for that host to reach into
      // storage and write `hasCompletedFirstRun` itself, which is a host
      // writing a key that belongs to another host's flow.
      if (!completedFirstRun && !skipOnboardingGate) {
        set({ initializingCapabilities: false });
        return;
      }

      // Latched HERE, past the onboarding gate above, rather than on entry: an
      // un-onboarded host was turned away without bootstrapping anything, and
      // marking that as done would leave capabilities permanently unloaded for
      // the extension once its user finishes the first-run flow.
      markAppBootstrapped();

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
