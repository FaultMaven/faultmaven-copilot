/**
 * Conversation persistence and recovery.
 *
 * Fetches the case list from the backend and restores titles and conversation
 * slots to host storage, so a client that lost its local copy comes back with
 * its history rather than an empty panel.
 *
 * WHAT LOST IT is not this module's question any more. In the extension the
 * answer is an extension reload — a new `runtime.id`, or a version bump — and
 * detecting that needs APIs a web page does not have. That half lives in
 * `src/extension/extension-reload.ts`, which decides and then calls this.
 */

import { getUserCases, UserCase } from "../api";
import { getHostStore } from '../host-store';
import { OptimisticConversationItem } from "../optimistic";
import { createLogger } from './logger';
import { isPlaceholderCaseTitle } from '../state/case-title';

const log = createLogger('PersistenceManager');

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
  /** Read and written by the host's reload detection too, so it is not private. */
  static readonly RECOVERY_FLAG_KEY = 'faultmaven_recovery_in_progress';
  static readonly VERSION_KEY = 'faultmaven_extension_version';
  static readonly RELOAD_FLAG_KEY = 'faultmaven_reload_detected';
  static readonly SESSION_ID_KEY = 'faultmaven_session_id';
  static readonly LAST_RECOVERY_KEY = 'faultmaven_last_recovery_attempt';

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
      await getHostStore().set({
        [PersistenceManager.RECOVERY_FLAG_KEY]: true,
        [PersistenceManager.LAST_RECOVERY_KEY]: now
      });

      log.info(' 🔄 Starting conversation recovery from backend...');

      // No authentication check. Recovery is reached from a host that already
      // has a session — the panel cannot mount without one — so the gate that
      // used to sit here guarded a state the host boundary makes unreachable,
      // and asking would have meant this module knowing about a credential it
      // does not own.

      // HYBRID STRATEGY: Auto-List / Lazy-Detail
      // Only fetch case metadata (IDs, titles, dates) - NOT conversation details
      // Conversations will be lazy-loaded when user opens a specific case

      log.info(' 📡 Fetching case list (metadata only) from backend...');
      const cases: UserCase[] = await getUserCases({
        limit: 50 // Reasonable default for initial load
      });

      log.info(' ✅ Retrieved case list from backend:', {
        count: cases.length,
        caseIds: cases.map(c => c.case_id)
      });

      if (cases.length === 0) {
        log.info('No cases found - new user or no chat history');
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
      // Updated 2026-01-30: Full UserCase objects now include organization_id, description, closure_reason, closed_at
      // per backend storage fixes (commit b434152a). These fields are automatically included in the
      // getUserCases() response and will be available when UI components access the case data.
      log.info(' 📋 Processing case metadata...');
      for (const userCase of cases) {
        // Extract metadata only
        // Note: userCase now contains organization_id, description, closure_reason, closed_at
        // These fields are preserved in the UserCase objects returned by getUserCases()
        // Recover ONLY a title worth preferring over the backend's own. This
        // loop used to copy every case's backend title into the store — the same
        // seeding removed from the two turn hooks (fm#1069) — which pins a
        // `Case-YYMMDD-N` placeholder ahead of the real title the server writes
        // later, because the store wins in `selectCaseTitle`. It also minted a
        // synthetic `Chat-<date>` for untitled cases, a value no backend ever
        // held. Neither belongs in a map whose job is to remember what the user
        // chose; a case with no store entry renders its backend title, which is
        // both current and correct.
        if (userCase.title && !isPlaceholderCaseTitle(userCase.title)) {
          recoveredTitles[userCase.case_id] = userCase.title;
          recoveredTitleSources[userCase.case_id] = 'backend';
        }

        // Mark conversations as empty (will be lazy-loaded on case open)
        // Empty array signals UI that conversation needs to be fetched
        recoveredConversations[userCase.case_id] = [];

        result.recoveredCases++;
      }

      log.info(' ✅ Recovered case list:', {
        totalCases: cases.length,
        caseIds: cases.map(c => c.case_id)
      });

      // Save recovered data to local storage
      log.info(' 💾 Saving recovered metadata to local storage...');
      await getHostStore().set({
        conversationTitles: recoveredTitles,
        titleSources: recoveredTitleSources,
        conversations: recoveredConversations, // Empty arrays - lazy-loaded on demand
        [PersistenceManager.SYNC_TIMESTAMP_KEY]: Date.now()
      });

      // The runtime identity that makes the NEXT load not look like a reload —
      // the version and the `runtime.id` — is stamped by whoever detected the
      // reload, because whoever detected it is the only one that knows them.

      // Success metrics
      result.success = true;
      result.strategy = 'metadata_only_recovery'; // New strategy: list only, conversations lazy-loaded

      log.info(' ✅ Metadata recovery completed successfully:', {
        recoveredCases: result.recoveredCases,
        strategy: result.strategy
      });

      return result;

    } catch (error) {
      log.error('❌ Conversation recovery failed:', error);
      result.errors.push(`Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.strategy = 'full_recovery'; // Indicate we attempted full recovery
      return result;
    } finally {
      // Clear recovery flag
      await getHostStore().remove([PersistenceManager.RECOVERY_FLAG_KEY]);
    }
  }

  /**
   * Checks if recovery is already in progress
   */
  static async isRecoveryInProgress(): Promise<boolean> {
    try {
      const stored = await getHostStore().get([PersistenceManager.RECOVERY_FLAG_KEY]);
      return !!stored[PersistenceManager.RECOVERY_FLAG_KEY];
    } catch {
      return false;
    }
  }

  /**
   * Updates sync timestamp to mark successful data persistence.
   *
   * The version and runtime id that used to be stamped alongside it are the
   * host's, not this module's, and are written by the host that knows them.
   */
  static async markSyncComplete(): Promise<void> {
    try {
      await getHostStore().set({
        [PersistenceManager.SYNC_TIMESTAMP_KEY]: Date.now()
      });
    } catch (error) {
      log.warn('Failed to mark sync complete:', error);
    }
  }

  /**
   * Forces conversation recovery (for testing/debugging purposes)
   */
  static async forceRecovery(): Promise<RecoveryResult> {
    log.info(' 🔧 Force recovery triggered');
    return await PersistenceManager.recoverConversationsFromBackend();
  }

  /**
   * Clears persistence data (for debugging/reset and logout flows).
   *
   * `preservePinnedCases` keeps the user's pin preferences in storage so they
   * survive a logout/login cycle. Pin entries are case-id keyed; case ids are
   * unique UUIDs scoped to the owning user, so stale entries left behind on a
   * shared browser are no-ops in the UI rather than a privacy leak.
   */
  static async clearAllPersistenceData(
    options: { preservePinnedCases?: boolean } = {}
  ): Promise<void> {
    try {
      const keys: string[] = [
        'conversationTitles',
        'titleSources',
        'conversations',
        'pendingOperations',
        'idMappings',
        'faultmaven_current_case',
        PersistenceManager.SYNC_TIMESTAMP_KEY,
        PersistenceManager.VERSION_KEY,
        PersistenceManager.RECOVERY_FLAG_KEY,
        PersistenceManager.RELOAD_FLAG_KEY,
        PersistenceManager.SESSION_ID_KEY,
        // Clear the recovery cooldown too: after wiping all conversation data a
        // stale "last recovery attempt" timestamp would suppress the NEXT
        // recovery, leaving the following login (logout/login or a different user
        // on a shared profile, #144) with an empty case list until the cooldown
        // lapses.
        PersistenceManager.LAST_RECOVERY_KEY
      ];
      if (!options.preservePinnedCases) keys.push('pinnedCases');
      await getHostStore().remove(keys);
      log.info('Persistence data cleared', { preservePinnedCases: !!options.preservePinnedCases });
    } catch (error) {
      log.warn('Failed to clear persistence data:', error);
    }
  }
}