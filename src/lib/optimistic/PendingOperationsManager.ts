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
    // Elastic: timer starts on first add(), not in constructor
  }

  /**
   * Add a new pending operation
   */
  add(operation: PendingOperation): void {
    const wasEmpty = this.operations.size === 0;
    log.debug('Adding operation', { id: operation.id, type: operation.type });
    this.operations.set(operation.id, operation);
    if (wasEmpty) {
      this.startCleanupTimer();
    }
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
        // The retry function (a re-submission) self-manages this op's status —
        // it calls complete() on success and fail() on failure. Only mark it
        // completed if it is STILL pending; otherwise a re-run that already failed
        // would be wrongly flipped to completed (losing the failed state + retry
        // affordance), because the re-run swallows its own error so retryFn resolves.
        if (this.operations.get(id)?.status === 'pending') {
          this.complete(id);
        }
      } catch (error) {
        // Don't roll back on a retry failure — the re-submission's own failure
        // handler already updated the UI; a rollback would delete the messages.
        this.fail(id, error instanceof Error ? error.message : 'Retry failed', false);
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

    // Elastic: stop timer when no operations remain
    if (this.operations.size === 0) {
      this.stopCleanupTimer();
    }
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
   * Stop the cleanup timer (elastic: called when operations map becomes empty)
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clear all tracked operations and stop the cleanup timer.
   *
   * Used on logout: this manager is a module singleton that outlives a session
   * (the side panel is not reloaded on logout), so without this the previous
   * user's pending optimistic operations would leak into the next session.
   */
  clear(): void {
    this.operations.clear();
    this.stopCleanupTimer();
  }

  /**
   * Stop automatic cleanup timer and clear all operations
   */
  destroy(): void {
    this.stopCleanupTimer();
  }
}