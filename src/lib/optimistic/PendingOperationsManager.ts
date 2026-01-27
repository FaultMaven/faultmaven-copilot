/**
 * PendingOperationsManager - Manages optimistic operations and their lifecycle
 *
 * Tracks pending operations, handles rollbacks, retries, and cleanup of
 * optimistic updates that fail or are never used.
 */

import { createLogger } from '~/lib/utils/logger';

const log = createLogger('PendingOpsManager');

export interface PendingOperation {
  id: string;
  type: 'create_case' | 'submit_message' | 'submit_query' | 'update_title';
  status: 'pending' | 'completed' | 'failed';
  optimisticData: any;
  rollbackFn: () => void;
  retryFn?: () => Promise<void>;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export class PendingOperationsManager {
  private operations: Map<string, PendingOperation> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private cleanupIntervalMs: number = 300000) { // 5 minutes default
    this.startCleanupTimer();
  }

  /**
   * Add a new pending operation
   */
  add(operation: PendingOperation): void {
    log.debug('Adding operation', { id: operation.id, type: operation.type });
    this.operations.set(operation.id, operation);
  }

  /**
   * Get a specific operation
   */
  get(id: string): PendingOperation | undefined {
    return this.operations.get(id);
  }

  /**
   * Get all operations
   */
  getAll(): Record<string, PendingOperation> {
    const result: Record<string, PendingOperation> = {};
    this.operations.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Mark operation as completed
   */
  complete(id: string): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.status = 'completed';
      operation.completedAt = Date.now();
      log.debug('Operation completed', { id, type: operation.type });
    }
  }

  /**
   * Mark operation as failed and optionally execute rollback
   */
  fail(id: string, error: string, executeRollback: boolean = true): void {
    const operation = this.operations.get(id);
    if (operation) {
      operation.status = 'failed';
      operation.error = error;
      operation.completedAt = Date.now();

      if (executeRollback) {
        log.warn('Rolling back failed operation', { id, error });
        try {
          operation.rollbackFn();
        } catch (rollbackError) {
          log.error('Rollback failed', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
        }
      }
    }
  }

  /**
   * Retry a failed operation
   */
  async retry(id: string): Promise<void> {
    const operation = this.operations.get(id);
    if (operation && operation.retryFn) {
      operation.status = 'pending';
      operation.error = undefined;
      log.info('Retrying operation', { id, type: operation.type });

      try {
        await operation.retryFn();
        this.complete(id);
      } catch (error) {
        this.fail(id, error instanceof Error ? error.message : 'Retry failed');
      }
    }
  }

  /**
   * Remove an operation from tracking
   */
  remove(id: string): void {
    if (this.operations.delete(id)) {
      log.debug('Operation removed', { id });
    }
  }

  /**
   * Get operations by type
   */
  getByType(type: PendingOperation['type']): PendingOperation[] {
    return Array.from(this.operations.values()).filter(op => op.type === type);
  }

  /**
   * Get operations by status
   */
  getByStatus(status: PendingOperation['status']): PendingOperation[] {
    return Array.from(this.operations.values()).filter(op => op.status === status);
  }

  /**
   * Clean up old completed/failed operations
   */
  cleanup(maxAgeMs: number = 600000): void { // 10 minutes default
    const now = Date.now();
    const toRemove: string[] = [];

    this.operations.forEach((operation, id) => {
      const age = now - operation.createdAt;
      const isOld = age > maxAgeMs;
      const isFinished = operation.status === 'completed' || operation.status === 'failed';

      if (isOld && isFinished) {
        toRemove.push(id);
      }
    });

    toRemove.forEach(id => this.remove(id));

    if (toRemove.length > 0) {
      log.info('Cleaned up old operations', { count: toRemove.length });
    }
  }

  /**
   * Clean up unused optimistic cases (no messages submitted)
   * This addresses the issue of empty chats persisting
   */
  cleanupUnusedCases(getConversations: () => Record<string, any[]>, maxAgeMs: number = 300000): void {
    const now = Date.now();
    const conversations = getConversations();

    this.getByType('create_case').forEach(operation => {
      if (operation.status === 'completed') {
        const caseId = operation.optimisticData?.case_id;
        const age = now - operation.createdAt;

        if (caseId && age > maxAgeMs) {
          const messages = conversations[caseId] || [];

          // If case has no user messages (only system messages or empty), consider it unused
          const hasUserMessages = messages.some(msg =>
            msg.role === 'user' || msg.user_input?.trim()
          );

          if (!hasUserMessages) {
            log.info('Cleaning up unused case', { caseId, ageMs: age });
            // Execute rollback to remove unused case
            operation.rollbackFn();
            this.remove(operation.id);
          }
        }
      }
    });
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    oldestPending?: number;
  } {
    const operations = Array.from(this.operations.values());
    const now = Date.now();

    const stats = {
      total: operations.length,
      pending: operations.filter(op => op.status === 'pending').length,
      completed: operations.filter(op => op.status === 'completed').length,
      failed: operations.filter(op => op.status === 'failed').length,
      oldestPending: undefined as number | undefined
    };

    const pendingOps = operations.filter(op => op.status === 'pending');
    if (pendingOps.length > 0) {
      const oldest = Math.min(...pendingOps.map(op => op.createdAt));
      stats.oldestPending = now - oldest;
    }

    return stats;
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  /**
   * Update operations (for backward compatibility with state-based approach)
   */
  updateOperations(operations: Record<string, PendingOperation>): void {
    this.operations.clear();
    Object.entries(operations).forEach(([id, operation]) => {
      this.operations.set(id, operation);
    });
  }

  /**
   * Stop automatic cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}