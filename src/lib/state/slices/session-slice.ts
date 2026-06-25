import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { createSession } from '../../../lib/api';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('SessionSlice');

export interface SessionSlice {
  sessionId: string | null;
  isSessionInitialized: boolean;
  sessionError: string | null;

  // Actions
  initializeSession: (shouldInitialize?: boolean) => Promise<void>;
  refreshSession: () => Promise<string>;
  clearSession: () => Promise<void>;
}

export const createSessionSlice: StateCreator<any, [], [], SessionSlice> = (set, get) => {
  let heartbeatInterval: NodeJS.Timeout | null = null;

  return {
    sessionId: null,
    isSessionInitialized: false,
    sessionError: null,

    initializeSession: async (shouldInitialize: boolean = true) => {
      if (!shouldInitialize) {
        log.debug('Session initialization skipped - waiting for first-run completion');
        return;
      }

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      try {
        if (typeof browser === 'undefined' || !browser.storage) {
          throw new Error('Browser storage not available');
        }

        const result = await browser.storage.local.get(['sessionId']);

        if (result.sessionId) {
          log.debug('Using existing session', { sessionId: result.sessionId });
          set({
            sessionId: result.sessionId,
            isSessionInitialized: true,
            sessionError: null
          });
        } else {
          log.info('Creating new session');
          const session = await createSession();

          if (!session.session_id) {
            throw new Error('Invalid session response: missing session_id');
          }

          await browser.storage.local.set({
            sessionId: session.session_id,
            sessionCreatedAt: Date.now(),
            sessionResumed: session.session_resumed || false,
            clientId: session.client_id
          });

          log.info('Session created', {
            sessionId: session.session_id,
            resumed: session.session_resumed
          });

          set({
            sessionId: session.session_id,
            isSessionInitialized: true,
            sessionError: null
          });
        }

        // Start heartbeat (every 5 minutes)
        heartbeatInterval = setInterval(async () => {
          try {
            const stored = await browser.storage.local.get(['sessionId']);
            if (stored.sessionId) {
              log.debug('Session heartbeat', { sessionId: stored.sessionId });
            }
          } catch (error) {
            log.error('Heartbeat failed', error);
          }
        }, 5 * 60 * 1000);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Session initialization failed', error);
        set({
          sessionId: null,
          isSessionInitialized: false,
          sessionError: errorMessage
        });
      }
    },

    refreshSession: async (): Promise<string> => {
      try {
        log.info('Refreshing session');
        const session = await createSession();

        await browser.storage.local.set({
          sessionId: session.session_id,
          sessionCreatedAt: Date.now(),
          sessionResumed: session.session_resumed || false,
          clientId: session.client_id
        });

        set({
          sessionId: session.session_id,
          isSessionInitialized: true,
          sessionError: null
        });

        return session.session_id;
      } catch (error) {
        log.error('Session refresh failed', error);
        throw error;
      }
    },

    clearSession: async () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      try {
        await browser.storage.local.remove(['sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId']);
        set({
          sessionId: null,
          isSessionInitialized: false,
          sessionError: null
        });
        log.info('Session cleared');
      } catch (error) {
        log.error('Failed to clear session', error);
      }
    }
  };
};
