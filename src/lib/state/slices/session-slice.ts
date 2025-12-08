import { StateCreator } from 'zustand';
import { clientSessionManager } from '../../session/client-session-manager';
import { BackendCapabilities, capabilitiesManager } from '../../capabilities';
import { browser } from 'wxt/browser';

export interface SessionSlice {
  // State
  sessionId: string | null;
  hasCompletedFirstRun: boolean | null;
  capabilities: BackendCapabilities | null;
  initializingCapabilities: boolean;
  capabilitiesError: string | null;
  refreshSessions: number;

  // Actions
  initializeSession: () => Promise<void>;
  createSession: () => Promise<string>;
  clearSession: () => Promise<void>;
  setSessionId: (sessionId: string | null) => void;
  initializeCapabilities: () => Promise<void>;
  completeFirstRun: () => Promise<void>;
  triggerSessionRefresh: () => void;
}

export const createSessionSlice: StateCreator<SessionSlice> = (set, get) => ({
  // Initial State
  sessionId: null,
  hasCompletedFirstRun: null,
  capabilities: null,
  initializingCapabilities: true,
  capabilitiesError: null,
  refreshSessions: 0,

  // Actions
  initializeSession: async () => {
    try {
      // Try to recover session from client manager
      // We pass 0 timeout to just check existence, real creation uses default
      // Actually, we just want to see if we have a valid session ID in storage
      // The old logic was:
      // const stored = await browser.storage.local.get(["sessionId", ...]);
      // if (stored.sessionId) setSessionId(stored.sessionId);
      
      // We can delegate to ClientSessionManager to get current client ID, but session ID is app level
      // Let's stick to the behavior in SidePanelApp.tsx for now
      
      if (typeof browser !== 'undefined' && browser.storage) {
        const stored = await browser.storage.local.get(["sessionId", "sessionResumed"]);
        if (stored.sessionId) {
          set({ sessionId: stored.sessionId });
          console.log('[SessionSlice] Session initialized:', stored.sessionId);
        } else {
          set({ sessionId: null });
        }
      }
    } catch (error) {
      console.warn('[SessionSlice] Session initialization error:', error);
      set({ sessionId: null });
    }
  },

  createSession: async () => {
    try {
      const session = await clientSessionManager.createSessionWithRecovery();
      set({ sessionId: session.session_id });
      
      if (typeof browser !== 'undefined' && browser.storage) {
        await browser.storage.local.set({
          sessionId: session.session_id,
          sessionCreatedAt: Date.now(),
          sessionResumed: session.session_resumed
        });
      }
      return session.session_id;
    } catch (error) {
      console.error('[SessionSlice] Failed to create session:', error);
      throw error;
    }
  },

  clearSession: async () => {
    set({ sessionId: null });
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.remove([
        "sessionId", "sessionCreatedAt", "sessionResumed", "clientId"
      ]);
    }
    // Also clear client ID from manager
    await clientSessionManager.clearClientId();
  },

  setSessionId: (sessionId: string | null) => {
    set({ sessionId });
    if (sessionId && typeof browser !== 'undefined' && browser.storage) {
      browser.storage.local.set({ sessionId }).catch(console.error);
    }
  },

  initializeCapabilities: async () => {
    set({ initializingCapabilities: true, capabilitiesError: null });
    try {
      // 1. Check first run
      let completedFirstRun = false;
      let apiEndpoint = 'https://api.faultmaven.ai';

      if (typeof browser !== 'undefined' && browser.storage) {
        const stored = await browser.storage.local.get(['hasCompletedFirstRun', 'apiEndpoint']);
        completedFirstRun = stored.hasCompletedFirstRun || false;
        if (stored.apiEndpoint) apiEndpoint = stored.apiEndpoint;
      }

      set({ hasCompletedFirstRun: completedFirstRun });

      if (!completedFirstRun) {
        set({ initializingCapabilities: false });
        return;
      }

      // 2. Fetch capabilities
      const caps = await capabilitiesManager.fetch(apiEndpoint);
      set({ capabilities: caps });
    } catch (error) {
      console.error('[SessionSlice] Failed to load capabilities:', error);
      set({ capabilitiesError: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ initializingCapabilities: false });
    }
  },

  completeFirstRun: async () => {
    set({ hasCompletedFirstRun: true });
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.set({ hasCompletedFirstRun: true });
    }
    // Trigger capability fetch
    await get().initializeCapabilities();
  },

  triggerSessionRefresh: () => {
    set((state) => ({ refreshSessions: state.refreshSessions + 1 }));
  }
});

