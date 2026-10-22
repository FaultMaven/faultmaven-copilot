import { StateCreator } from 'zustand';
import { refreshSession as coreRefreshSession, setSessionOwner } from '../../api/session-core';
import { heartbeatSession } from '../../api/services/session-service';
import { getEpoch } from '../session-epoch';
import { createLogger } from '../../../lib/utils/logger';
import type { StoreState } from '../store';
import { ownedStorage } from '../../owned-storage';
import { clearPersistedSession } from '../../api/session-core';

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
  initializeSession: (shouldInitialize?: boolean, ownerId?: string | null) => Promise<void>;
  refreshSession: () => Promise<string>;
  clearSession: () => Promise<void>;
}

export const createSessionSlice: StateCreator<StoreState, [], [], SessionSlice> = (set, get) => {
  let heartbeatInterval: ReturnType<typeof setTimeout> | null = null;

  return {
    sessionId: null,
    isSessionInitialized: false,
    sessionError: null,

    initializeSession: async (shouldInitialize: boolean = true, ownerId: string | null = null) => {
      if (!shouldInitialize) {
        log.debug('Session initialization skipped - waiting for first-run completion');
        return;
      }

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      // The user this panel's session must belong to. A stored session that
      // is not theirs (minted for nobody, for another user, or before owners
      // were recorded) is replaced rather than reused (faultmaven#1460).
      setSessionOwner(ownerId);

      try {
        // Through refreshSession, which routes through session-core.refreshSession
        // (cross-context Web-Locks single-flight + owner re-check + persist) and
        // updates the store. Calling createSession() directly here let two
        // contexts — e.g. a sidepanel in each of several browser windows — herd
        // parallel /sessions POSTs. A thrown "no session_id persisted" propagates
        // to the catch below and becomes sessionError (init never rejects).
        await get().refreshSession();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Session initialization failed', error);
        set({
          sessionId: null,
          isSessionInitialized: false,
          sessionError: errorMessage
        });
      }

      // Start keep-alive heartbeat, whatever the outcome above: a mint refused
      // at mount (no credential at that instant) is retried by the next tick.
      // Pings the server so an open-but-idle panel keeps its investigation
      // session warm. Fully non-fatal: heartbeatSession does not route through
      // the auto-logout fetch wrapper, and any error is swallowed.
      //
      // The epoch this started under is what STOPS it. It used to ask
      // TokenManager whether anyone was still signed in, which is a question
      // about a credential this slice does not own — and it only skipped a
      // beat, so a sign-out in another context left the timer running
      // forever. A sign-out anywhere bumps the epoch, so comparing it both
      // answers the question the shared UI is allowed to ask and lets the
      // interval clear itself.
      const startedEpoch = getEpoch();
      heartbeatInterval = setInterval(async () => {
        try {
          if (getEpoch() !== startedEpoch) {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            log.debug('Session ended; heartbeat stopped');
            return;
          }
          // A no-op when the stored session is this user's; mints when not, so
          // a beat is only ever sent for a session the user owns.
          await get().refreshSession();
          const stored = (await ownedStorage.get(['sessionId'])) as { sessionId?: string };
          if (stored.sessionId) {
            try {
              await heartbeatSession(stored.sessionId);
            } catch (error) {
              // Gone (404) or not ours (403): drop it so the next tick mints.
              // Only that id — another context may have stored a fresh one.
              const status = (error as { status?: number }).status;
              if (status === 404 || status === 403) {
                const now = (await ownedStorage.get(['sessionId'])) as { sessionId?: string };
                if (now.sessionId === stored.sessionId) await clearPersistedSession();
              }
              throw error;
            }
            log.debug('Session heartbeat sent', { sessionId: stored.sessionId });
          }
        } catch (error) {
          log.warn('Session heartbeat failed (non-fatal)', error);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },

    refreshSession: async (): Promise<string> => {
      // Fence the store repopulation below: a logout racing a 401-retry refresh
      // must not re-seed the store's sessionId for the session that just ended.
      // (The storage-layer persist happens inside coreRefreshSession and is
      // single-flighted there; this guard covers the store, which is what the
      // UI reads. Lower severity than the case-pointer leak, but cheap to fence.)
      const epoch = getEpoch();
      try {
        log.info('Refreshing session');

        // Route through session-core's refresh, which is single-flighted across
        // contexts via the Web Locks API and persists the new session_id.
        // Calling createSession() directly here bypassed that mutex, so
        // concurrent callers (this slice's refresh + the 401-retry path in
        // client.ts, or two panels) herded parallel /sessions POSTs; it also
        // duplicated the persistence logic that could drift from session-core.
        await coreRefreshSession();

        const stored = (await ownedStorage.get(['sessionId'])) as { sessionId?: string };
        const sessionId = stored.sessionId as string | undefined;
        if (!sessionId) {
          throw new Error('Session refresh did not persist a session_id');
        }

        if (epoch !== getEpoch()) {
          log.info('Session ended during refresh — not repopulating store sessionId');
          return sessionId;
        }

        set({
          sessionId,
          isSessionInitialized: true,
          sessionError: null
        });

        return sessionId;
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
        // The single clear. A local key list here is how three call sites came
        // to disagree about which keys a cleared session leaves behind.
        await clearPersistedSession({ includeClientId: true });
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
