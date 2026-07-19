/**
 * Memory Manager
 *
 * Handles cleanup of old conversations and completed operations to prevent
 * memory leaks in long-running browser extension sessions.
 *
 * Design Principles:
 * - Preserve active user data (current conversation, recent cases)
 * - Clean up stale completed operations
 * - Limit conversation history to prevent unbounded growth
 * - Never delete data that might be needed for recovery
 */

import { OptimisticConversationItem } from '../optimistic/types';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('MemoryManager');

export interface MemoryManagerConfig {
  /**
   * Maximum number of messages to keep per conversation
   */
  maxMessagesPerConversation: number;

  /**
   * Maximum age of completed operations in milliseconds
   */
  maxCompletedOperationAge: number;

  /**
   * Maximum number of old conversations to keep in memory
   */
  maxOldConversations: number;

  /**
   * Minimum messages to keep even if exceeding limit (safety buffer)
   */
  minMessagesToKeep: number;
}

export const DEFAULT_CONFIG: MemoryManagerConfig = {
  maxMessagesPerConversation: 500, // Keep last 500 messages per conversation
  maxCompletedOperationAge: 24 * 60 * 60 * 1000, // 24 hours
  maxOldConversations: 10, // Keep last 10 conversations beyond active one
  minMessagesToKeep: 50 // Always keep at least 50 messages for context
};

/**
 * A conversation item is "committed" — safe to persist and to rehydrate — only
 * when it is not optimistic, not mid-flight (`loading`), and not in a
 * failed/error state.
 *
 * Transient items must never reach storage: their in-flight request dies with
 * the page, so a rehydrated `loading` item becomes a permanent spinner, and a
 * rehydrated optimistic/failed item duplicates the turn once the real one is
 * delta-fetched from the backend. Backend truth is restored on case open, so
 * dropping these on persist/rehydrate loses nothing recoverable.
 */
export function isCommittedMessage(msg: OptimisticConversationItem): boolean {
  return !msg.optimistic && !msg.loading && !msg.failed && !msg.error;
}

export class MemoryManager {
  private config: MemoryManagerConfig;

