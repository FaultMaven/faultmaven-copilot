/**
 * Persistence Manager for FaultMaven Copilot Extension
 *
 * Handles intelligent conversation recovery across extension reloads by:
 * 1. Detecting when extension storage is empty (reload scenario)
 * 2. Fetching conversation data from backend APIs
 * 3. Restoring conversations, titles, and state to match backend data
 * 4. Maintaining optimistic UI state during recovery
 */

import { browser } from "wxt/browser";
import { getUserCases, getCaseConversation, authManager, UserCase } from "../api";
import { OptimisticConversationItem } from "../optimistic";

// Backend API message format (from /api/v1/cases/{case_id}/messages)
interface BackendMessage {
  id?: string;
  message_id?: string;
  role: 'user' | 'agent' | 'assistant';
  content: string;
  created_at: string;
}

// Enhanced API response format
interface EnhancedCaseMessagesResponse {
  messages: BackendMessage[];
  total_count: number;
  retrieved_count: number;
  has_more: boolean;
  next_offset?: number;
  debug_info?: {
    redis_key?: string;
    redis_operation_time_ms?: number;
    storage_errors?: string[];
    message_parsing_errors?: number;
  };
}

export interface PersistenceState {
  conversationTitles: Record<string, string>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;
  conversations: Record<string, OptimisticConversationItem[]>;
  lastSyncTimestamp: number;
  extensionVersion: string;
}

export interface RecoveryResult {
  success: boolean;
  recoveredCases: number;
  recoveredConversations: number;
  errors: string[];
  strategy: 'full_recovery' | 'partial_recovery' | 'metadata_only_recovery' | 'no_recovery_needed';
}

/**
 * Manages conversation persistence and recovery across extension lifecycle
 */
export class PersistenceManager {
  private static readonly SYNC_TIMESTAMP_KEY = 'faultmaven_last_sync';
  private static readonly RECOVERY_FLAG_KEY = 'faultmaven_recovery_in_progress';
  private static readonly VERSION_KEY = 'faultmaven_extension_version';
  private static readonly RELOAD_FLAG_KEY = 'faultmaven_reload_detected';
  private static readonly SESSION_ID_KEY = 'faultmaven_session_id';
  private static readonly LAST_RECOVERY_KEY = 'faultmaven_last_recovery_attempt';

  // Extension version for detecting updates/reloads
  private static readonly CURRENT_VERSION = browser.runtime.getManifest?.()?.version || '1.0.0';

  // Minimum time between recovery attempts (5 minutes)
  private static readonly RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

