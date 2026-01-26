/**
 * Optimistic Update Types
 *
 * Type definitions for optimistic updates system.
 */

// Re-export from PendingOperationsManager for convenience
export type { PendingOperation } from './PendingOperationsManager';

// Import types from API (v3.1.0 evidence-centric)
import {
  Source,
  SuggestedAction,
  EvidenceRequest,
  InvestigationMode,
  Hypothesis,
  TestResult
} from '../api';

import { CaseStatus, UserCase } from '../../types/case';
export type { UserCase };

/**
 * Base conversation item interface - matches ChatWindow.tsx (v3.1.0)
 */
export interface ConversationItem {
  id: string;
  question?: string;
  response?: string;
  error?: boolean;
  timestamp: string;
  responseType?: string;
  confidenceScore?: number | null;
  sources?: Source[];

  // v3.1.0 Evidence-centric fields
  evidenceRequests?: EvidenceRequest[];
  investigationMode?: InvestigationMode;
  caseStatus?: CaseStatus;

  // DEPRECATED v3.0.0 fields (kept for backward compatibility)
  suggestedActions?: SuggestedAction[] | null;

  plan?: {
    step_number: number;
    action: string;
    description: string;
    estimated_time?: string;
  } | null;
  nextActionHint?: string | null;
  requiresAction?: boolean;

  // Hypothesis tracking fields (reconnected features)
  newHypotheses?: Hypothesis[];
  hypothesisTested?: string | null;
  testResult?: TestResult | null;

  // Additional properties for optimistic updates (optional in base)
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  user_input?: string;
  loading?: boolean;
  optimistic?: boolean;
  failed?: boolean;
  originalId?: string;
  errorMessage?: string; // User-friendly error message
  onRetry?: (itemId: string) => void | Promise<void>; // Retry callback
  turn_number?: number; // Turn number for navigation to conversation context
}

/**
 * Optimistic conversation item with additional metadata
 */
export interface OptimisticConversationItem extends ConversationItem {
  optimistic: boolean; // Can be true for optimistic, false for confirmed
  originalId?: string;
  pendingOperationId?: string;
}

/**
 * Optimistic user case with additional metadata
 * v2.0: owner_id is optional here (populated when real data arrives)
 */
export interface OptimisticUserCase extends Omit<UserCase, 'owner_id'> {
  owner_id?: string;  // Optional for optimistic cases, required for real cases
  optimistic?: boolean;
  failed?: boolean;
  pendingOperationId?: string;
  originalId?: string;
}

/**
 * Title source types for precedence tracking
 */
export type TitleSource = 'user' | 'backend' | 'system';

/**
 * Optimistic operation status
 */
export type OptimisticStatus = 'pending' | 'completed' | 'failed';