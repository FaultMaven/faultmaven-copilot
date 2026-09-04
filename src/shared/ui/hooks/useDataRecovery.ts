/**
 * Data Recovery Hook
 *
 * Manages intelligent persistence loading with automatic backend recovery.
 * Hydrates the centralized Zustand store.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { PersistenceManager } from '../../../lib/utils/persistence-manager';
import { IdMappingState, OptimisticConversationItem, idMappingManager } from '../../../lib/optimistic';
import { getEpoch } from '../../../lib/state/session-epoch';
import { createLogger } from '../../../lib/utils/logger';
import {
  useAppStore,
  PERSISTED_STATE_KEYS,
  CONVERSATION_CACHE_VERSION,
  CONVERSATION_CACHE_VERSION_KEY
} from '../../../lib/state/store';
import { memoryManager } from '../../../lib/utils/memory-manager';
import { useHost } from '../../host';

const log = createLogger('DataRecovery');

interface RecoveredData {
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  conversations: Record<string, any[]>;
  pinnedCases: Set<string>;
  idMappings?: IdMappingState;
}

/**
 * What this hook expects to find in host storage.
 *
 * `HostStore.get` answers `unknown` — a store does not know what its callers
 * persist. Stating the expected shape once here is what keeps the reads below
 * typed without an `any` at each use, and puts the assumption somewhere a
 * reviewer can see it.
 */
interface StoredRecoveryState {
  conversationTitles?: Record<string, string>;
  titleSources?: Record<string, 'user' | 'backend' | 'system'>;
  conversations?: Record<string, OptimisticConversationItem[]>;
  pinnedCases?: string[];
  idMappings?: {
    optimisticToReal?: Record<string, string>;
    realToOptimistic?: Record<string, string>;
  };
  /** Indexed because CONVERSATION_CACHE_VERSION_KEY is not a literal here. */
  [key: string]: unknown;
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
  const { store } = useHost();

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
      // Recovery runs across several awaits; capture the epoch so a logout during
      // recovery fences the active-case restore below (which is otherwise only
      // isAuthenticated-gated — a TOCTOU: the flag can flip after the check).
      const epoch = getEpoch();
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

        log.debug('Loading data from host storage');
        // Read the persisted store-state keys (shared constant, kept in sync with
        // the write side in store.ts) plus idMappings, which is persisted from
        // idMappingManager rather than store state and so is not in that list.
        const stored = (await store.get([
          ...PERSISTED_STATE_KEYS,
          'idMappings',
          CONVERSATION_CACHE_VERSION_KEY
        ])) as StoredRecoveryState;

        // Discard conversations written by a build whose mapper admitted a
        // different set of backend rows. The delta fetch offsets by the local
        // committed count, so a cache that is short by the rows an older build
        // dropped (pre-v2: every `role: "system"` notice) has an offset pointing
        // PAST them — they are unreachable for the life of that cache. Starting
        // the case at offset 0 re-reads the whole list in backend order instead.
        // Cheap and lossless: committed messages all live on the backend, and
        // titles / pins / id-mappings are untouched.
        const cachedVersion = stored[CONVERSATION_CACHE_VERSION_KEY];
        if (stored.conversations && cachedVersion !== CONVERSATION_CACHE_VERSION) {
          log.info('Discarding conversation cache from an older schema', {
            cachedVersion: cachedVersion ?? 'none',
            currentVersion: CONVERSATION_CACHE_VERSION,
            caseCount: Object.keys(stored.conversations).length
          });
          delete stored.conversations;
          await store.remove([
            'conversations',
            CONVERSATION_CACHE_VERSION_KEY
          ]);
        }

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
          pinnedCases: new Set(stored.pinnedCases || []),
          idMappings: undefined
        };

        // Fence the hydrate against a logout that landed during the network
        // recovery / storage reads above: writing the ended session's
        // conversations and id-mappings into the store would repopulate what the
        // logout purge just cleared, and the store subscriber would persist them
        // straight back. Mirrors the active-case restore fence below (#143).
        if (epoch !== getEpoch()) {
          log.info('Session ended during recovery — skipping store hydrate');
          await PersistenceManager.markSyncComplete();
          return;
        }

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
          pinnedCases: recoveredData.pinnedCases
        });

        // Restore the case that was open before the reload. faultmaven_current_case
        // persists the active-case id, but nothing re-selected it on load, so a
        // reload dropped the user onto an empty view even though the case data was
        // already hydrated above. handleCaseSelect rebuilds the activeCase object
        // from the hydrated conversations/titles and delta-fetches its messages.
        try {
          // No authentication check: this hook runs inside CopilotPanel, which
          // cannot be mounted without a session. The gate that used to sit here
          // guarded against a doomed delta-fetch from an unauthenticated panel —
          // a state the host boundary now makes unreachable.
          {
            const { faultmaven_current_case: restoredCaseId } =
              await store.get(['faultmaven_current_case']);
            // Re-check the epoch after the auth/storage awaits: a logout that
            // landed mid-recovery must not let us re-select the ended session's
            // case (handleCaseSelect writes activeCase and delta-fetches).
            if (epoch !== getEpoch()) {
              log.info('Session ended during recovery — skipping active-case restore');
            } else if (restoredCaseId && typeof restoredCaseId === 'string') {
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
    // `store` is a stable module singleton in each host, so this stays a
    // mount-once effect; naming it keeps the dependency honest rather than
    // relying on that stability silently.
  }, [store]);

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
