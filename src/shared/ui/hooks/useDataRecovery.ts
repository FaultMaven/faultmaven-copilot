/**
 * Data Recovery Hook
 *
 * Manages intelligent persistence loading with automatic backend recovery.
 * Hydrates the centralized Zustand store.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { browser } from 'wxt/browser';
import { PersistenceManager } from '../../../lib/utils/persistence-manager';
import { authManager } from '../../../lib/api';
import { IdMappingState, idMappingManager } from '../../../lib/optimistic';
import { createLogger } from '../../../lib/utils/logger';
import { useAppStore } from '../../../lib/state/store';
import { memoryManager } from '../../../lib/utils/memory-manager';

const log = createLogger('DataRecovery');

interface RecoveredData {
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  conversations: Record<string, any[]>;
  optimisticCases: any[];
  pinnedCases: Set<string>;
  idMappings?: IdMappingState;
}

interface RecoveryStatus {
  isRecovering: boolean;
  error: string | null;
  recoveredCases: number;
}

export function useDataRecovery(
  onDataRecovered?: (data: RecoveredData) => void,
  onError?: (message: string) => void
) {
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>({
    isRecovering: false,
    error: null,
    recoveredCases: 0
  });

  const onDataRecoveredRef = useRef(onDataRecovered);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDataRecoveredRef.current = onDataRecovered;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const loadPersistedDataWithRecovery = async () => {
      try {
        log.info('Starting intelligent persistence loading');

        const recoveryInProgress = await PersistenceManager.isRecoveryInProgress();
        if (recoveryInProgress) {
          log.info('Recovery already in progress, waiting');
          return;
        }

        const reloadDetected = await PersistenceManager.detectExtensionReload();
        log.info('Reload detection result', { reloadDetected });

        if (reloadDetected) {
          log.info('Extension reload detected - starting conversation recovery');
          setRecoveryStatus(prev => ({ ...prev, isRecovering: true }));

          const recoveryResult = await PersistenceManager.recoverConversationsFromBackend();

          if (recoveryResult.success) {
            log.info('Conversation recovery successful', {
              cases: recoveryResult.recoveredCases,
              conversations: recoveryResult.recoveredConversations
            });

            setRecoveryStatus({
              isRecovering: false,
              error: null,
              recoveredCases: recoveryResult.recoveredCases
            });

            if (recoveryResult.recoveredCases > 0) {
              log.info(`Recovered ${recoveryResult.recoveredCases} chats with ${recoveryResult.recoveredConversations} messages`);
            }
          } else {
            log.warn('Conversation recovery failed', { errors: recoveryResult.errors });
            setRecoveryStatus({
              isRecovering: false,
              error: recoveryResult.errors[0] || 'Recovery failed',
              recoveredCases: 0
            });

            if (recoveryResult.errors.length > 0 && onErrorRef.current) {
              onErrorRef.current(`Failed to recover conversations: ${recoveryResult.errors[0]}`);
            }
          }
        }

        log.debug('Loading data from browser storage');
        const stored = await browser.storage.local.get([
          'conversationTitles',
          'titleSources',
          'conversations',
          'optimisticCases',
          'idMappings',
          'pinnedCases'
        ]);

        log.debug('Retrieved from storage', {
          titleCount: stored.conversationTitles ? Object.keys(stored.conversationTitles).length : 0,
          conversationCount: stored.conversations ? Object.keys(stored.conversations).length : 0,
          hasIdMappings: !!stored.idMappings
        });

        const recoveredData: RecoveredData = {
          conversationTitles: stored.conversationTitles || {},
          titleSources: stored.titleSources || {},
          // Defensive re-sanitize: storage written before this fix (or by an
          // interrupted flush) may still hold transient optimistic/loading items.
          // Drop them here too so a reload can't rehydrate a stuck spinner.
          conversations: memoryManager.sanitizeAndCapForPersistence(stored.conversations || {}, undefined),
          optimisticCases: stored.optimisticCases || [],
          pinnedCases: new Set(stored.pinnedCases || []),
          idMappings: undefined
        };

        if (stored.idMappings) {
          const mappings = stored.idMappings;
          if (mappings.optimisticToReal && mappings.realToOptimistic) {
            recoveredData.idMappings = {
              optimisticToReal: new Map(Object.entries(mappings.optimisticToReal)),
              realToOptimistic: new Map(Object.entries(mappings.realToOptimistic))
            };
            idMappingManager.setState(recoveredData.idMappings);
            log.debug('ID mappings loaded');
          }
        }

        // pendingOperations is intentionally not rehydrated: its retry/rollback
        // closures cannot survive serialization (see store.ts), so pendingOpsManager
        // starts each session empty and in-flight/failed turns are reconciled from
        // the backend on case open.

        // Hydrate the Zustand store
        useAppStore.setState({
          conversationTitles: recoveredData.conversationTitles,
          titleSources: recoveredData.titleSources,
          conversations: recoveredData.conversations,
          optimisticCases: recoveredData.optimisticCases,
          pinnedCases: recoveredData.pinnedCases
        });

        // Restore the case that was open before the reload. faultmaven_current_case
        // persists the active-case id, but nothing re-selected it on load — it was
        // only lazily restored by ensureCaseExists on the NEXT user action. So a
        // reload dropped the user onto an empty view even though the case data was
        // already hydrated above. handleCaseSelect rebuilds the activeCase object
        // from the hydrated conversations/titles and delta-fetches its messages.
        try {
          // Only restore when authenticated. handleCaseSelect delta-fetches the
          // conversation, so restoring for an unauthenticated panel (a leftover
          // pointer after an auto-logout path that didn't run handleLogout) would
          // fire a doomed request → 401 → handleAuthError storage writes + noise.
          if (await authManager.isAuthenticated()) {
            const { faultmaven_current_case: restoredCaseId } =
              await browser.storage.local.get(['faultmaven_current_case']);
            if (restoredCaseId && typeof restoredCaseId === 'string') {
              useAppStore.getState().handleCaseSelect(restoredCaseId);
              log.info('Restored active case after reload', { caseId: restoredCaseId });
            }
          }
        } catch (e) {
          log.warn('Failed to restore active case after reload', e);
        }

        if (onDataRecoveredRef.current) {
          onDataRecoveredRef.current(recoveredData);
        }

        await PersistenceManager.markSyncComplete();
        log.info('Persistence loading completed successfully');

      } catch (error) {
        log.error('Persistence loading failed', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to load persisted data';
        setRecoveryStatus({
          isRecovering: false,
          error: errorMessage,
          recoveredCases: 0
        });
        if (onErrorRef.current) {
          onErrorRef.current(errorMessage);
        }
      }
    };

    loadPersistedDataWithRecovery();
  }, []);

  const forceRecovery = useCallback(async () => {
    try {
      log.info('Force recovery triggered');
      setRecoveryStatus(prev => ({ ...prev, isRecovering: true }));

      const result = await PersistenceManager.forceRecovery();

      setRecoveryStatus({
        isRecovering: false,
        error: result.success ? null : result.errors[0] || 'Recovery failed',
        recoveredCases: result.recoveredCases
      });

      return result;
    } catch (error) {
      log.error('Force recovery failed', error);
      setRecoveryStatus({
        isRecovering: false,
        error: error instanceof Error ? error.message : 'Recovery failed',
        recoveredCases: 0
      });
      throw error;
    }
  }, []);

  return {
    isRecovering: recoveryStatus.isRecovering,
    recoveryError: recoveryStatus.error,
    recoveredCases: recoveryStatus.recoveredCases,
    forceRecovery
  };
}