  /**
   * Deterministic reload detection using reliable signals only:
   * 1. Explicit reload flag set during extension lifecycle events
   * 2. Extension version mismatch (update scenario)
   * 3. Session ID mismatch (runtime context changed)
   *
   * NOTE: Heuristic checks (structural inconsistency) removed - cannot distinguish
   * "currently loading" from "lost data", causing false positives on login flow.
   */
  static async detectExtensionReload(): Promise<boolean> {
    try {
      const isAuthenticated = await authManager.isAuthenticated();

      if (!isAuthenticated) {
        return false;
      }

      const stored = await browser.storage.local.get([
        'conversationTitles',
        'conversations',
        PersistenceManager.VERSION_KEY,
        PersistenceManager.RELOAD_FLAG_KEY,
        PersistenceManager.SESSION_ID_KEY,
        PersistenceManager.LAST_RECOVERY_KEY
      ]);

      // Check recovery cooldown - prevent excessive recovery attempts
      const lastRecovery = stored[PersistenceManager.LAST_RECOVERY_KEY];
      if (lastRecovery) {
        const timeSinceLastRecovery = Date.now() - lastRecovery;
        if (timeSinceLastRecovery < PersistenceManager.RECOVERY_COOLDOWN_MS) {
          console.log('[PersistenceManager] Recovery cooldown active:', {
            timeSinceLastRecovery: `${Math.round(timeSinceLastRecovery / 1000)}s`,
            cooldownRemaining: `${Math.round((PersistenceManager.RECOVERY_COOLDOWN_MS - timeSinceLastRecovery) / 1000)}s`
          });
          return false; // Skip recovery if cooldown is active
        }
      }

      // DETERMINISTIC SIGNALS ONLY (Reliable)
      // Method 1: Explicit reload flag (most reliable)
      const hasReloadFlag = !!stored[PersistenceManager.RELOAD_FLAG_KEY];

      // Method 2: Version mismatch (extension update)
      const versionMismatch = stored[PersistenceManager.VERSION_KEY] !== PersistenceManager.CURRENT_VERSION;

      // Method 3: Session ID mismatch (runtime context changed)
      const currentSessionId = browser.runtime.id;
      const sessionMismatch = stored[PersistenceManager.SESSION_ID_KEY] &&
                             stored[PersistenceManager.SESSION_ID_KEY] !== currentSessionId;

      // REMOVED: Method 4 "Structural inconsistency" - UNRELIABLE & DANGEROUS
      // Why removed: Cannot distinguish "currently loading" from "lost data"
      // This heuristic caused the retry storm by triggering on normal login flow

      // Recovery needed if ANY DETERMINISTIC indicator is true
      const shouldRecover = hasReloadFlag || versionMismatch || sessionMismatch;

      console.log('[PersistenceManager] Reload detection:', {
        isAuthenticated,
        shouldRecover,
        indicators: {
          reloadFlag: hasReloadFlag,
          versionMismatch,
          sessionMismatch
        },
        state: {
          titleCount: stored.conversationTitles ? Object.keys(stored.conversationTitles).length : 0,
          conversationCount: stored.conversations ? Object.keys(stored.conversations).length : 0,
          version: stored[PersistenceManager.VERSION_KEY],
          currentVersion: PersistenceManager.CURRENT_VERSION,
          sessionId: stored[PersistenceManager.SESSION_ID_KEY],
          currentSessionId
        },
        reason: shouldRecover ? (
          hasReloadFlag ? 'explicit_reload_flag' :
          versionMismatch ? 'version_mismatch' :
          'session_id_mismatch'
        ) : 'no_recovery_needed'
      });

      return shouldRecover;

    } catch (error) {
      console.warn('[PersistenceManager] Detection error - defaulting to safe recovery:', error);
      return true;
    }
  }

  /**
   * Sets reload flag (called during extension lifecycle events)
   * Should be called from background script or service worker on install/update
   */
  static async markReloadDetected(): Promise<void> {
    try {
      await browser.storage.local.set({
        [PersistenceManager.RELOAD_FLAG_KEY]: true,
        [PersistenceManager.SESSION_ID_KEY]: browser.runtime.id
      });
      console.log('[PersistenceManager] Reload flag set');
    } catch (error) {
      console.warn('[PersistenceManager] Failed to set reload flag:', error);
    }
  }

  /**
   * Clears reload flag after successful recovery
   */
  static async clearReloadFlag(): Promise<void> {
    try {
      await browser.storage.local.remove([PersistenceManager.RELOAD_FLAG_KEY]);
      console.log('[PersistenceManager] Reload flag cleared');
    } catch (error) {
      console.warn('[PersistenceManager] Failed to clear reload flag:', error);
    }
  }

