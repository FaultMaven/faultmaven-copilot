/**
 * Session Management Hook
 *
 * Handles session lifecycle, heartbeat, and validation.
 * Extracted from SidePanelApp to reduce component complexity.
 */

import { useState, useEffect, useCallback } from 'react';
import { browser } from 'wxt/browser';
import { createSession } from '../../../lib/api';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('SessionManagement');

interface SessionState {
  sessionId: string | null;
  isInitialized: boolean;
  error: string | null;
}

export function useSessionManagement(shouldInitialize: boolean = true) {
  const [sessionState, setSessionState] = useState<SessionState>({
    sessionId: null,
    isInitialized: false,
    error: null
  });

  // Initialize session on mount (only if shouldInitialize is true)
  useEffect(() => {
    // Skip initialization if not ready (e.g., first-run not completed)
    if (!shouldInitialize) {
      log.debug('Session initialization skipped - waiting for first-run completion');
      return;
    }
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const initializeSession = async () => {
      try {
        // Validate browser environment
        if (typeof browser === 'undefined' || !browser.storage) {
          throw new Error('Browser storage not available');
        }

        // Get session from storage
        const result = await browser.storage.local.get(['sessionId']);

        if (result.sessionId) {
          log.debug('Using existing session', { sessionId: result.sessionId });
          setSessionState({
            sessionId: result.sessionId,
            isInitialized: true,
            error: null
          });
        } else {
          // Create new session
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

          setSessionState({
            sessionId: session.session_id,
            isInitialized: true,
            error: null
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
        setSessionState({
          sessionId: null,
          isInitialized: false,
          error: errorMessage
        });
      }
    };

    initializeSession();

    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    };
  }, [shouldInitialize]);

  const refreshSession = useCallback(async (): Promise<string> => {
    try {
      log.info('Refreshing session');
      const session = await createSession();

      await browser.storage.local.set({
        sessionId: session.session_id,
        sessionCreatedAt: Date.now(),
        sessionResumed: session.session_resumed || false,
        clientId: session.client_id
      });

      setSessionState({
        sessionId: session.session_id,
        isInitialized: true,
        error: null
      });

      return session.session_id;
    } catch (error) {
      log.error('Session refresh failed', error);
      throw error;
    }
  }, []);

  const clearSession = useCallback(async () => {
    try {
      await browser.storage.local.remove(['sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId']);
      setSessionState({
        sessionId: null,
        isInitialized: false,
        error: null
      });
      log.info('Session cleared');
    } catch (error) {
      log.error('Failed to clear session', error);
    }
  }, []);

  return {
    sessionId: sessionState.sessionId,
    isSessionInitialized: sessionState.isInitialized,
    sessionError: sessionState.error,
    refreshSession,
    clearSession
  };
}
