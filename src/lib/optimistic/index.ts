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

// Types
export type {
  PendingOperation,
  ConversationItem,
  OptimisticConversationItem,
  UserCase,
  TitleSource,
  OptimisticStatus
} from './types';

// Re-export mapping types
export type { IdMapping, IdMappingState } from './IdMappingManager';

// Create singleton instances for global use
import { PendingOperationsManager } from './PendingOperationsManager';
import { IdMappingManager } from './IdMappingManager';

export const pendingOpsManager = new PendingOperationsManager();
export const idMappingManager = new IdMappingManager();