  /**
   * Recovers conversations from backend API and restores local state
   */
  static async recoverConversationsFromBackend(): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      success: false,
      recoveredCases: 0,
      recoveredConversations: 0,
      errors: [],
      strategy: 'no_recovery_needed'
    };

    try {
      // Set recovery flag and timestamp to prevent concurrent recovery attempts
      const now = Date.now();
      await browser.storage.local.set({
        [PersistenceManager.RECOVERY_FLAG_KEY]: true,
        [PersistenceManager.LAST_RECOVERY_KEY]: now
      });

      console.log('[PersistenceManager] 🔄 Starting conversation recovery from backend...');

      // Check authentication
      const isAuthenticated = await authManager.isAuthenticated();
      if (!isAuthenticated) {
        result.errors.push('User not authenticated - cannot recover conversations');
        return result;
      }

      // HYBRID STRATEGY: Auto-List / Lazy-Detail
      // Only fetch case metadata (IDs, titles, dates) - NOT conversation details
      // Conversations will be lazy-loaded when user opens a specific case

      console.log('[PersistenceManager] 📡 Fetching case list (metadata only) from backend...');
      const cases: UserCase[] = await getUserCases({
        limit: 50 // Reasonable default for initial load
      });

      console.log('[PersistenceManager] ✅ Retrieved case list from backend:', {
        count: cases.length,
        caseIds: cases.map(c => c.case_id)
      });

      if (cases.length === 0) {
        console.log('[PersistenceManager] No cases found - new user or no chat history');
        result.strategy = 'no_recovery_needed';
        result.success = true;
        return result;
      }

      // Prepare recovery data structures
      const recoveredTitles: Record<string, string> = {};
      const recoveredTitleSources: Record<string, 'user' | 'backend' | 'system'> = {};

      // NO conversation fetching - conversations are empty/null until lazy-loaded
      const recoveredConversations: Record<string, OptimisticConversationItem[]> = {};

      // Process case metadata only (no conversation fetching)
      console.log('[PersistenceManager] 📋 Processing case metadata...');
      for (const userCase of cases) {
        // Extract metadata only
        recoveredTitles[userCase.case_id] = userCase.title || `Chat-${new Date(userCase.created_at || Date.now()).toLocaleString()}`;
        recoveredTitleSources[userCase.case_id] = 'backend';

        // Mark conversations as empty (will be lazy-loaded on case open)
        // Empty array signals UI that conversation needs to be fetched
        recoveredConversations[userCase.case_id] = [];

        result.recoveredCases++;
      }

      console.log('[PersistenceManager] ✅ Recovered case list:', {
        totalCases: cases.length,
        caseIds: cases.map(c => c.case_id)
      });

      // Save recovered data to local storage
      console.log('[PersistenceManager] 💾 Saving recovered metadata to local storage...');
      await browser.storage.local.set({
        conversationTitles: recoveredTitles,
        titleSources: recoveredTitleSources,
        conversations: recoveredConversations, // Empty arrays - lazy-loaded on demand
        [PersistenceManager.SYNC_TIMESTAMP_KEY]: Date.now(),
        [PersistenceManager.VERSION_KEY]: PersistenceManager.CURRENT_VERSION,
        [PersistenceManager.SESSION_ID_KEY]: browser.runtime.id
      });

      // Clear reload flag after successful recovery
      await PersistenceManager.clearReloadFlag();

      // Success metrics
      result.success = true;
      result.strategy = 'metadata_only_recovery'; // New strategy: list only, conversations lazy-loaded

      console.log('[PersistenceManager] ✅ Metadata recovery completed successfully:', {
        recoveredCases: result.recoveredCases,
        strategy: result.strategy
      });

      return result;

    } catch (error) {
      console.error('[PersistenceManager] ❌ Conversation recovery failed:', error);
      result.errors.push(`Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.strategy = 'full_recovery'; // Indicate we attempted full recovery
      return result;
    } finally {
      // Clear recovery flag
      await browser.storage.local.remove([PersistenceManager.RECOVERY_FLAG_KEY]);
    }
  }

  /**
   * Checks if recovery is already in progress
   */
  static async isRecoveryInProgress(): Promise<boolean> {
    try {
      const stored = await browser.storage.local.get([PersistenceManager.RECOVERY_FLAG_KEY]);
      return !!stored[PersistenceManager.RECOVERY_FLAG_KEY];
    } catch {
      return false;
    }
  }

  /**
   * Updates sync timestamp to mark successful data persistence
   */
  static async markSyncComplete(): Promise<void> {
    try {
      await browser.storage.local.set({
        [PersistenceManager.SYNC_TIMESTAMP_KEY]: Date.now(),
        [PersistenceManager.VERSION_KEY]: PersistenceManager.CURRENT_VERSION,
        [PersistenceManager.SESSION_ID_KEY]: browser.runtime.id
      });
    } catch (error) {
      console.warn('[PersistenceManager] Failed to mark sync complete:', error);
    }
  }

  /**
   * Gets current persistence state from storage
   */
  static async getCurrentState(): Promise<Partial<PersistenceState>> {
    try {
      const stored = await browser.storage.local.get([
        'conversationTitles',
        'titleSources',
        'conversations',
        PersistenceManager.SYNC_TIMESTAMP_KEY,
        PersistenceManager.VERSION_KEY
      ]);

      return {
        conversationTitles: stored.conversationTitles || {},
        titleSources: stored.titleSources || {},
        conversations: stored.conversations || {},
        lastSyncTimestamp: stored[PersistenceManager.SYNC_TIMESTAMP_KEY] || 0,
        extensionVersion: stored[PersistenceManager.VERSION_KEY] || 'unknown'
      };
    } catch (error) {
      console.warn('[PersistenceManager] Failed to get current state:', error);
      return {};
    }
  }

  /**
   * Forces conversation recovery (for testing/debugging purposes)
   */
  static async forceRecovery(): Promise<RecoveryResult> {
    console.log('[PersistenceManager] 🔧 Force recovery triggered');
    return await PersistenceManager.recoverConversationsFromBackend();
  }

  /**
   * Test enhanced API with detailed debugging (for troubleshooting)
   */
  static async testEnhancedAPI(caseId?: string): Promise<void> {
    console.log('[PersistenceManager] 🧪 Testing enhanced API with debugging...');

    try {
      if (!await authManager.isAuthenticated()) {
        console.error('[PersistenceManager] Not authenticated - cannot test API');
        return;
      }

      // If no specific case ID provided, get the first case
      if (!caseId) {
        console.log('[PersistenceManager] Fetching user cases...');
        const cases = await getUserCases();
        if (!cases || cases.length === 0) {
          console.warn('[PersistenceManager] No cases found for testing');
          return;
        }
        caseId = cases[0].case_id;
        console.log('[PersistenceManager] Using first case for testing:', caseId);
      }

      // Test the enhanced API with debug enabled
      console.log('[PersistenceManager] 🔍 Testing enhanced /messages API...');
      const response = await getCaseConversation(caseId, true);

      console.log('[PersistenceManager] 📊 Enhanced API Test Results:', {
        caseId,
        totalCount: response.total_count,
        retrievedCount: response.retrieved_count,
        hasMore: response.has_more,
        messagesArray: response.messages?.length || 0,
        debugInfo: response.debug_info,
        timestamp: new Date().toISOString()
      });

      // Analyze the results
      if (response.total_count > 0 && response.retrieved_count === 0) {
        console.error('[PersistenceManager] 🚨 ISSUE DETECTED: Messages exist but none retrieved');
        console.error('[PersistenceManager] Debug details:', response.debug_info);
      } else if (response.total_count === response.retrieved_count && response.messages?.length > 0) {
        console.log('[PersistenceManager] ✅ API working correctly - all messages retrieved');
      } else if (response.total_count === 0) {
        console.log('[PersistenceManager] ℹ️ Case is empty (no messages)');
      } else {
        console.warn('[PersistenceManager] ⚠️ Partial retrieval:', {
          total: response.total_count,
          retrieved: response.retrieved_count
        });
      }

    } catch (error) {
      console.error('[PersistenceManager] ❌ Enhanced API test failed:', error);
    }
  }


  /**
   * Clears all persistence data (for debugging/reset purposes)
   */
  static async clearAllPersistenceData(): Promise<void> {
    try {
      await browser.storage.local.remove([
        'conversationTitles',
        'titleSources',
        'conversations',
        'pendingOperations',
        'idMappings',
        PersistenceManager.SYNC_TIMESTAMP_KEY,
        PersistenceManager.VERSION_KEY,
        PersistenceManager.RECOVERY_FLAG_KEY,
        PersistenceManager.RELOAD_FLAG_KEY,
        PersistenceManager.SESSION_ID_KEY
      ]);
      console.log('[PersistenceManager] All persistence data cleared');
    } catch (error) {
      console.warn('[PersistenceManager] Failed to clear persistence data:', error);
    }
  }
}