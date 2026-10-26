import { StateCreator } from 'zustand';
import {
  clearPersistedSession,
  clearPersistedSessionIf,
  refreshSession as coreRefreshSession,
} from '../../api/session-core';
import { heartbeatSession } from '../../api/services/session-service';
import { getEpoch } from '../session-epoch';
import { createLogger } from '../../../lib/utils/logger';
import type { StoreState } from '../store';
import { ownedStorage } from '../../owned-storage';

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

// The first wait after a failed ensure (init, tick or retry); it doubles per
// failure up to the heartbeat interval and resets on success (faultmaven#1460).
const ENSURE_RETRY_MS = 15_000;

export interface SessionSlice {
  sessionId: string | null;
  isSessionInitialized: boolean;
  sessionError: string | null;

  // Actions
  initializeSession: (shouldInitialize: boolean, ownerId: string) => Promise<void>;
  /** The owner's session id, or `null` when the session ended meanwhile (nothing stored). */
  refreshSession: () => Promise<string | null>;
  clearSession: () => Promise<void>;
}

export const createSessionSlice: StateCreator<StoreState, [], [], SessionSlice> = (set, get) => {
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // The one pending ensure retry, and the wait the next one gets.
  let ensureRetry: ReturnType<typeof setTimeout> | null = null;
  let ensureRetryMs = ENSURE_RETRY_MS;
  // The panel's signed-in user: the only user this slice mints for, and the
  // owner a stored session must have to be reused (faultmaven#1460).
  let owner: string | null = null;

  const stopRetry = () => {
    if (ensureRetry) clearTimeout(ensureRetry);
    ensureRetry = null;
    ensureRetryMs = ENSURE_RETRY_MS;
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    stopRetry();
  };

  return {
    sessionId: null,
    isSessionInitialized: false,
    sessionError: null,

    initializeSession: async (shouldInitialize: boolean, ownerId: string) => {
      if (!shouldInitialize) {
        log.debug('Session initialization skipped - waiting for first-run completion');
        return;
      }

      // Synchronously, before any await: an overlapping init then replaces
      // this timer instead of adding a second, and a sign-out during the
      // ensure below finds a timer to stop.
      stopHeartbeat();
      owner = ownerId;

      // Keep-alive heartbeat, started whatever the ensure below concludes: a
      // mint refused at mount is retried by the scheduler below, and each tick
      // ensures before it beats. Pings the server so an
      // open-but-idle panel keeps its investigation session warm. Fully
      // non-fatal: heartbeatSession does not route through the auto-logout
      // fetch wrapper, and any error is swallowed.
      //
      // The epoch this started under is what STOPS it. It used to ask
      // TokenManager whether anyone was still signed in, which is a question
      // about a credential this slice does not own — and it only skipped a
      // beat, so a sign-out in another context left the timer running
      // forever. A sign-out anywhere bumps the epoch, so comparing it both
      // answers the question the shared UI is allowed to ask and lets the
      // interval clear itself.
      const startedEpoch = getEpoch();
      // Whether this init's timers still run: not stopped (clearSession, a
      // re-init) and not outlived by the session they started under.
      const live = () => heartbeatInterval === interval && getEpoch() === startedEpoch;

      // The one ensure scheduler (faultmaven#1460). A failed ensure (at init,
      // on a tick, or a retry) is retried 15 s later, the wait doubling per
      // failure up to the heartbeat interval; a success resets it. Before it,
      // a mint refused at init got one retry and then waited for the next
      // tick, 10 minutes by default. A retry with no usable token can still
      // cost one renewal call in a host that renews near expiry (the
      // Dashboard); the mint itself is not sent without a bearer.
      const ensure = async (): Promise<string | null> => {
        if (!live()) return null;
        try {
          const sessionId = await get().refreshSession();
          if (sessionId !== null && live()) stopRetry();
          return sessionId;
        } catch (error) {
          if (live() && !ensureRetry) {
            const wait = Math.min(ensureRetryMs, HEARTBEAT_INTERVAL_MS);
            ensureRetryMs = Math.min(wait * 2, HEARTBEAT_INTERVAL_MS);
            ensureRetry = setTimeout(() => {
              ensureRetry = null;
              ensure().catch(() => {});
            }, wait);
          }
          throw error;
        }
      };

      const interval = setInterval(async () => {
        try {
          if (getEpoch() !== startedEpoch) {
            stopHeartbeat();
            log.debug('Session ended; heartbeat stopped');
            return;
          }
          // A no-op when the stored session is this user's; mints when not, so
          // a beat is only ever sent for a session the user owns.
          const sessionId = await ensure();
          if (sessionId) {
            try {
              await heartbeatSession(sessionId);
            } catch (error) {
              // Gone (404), or not ours (403: defensive, the server's heartbeat
              // answers none today). Drop it and re-ensure at once rather than
              // at the next tick; a failure there goes to the scheduler.
              const status = (error as { status?: number }).status;
              if (status === 404 || status === 403) {
                await clearPersistedSessionIf(sessionId);
                if (get().sessionId === sessionId) set({ sessionId: null });
                await ensure().catch(() => {});
              }
              throw error;
            }
            log.debug('Session heartbeat sent', { sessionId });
          }
        } catch (error) {
          log.warn('Session heartbeat failed (non-fatal)', error);
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatInterval = interval;

      try {
        // Through refreshSession, which routes through session-core.refreshSession
        // (cross-context Web-Locks single-flight + owner re-check + persist) and
        // updates the store. Calling createSession() directly here let two
        // contexts — e.g. a sidepanel in each of several browser windows — herd
        // parallel /sessions POSTs. A thrown "no session_id persisted" propagates
        // to the catch below and becomes sessionError (init never rejects).
        await ensure();
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

    refreshSession: async (): Promise<string | null> => {
      // Fence the store repopulation below: a logout racing a 401-retry refresh
      // must not re-seed the store's sessionId for the session that just ended.
      // (The storage-layer persist happens inside coreRefreshSession and is
      // fenced there; this guard covers the store, which is what the UI reads.)
      const epoch = getEpoch();
      try {
        log.info('Refreshing session');

        // Never read back a session for nobody: a stored one may be another
        // user's (faultmaven#1460).
        if (!owner) throw new Error('No signed-in user to ensure a session for');
        const ownerId = owner;

        // Route through session-core's refresh, which is single-flighted across
        // contexts via the Web Locks API and persists the new session_id.
        // Calling createSession() directly here bypassed that mutex, so
        // concurrent callers (this slice's refresh + the 401-retry path in
        // client.ts, or two panels) herded parallel /sessions POSTs; it also
        // duplicated the persistence logic that could drift from session-core.
        await coreRefreshSession(ownerId);

        // Before requiring a stored id: a mint the session outlived persisted
        // nothing, and that is not a failure.
        if (epoch !== getEpoch()) {
          log.info('Session ended during refresh — not repopulating store sessionId');
          return null;
        }

        const stored = (await ownedStorage.get(['sessionId', 'sessionUserId'])) as
          { sessionId?: string; sessionUserId?: string };
        const sessionId = stored.sessionId;
        // The owner's only: without Web Locks, another account's ensure can
        // have stored its session since ours (faultmaven#1460).
        if (!sessionId || stored.sessionUserId !== ownerId) {
          throw new Error("Session refresh did not persist a session_id for the panel's user");
        }

        if (epoch !== getEpoch()) {
          log.info('Session ended during refresh — not repopulating store sessionId');
          return null;
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
      stopHeartbeat();
      owner = null;

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
