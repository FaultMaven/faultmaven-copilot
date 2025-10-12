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
  CaseStatus
} from '../api';

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
 * Base user case interface
 */
export interface UserCase {
  case_id: string;
  title: string;
  status: 'active' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
  message_count: number;
}

/**
 * Optimistic user case with additional metadata
 */
export interface OptimisticUserCase extends UserCase {
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