  constructor(config: Partial<MemoryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Produce the storage-safe form of the conversation map for persistence:
   *   1. Drop transient (optimistic / loading / failed) messages, and drop any
   *      conversation left empty by that filtering.
   *   2. Cap the message count *within* each conversation to the most-recent
   *      turns (`capConversationToRecentTurns`).
   *   3. Cap the NUMBER of conversations (`cleanupConversations`).
   *
   * This is the single choke point that both prevents unbounded growth in
   * `browser.storage.local` and guarantees a reload never rehydrates a stuck
   * spinner or a to-be-duplicated optimistic turn.
   *
   * Capping a single conversation to a most-recent SUFFIX is now safe because the
   * delta fetch on case open (`cases-slice.handleCaseSelect`) no longer assumes the
   * local copy is the backend PREFIX: it treats the committed-message count as a
   * lower-bound fetch hint and merges the result with a turn-floor + message_id
   * guard, so the trimmed head is dropped rather than re-appended as duplicates.
   * The cap keeps whole turns so that guard's floor turn is fully present locally.
   */
  sanitizeAndCapForPersistence(
    conversations: Record<string, OptimisticConversationItem[]>,
    activeCaseId: string | undefined
  ): Record<string, OptimisticConversationItem[]> {
    // 1. Keep only committed messages; drop conversations that become empty.
    // 2. Cap each surviving conversation to its most-recent turns.
    const committed: Record<string, OptimisticConversationItem[]> = {};
    for (const [caseId, msgs] of Object.entries(conversations)) {
      const kept = this.capConversationToRecentTurns(
        (msgs || []).filter(isCommittedMessage)
      );
      if (kept.length > 0) {
        committed[caseId] = kept;
      }
    }

    // 3. Cap the number of conversations. Dropping a whole old case is offset-safe:
    //    reopening it delta-fetches from offset 0 (empty local) — no duplication.
    //    No optimistic/failed items survive step 1, so only the active case needs
    //    protecting beyond the most-recent set.
    return this.cleanupConversations(committed, activeCaseId, new Set());
  }

  /**
   * Bound a single conversation to (about) the most-recent
   * `maxMessagesPerConversation` messages, trimming from the HEAD so the tail —
   * the part the user is actively reading — is always kept.
   *
   * The cut is snapped FORWARD to a turn boundary: the oldest kept message is the
   * first message of its turn, never a mid-turn agent reply orphaned from its
   * question. This matters for correctness, not just cosmetics — the delta-fetch
   * merge drops re-read messages at or below the retained-turn floor, so if the
   * floor turn were only half-present locally the missing half would be re-fetched
   * and appended out of order. Keeping whole turns means the floor turn is fully
   * present and falls out via id dedup.
   *
   * `turn_number` is expected on committed (backend-sourced) messages; if it is
   * missing we fall back to a plain suffix slice rather than risk an empty result.
   */
  capConversationToRecentTurns(
    messages: OptimisticConversationItem[]
  ): OptimisticConversationItem[] {
    const max = this.config.maxMessagesPerConversation;
    if (messages.length <= max) return messages;

    let cut = messages.length - max;
    // Advance to a turn boundary (drop the rest of a split turn), but never past
    // what would empty the conversation.
    while (
      cut > 0 &&
      cut < messages.length &&
      typeof messages[cut].turn_number === 'number' &&
      messages[cut].turn_number === messages[cut - 1].turn_number
    ) {
      cut++;
    }
    if (cut >= messages.length) {
      // A single turn larger than the cap: fall back to a plain suffix slice.
      cut = messages.length - max;
    }
    return messages.slice(cut);
  }

  /**
   * Clean up old conversations keeping only the most recent ones
   *
   * Strategy:
   * - Keep active conversation (current case)
   * - Keep N most recent conversations
   * - Never delete conversations with optimistic data
   * - Never delete conversations with failed operations
   */
  cleanupConversations(
    conversations: Record<string, OptimisticConversationItem[]>,
    activeCaseId: string | undefined,
    casesWithFailedOps: Set<string>
  ): Record<string, OptimisticConversationItem[]> {
    const caseIds = Object.keys(conversations);

    if (caseIds.length <= this.config.maxOldConversations + 1) {
      return conversations; // No cleanup needed
    }

    log.debug('Cleaning up conversations', {
      total: caseIds.length,
      maxAllowed: this.config.maxOldConversations + 1
    });

    // Cases that must be kept
    const protectedCases = new Set<string>();
    if (activeCaseId) protectedCases.add(activeCaseId);
    casesWithFailedOps.forEach(id => protectedCases.add(id));

    // Find cases with optimistic data (must keep)
    caseIds.forEach(caseId => {
      const hasOptimistic = conversations[caseId]?.some(msg => msg.optimistic);
      if (hasOptimistic) {
        protectedCases.add(caseId);
      }
    });

    // Sort cases by most recent activity (newest first)
    const sortedCases = caseIds.sort((a, b) => {
      const lastMsgA = conversations[a]?.[conversations[a].length - 1];
      const lastMsgB = conversations[b]?.[conversations[b].length - 1];

      const timeA = lastMsgA ? new Date(lastMsgA.timestamp).getTime() : 0;
      const timeB = lastMsgB ? new Date(lastMsgB.timestamp).getTime() : 0;

      return timeB - timeA; // Newest first
    });

    // Keep protected cases + N most recent cases
    const casesToKeep = new Set(protectedCases);
    let keptCount = protectedCases.size;

    for (const caseId of sortedCases) {
      if (casesToKeep.has(caseId)) continue;
      if (keptCount >= this.config.maxOldConversations + 1) break;

      casesToKeep.add(caseId);
      keptCount++;
    }

    // Build cleaned conversations object
    const cleaned: Record<string, OptimisticConversationItem[]> = {};
    casesToKeep.forEach(caseId => {
      cleaned[caseId] = conversations[caseId];
    });

    log.debug('Conversations cleanup complete', {
      removed: caseIds.length - casesToKeep.size,
      kept: casesToKeep.size,
      protected: protectedCases.size
    });

    return cleaned;
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();