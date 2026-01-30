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
 * Updated 2026-01-30: Added case state tracking fields per backend message storage (commit b434152a)
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

  // Case state tracking fields (added 2026-01-30 per commit b434152a)
  // These track case state at the time the message was created
  case_status?: CaseStatus;  // Case status when this message was created
  closure_reason?: string | null;  // If case was closed in this turn
  closed_at?: string | null;  // Timestamp if case reached terminal state

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
 * Updated 2026-01-30: Include organization_id, closure_reason, closed_at per backend storage fixes
 */
export interface OptimisticUserCase extends Omit<UserCase, 'owner_id' | 'organization_id'> {
  owner_id?: string;  // Optional for optimistic cases, required for real cases
  organization_id?: string;  // Optional for optimistic cases, populated when real data arrives per commit b434152a
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