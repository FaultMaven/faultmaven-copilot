/**
 * Data Recovery Hook
 *
 * Manages intelligent persistence loading with automatic backend recovery.
 * Handles extension reload detection and conversation restoration.
 * Extracted from SidePanelApp to reduce component complexity.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { browser } from 'wxt/browser';
import { PersistenceManager } from '../../../lib/utils/persistence-manager';
import { pendingOpsManager, IdMappingState, idMappingManager } from '../../../lib/optimistic';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('DataRecovery');

interface RecoveredData {
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  conversations: Record<string, any[]>;
  pendingOperations: Record<string, any>;
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
  onDataRecovered: (data: RecoveredData) => void,
  onError: (message: string) => void
) {
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>({
    isRecovering: false,
    error: null,
    recoveredCases: 0
  });

  // Store stable references to callbacks to prevent useEffect from re-running
  const onDataRecoveredRef = useRef(onDataRecovered);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change (without triggering useEffect)
  useEffect(() => {
    onDataRecoveredRef.current = onDataRecovered;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const loadPersistedDataWithRecovery = async () => {
      try {
        log.info('Starting intelligent persistence loading');

        // Step 1: Check if recovery is already in progress
        const recoveryInProgress = await PersistenceManager.isRecoveryInProgress();
        if (recoveryInProgress) {
          log.info('Recovery already in progress, waiting');
          return;
        }

        // Step 2: Detect if extension was reloaded
        const reloadDetected = await PersistenceManager.detectExtensionReload();
        log.info('Reload detection result', { reloadDetected });

        if (reloadDetected) {
          // Extension was reloaded - attempt recovery from backend
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

            if (recoveryResult.errors.length > 0) {
              onErrorRef.current(`Failed to recover conversations: ${recoveryResult.errors[0]}`);
            }
          }
        }

        // Step 3: Load data from storage (either original or recovered)
        log.debug('Loading data from browser storage');
        const stored = await browser.storage.local.get([
          'conversationTitles',
          'titleSources',
          'conversations',
          'pendingOperations',
          'optimisticCases',
          'idMappings',
          'pinnedCases'
        ]);

        log.debug('Retrieved from storage', {
          titleCount: stored.conversationTitles ? Object.keys(stored.conversationTitles).length : 0,
          conversationCount: stored.conversations ? Object.keys(stored.conversations).length : 0,
          hasPendingOps: !!stored.pendingOperations,
          hasIdMappings: !!stored.idMappings
        });

        // Prepare recovered data
        const recoveredData: RecoveredData = {
          conversationTitles: stored.conversationTitles || {},
          titleSources: stored.titleSources || {},
          conversations: stored.conversations || {},
          pendingOperations: stored.pendingOperations || {},
          optimisticCases: stored.optimisticCases || [],
          pinnedCases: new Set(stored.pinnedCases || []),
          idMappings: undefined
        };

        // Load ID mappings
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

        // Update pending operations manager
        if (stored.pendingOperations) {
          pendingOpsManager.updateOperations(stored.pendingOperations);
          log.debug('Pending operations loaded', {
            count: Object.keys(stored.pendingOperations).length
          });
        }

        // Notify parent component
        onDataRecoveredRef.current(recoveredData);

        // Mark persistence loading complete
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
        onErrorRef.current(errorMessage);
      }
    };

    loadPersistedDataWithRecovery();
  }, []); // Empty dependency array - run only once on mount

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
