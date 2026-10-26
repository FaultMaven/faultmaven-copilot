/**
 * Session Management Hook
 *
 * Handles session lifecycle, heartbeat, and validation using the Zustand store.
 */

import { useEffect } from 'react';
import { useAppStore } from '../../../lib/state/store';

/** `ownerId`: the signed-in user, the only one this panel's session may belong to. */
export function useSessionManagement(shouldInitialize: boolean, ownerId: string) {
  const sessionId = useAppStore((state) => state.sessionId);
  const isSessionInitialized = useAppStore((state) => state.isSessionInitialized);
  const sessionError = useAppStore((state) => state.sessionError);

  const initializeSession = useAppStore((state) => state.initializeSession);
  const refreshSession = useAppStore((state) => state.refreshSession);
  const clearSession = useAppStore((state) => state.clearSession);
  const stopSessionTimers = useAppStore((state) => state.stopSessionTimers);

  useEffect(() => {
    initializeSession(shouldInitialize, ownerId);
    // The heartbeat and the ensure retries go with the panel: nothing mints or
    // beats for a panel that is no longer mounted (faultmaven#1460).
    return () => stopSessionTimers();
  }, [shouldInitialize, ownerId, initializeSession, stopSessionTimers]);

  return {
    sessionId,
    isSessionInitialized,
    sessionError,
    refreshSession,
    clearSession
  };
}
