/**
 * IdMappingManager - Manages mapping between optimistic and real CASE IDs
 *
 * Reconciles a temporary optimistic case id (`opt_case_*`) with the real case id
 * the backend returns when the case is created.
 *
 * NOTE: this maps CASE ids only. Message ids are NOT reconciled — a turn response
 * carries no message id (see TurnResponse), so an optimistic message keeps its
 * local `opt_msg_*` id after it commits and backend message truth is restored via
 * the delta fetch on case open, not by an id swap. (This is why message-id
 * reconciliation "never happens": there is nothing to reconcile against.)
 */

import { createLogger } from '~/lib/utils/logger';

const log = createLogger('IdMappingManager');

export interface IdMapping {
  optimisticId: string;
  realId: string;
  createdAt: number;
}

// Backward compatibility type for state persistence
export interface IdMappingState {
  optimisticToReal: Map<string, string>;
  realToOptimistic: Map<string, string>;
}

export class IdMappingManager {
  private mappings: Map<string, IdMapping> = new Map();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  // Elastic cleanup: the timer starts on the first mapping and stops when the
  // map empties, so an idle manager holds no timer. Without this the map grew
  // unbounded for the life of the side panel — cleanup() was never invoked.
  constructor(private cleanupIntervalMs: number = 600000) {} // 10 minutes

  /**
   * Add a mapping between an optimistic id and its real id.
   */
  addMapping(optimisticId: string, realId: string): void {
    if (!optimisticId.startsWith('opt_')) {
      throw new Error(`Not an optimistic id: ${optimisticId}`);
    }

    const mapping: IdMapping = {
      optimisticId,
      realId,
      createdAt: Date.now()
    };

    const wasEmpty = this.mappings.size === 0;
    this.mappings.set(optimisticId, mapping);
    if (wasEmpty) this.startCleanupTimer();
    log.debug('Added mapping', { optimisticId, realId });
  }

  /**
   * Get real ID for an optimistic ID
   */
  getRealId(optimisticId: string): string | undefined {
    const mapping = this.mappings.get(optimisticId);
    return mapping?.realId;
  }

  /**
   * Get mapping details
   */
  getMapping(optimisticId: string): IdMapping | undefined {
    return this.mappings.get(optimisticId);
  }

  /**
   * Check if an optimistic ID has been mapped to a real ID
   */
  isMapped(optimisticId: string): boolean {
    return this.mappings.has(optimisticId);
  }

  /**
   * Remove a mapping
   */
  removeMapping(optimisticId: string): boolean {
    const removed = this.mappings.delete(optimisticId);
    if (removed) {
      log.debug('Removed mapping', { optimisticId });
      if (this.mappings.size === 0) this.stopCleanupTimer();
    }
    return removed;
  }

  /** Start the elastic cleanup timer (runs while mappings exist). */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /** Stop the cleanup timer (called when the map becomes empty). */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Get all mappings
   */
  getAllMappings(): IdMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Resolve ID (return real ID if mapped, otherwise return original)
   * This is useful for functions that need to work with either optimistic or real IDs
   */
  resolveId(id: string): string {
    if (id.startsWith('opt_')) {
      const realId = this.getRealId(id);
      return realId || id; // Return real ID if mapped, otherwise keep optimistic
    }
    return id; // Already a real ID
  }

  /**
   * Clean up old mappings
   */
  cleanup(maxAgeMs: number = 3600000): void { // 1 hour default
    const now = Date.now();
    const toRemove: string[] = [];

    this.mappings.forEach((mapping, optimisticId) => {
      const age = now - mapping.createdAt;
      if (age > maxAgeMs) {
        toRemove.push(optimisticId);
      }
    });

    toRemove.forEach(id => this.removeMapping(id));

    if (toRemove.length > 0) {
      log.info('Cleaned up old mappings', { count: toRemove.length });
    }
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    const count = this.mappings.size;
    this.mappings.clear();
    this.stopCleanupTimer();
    log.info('Cleared all mappings', { count });
  }

  /**
   * Get state for persistence (backward compatibility)
   */
  getState(): IdMappingState {
    const optimisticToReal = new Map<string, string>();
    const realToOptimistic = new Map<string, string>();

    this.mappings.forEach(mapping => {
      optimisticToReal.set(mapping.optimisticId, mapping.realId);
      realToOptimistic.set(mapping.realId, mapping.optimisticId);
    });

    return { optimisticToReal, realToOptimistic };
  }

  /**
   * Set state from persistence (backward compatibility)
   */
  setState(state: IdMappingState): void {
    this.mappings.clear();

    state.optimisticToReal.forEach((realId, optimisticId) => {
      this.addMapping(optimisticId, realId);
    });
  }
}