import { StateCreator } from 'zustand';
import { browser } from 'wxt/browser';
import { createSession } from '../../../lib/api';
import { heartbeatSession } from '../../api/services/session-service';
import { tokenManager } from '../../auth/token-manager';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('SessionSlice');

// Keep-alive ping interval. The server reaps an investigation session after N
// min of inactivity (redis_session_store default_ttl, 30 min by default). Real
// requests already refresh that TTL; this ping only covers long panel-open-but-
// idle stretches (e.g. reading a report) so the session isn't reaped mid-read.
// The 10-min default is the largest interval that still tolerates one missed
// beat within the default 30-min TTL (2 × 10 < 30) — MV3 timers can be throttled,
// so leave that margin. Overridable via VITE_HEARTBEAT_INTERVAL_MS for operators
// who tune the server TTL (mirrors the VITE_POLL_* knobs).
const HEARTBEAT_INTERVAL_MS = Number(
  import.meta.env.VITE_HEARTBEAT_INTERVAL_MS ?? 10 * 60 * 1000
);

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

        // Start keep-alive heartbeat. Pings the server so an open-but-idle panel
        // keeps its investigation session warm. Fully non-fatal: heartbeatSession
        // does not route through the auto-logout fetch wrapper, the isAuthenticated
        // check skips pointless pings when logged out, and any error is swallowed —
        // if the session is already gone the next real request recreates it
        // (SESSION_EXPIRED).
        heartbeatInterval = setInterval(async () => {
          try {
            if (!(await tokenManager.isAuthenticated())) return;
            const stored = await browser.storage.local.get(['sessionId']);
            if (stored.sessionId) {
              await heartbeatSession(stored.sessionId);
              log.debug('Session heartbeat sent', { sessionId: stored.sessionId });
            }
          } catch (error) {
            log.warn('Session heartbeat failed (non-fatal)', error);
          }
        }, HEARTBEAT_INTERVAL_MS);

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
