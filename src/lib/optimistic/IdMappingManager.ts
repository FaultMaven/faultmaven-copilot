/**
 * IdMappingManager - Manages mapping between optimistic and real IDs
 *
 * Handles the reconciliation between temporary optimistic IDs and the
 * real IDs returned from the backend API.
 */

import { createLogger } from '~/lib/utils/logger';

const log = createLogger('IdMappingManager');

export interface IdMapping {
  optimisticId: string;
  realId: string;
  type: 'case' | 'message';
  createdAt: number;
}

// Backward compatibility type for state persistence
export interface IdMappingState {
  optimisticToReal: Map<string, string>;
  realToOptimistic: Map<string, string>;
}

export class IdMappingManager {
  private mappings: Map<string, IdMapping> = new Map();

  /**
   * Add a mapping between optimistic and real ID
   */
  addMapping(optimisticId: string, realId: string, type?: 'case' | 'message'): void {
    // Auto-detect type if not provided
    if (!type) {
      if (optimisticId.startsWith('opt_case_')) {
        type = 'case';
      } else if (optimisticId.startsWith('opt_msg_')) {
        type = 'message';
      } else {
        throw new Error(`Cannot auto-detect type for ID: ${optimisticId}`);
      }
    }

    const mapping: IdMapping = {
      optimisticId,
      realId,
      type,
      createdAt: Date.now()
    };

    this.mappings.set(optimisticId, mapping);
    log.debug('Added mapping', { optimisticId, realId, type });
  }

  /**
   * Get real ID for an optimistic ID
   */
  getRealId(optimisticId: string): string | undefined {
    const mapping = this.mappings.get(optimisticId);
    return mapping?.realId;
  }

  /**
   * Get optimistic ID for a real ID (reverse lookup)
   */
  getOptimisticId(realId: string): string | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.realId === realId) {
        return mapping.optimisticId;
      }
    }
    return undefined;
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
    }
    return removed;
  }

  /**
   * Get all mappings
   */
  getAllMappings(): IdMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Get mappings by type
   */
  getMappingsByType(type: 'case' | 'message'): IdMapping[] {
    return Array.from(this.mappings.values()).filter(mapping => mapping.type === type);
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
   * Get statistics about mappings
   */
  getStats(): {
    total: number;
    cases: number;
    messages: number;
    oldestMapping?: number;
  } {
    const mappings = Array.from(this.mappings.values());
    const now = Date.now();

    const stats = {
      total: mappings.length,
      cases: mappings.filter(m => m.type === 'case').length,
      messages: mappings.filter(m => m.type === 'message').length,
      oldestMapping: undefined as number | undefined
    };

    if (mappings.length > 0) {
      const oldest = Math.min(...mappings.map(m => m.createdAt));
      stats.oldestMapping = now - oldest;
    }

    return stats;
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    const count = this.mappings.size;
    this.mappings.clear();
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