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

export class MemoryManager {
  private config: MemoryManagerConfig;

  constructor(config: Partial<MemoryManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Clean up old messages from a conversation while preserving recent context
   *
   * Strategy:
   * - Keep all messages if under maxMessagesPerConversation
   * - If over limit, keep most recent messages
   * - Always preserve at least minMessagesToKeep messages
   * - Never delete optimistic (unsaved) messages
   */
  cleanupConversation(
    messages: OptimisticConversationItem[]
  ): OptimisticConversationItem[] {
    if (messages.length <= this.config.maxMessagesPerConversation) {
      return messages; // No cleanup needed
    }

    console.log('[MemoryManager] Cleaning up conversation', {
      totalMessages: messages.length,
      maxAllowed: this.config.maxMessagesPerConversation
    });

    // Separate optimistic and confirmed messages
    const optimisticMessages = messages.filter(msg => msg.optimistic);
    const confirmedMessages = messages.filter(msg => !msg.optimistic);

    // Calculate how many confirmed messages we can keep
    const confirmedToKeep = Math.max(
      this.config.minMessagesToKeep,
      this.config.maxMessagesPerConversation - optimisticMessages.length
    );

    // Keep most recent confirmed messages
    const recentConfirmed = confirmedMessages.slice(-confirmedToKeep);

    // Combine recent confirmed with all optimistic (never delete unsaved data)
    const cleaned = [...recentConfirmed, ...optimisticMessages];

    // Sort by timestamp to maintain chronological order
    cleaned.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    console.log('[MemoryManager] Cleanup complete', {
      removed: messages.length - cleaned.length,
      kept: cleaned.length,
      optimisticKept: optimisticMessages.length
    });

    return cleaned;
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

    console.log('[MemoryManager] Cleaning up conversations', {
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

    console.log('[MemoryManager] Conversations cleanup complete', {
      removed: caseIds.length - casesToKeep.size,
      kept: casesToKeep.size,
      protected: protectedCases.size
    });

    return cleaned;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(conversations: Record<string, OptimisticConversationItem[]>): {
    totalConversations: number;
    totalMessages: number;
    averageMessagesPerConversation: number;
    largestConversation: { caseId: string; messageCount: number } | null;
  } {
    const caseIds = Object.keys(conversations);
    const totalMessages = caseIds.reduce(
      (sum, id) => sum + (conversations[id]?.length || 0),
      0
    );

    let largestConversation: { caseId: string; messageCount: number } | null = null;
    let maxMessages = 0;

    caseIds.forEach(caseId => {
      const count = conversations[caseId]?.length || 0;
      if (count > maxMessages) {
        maxMessages = count;
        largestConversation = { caseId, messageCount: count };
      }
    });

    return {
      totalConversations: caseIds.length,
      totalMessages,
      averageMessagesPerConversation: caseIds.length > 0 ? totalMessages / caseIds.length : 0,
      largestConversation
    };
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();