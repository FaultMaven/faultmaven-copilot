/**
 * Optimistic Updates System
 *
 * Complete infrastructure for handling optimistic updates in the
 * FaultMaven Copilot browser extension.
 */

// Core classes
export { OptimisticIdGenerator } from './OptimisticIdGenerator';
export { IdUtils } from './IdUtils';
export { PendingOperationsManager } from './PendingOperationsManager';
export { IdMappingManager } from './IdMappingManager';
export { ConflictResolver } from './ConflictResolver';
export { MergeStrategies } from './MergeStrategies';

// Types
export type {
  PendingOperation,
  ConversationItem,
  OptimisticConversationItem,
  UserCase,
  OptimisticUserCase,
  TitleSource,
  OptimisticStatus
} from './types';

// Re-export mapping types
export type { IdMapping, IdMappingState } from './IdMappingManager';

// Re-export conflict resolution types
export type {
  ConflictDetectionResult,
  ConflictResolutionStrategy,
  ConflictResolution,
  DataBackup
} from './ConflictResolver';

// Re-export merge strategy types
export type {
  MergeResult,
  MergeContext
} from './MergeStrategies';

// Create singleton instances for global use
import { PendingOperationsManager } from './PendingOperationsManager';
import { IdMappingManager } from './IdMappingManager';
import { ConflictResolver } from './ConflictResolver';

export const pendingOpsManager = new PendingOperationsManager();
export const idMappingManager = new IdMappingManager();
export const conflictResolver = new ConflictResolver();
