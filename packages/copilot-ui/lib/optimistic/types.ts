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
  TestResult,
  AttachmentResult,
} from '../api';

import { UserCase } from '../../types/case';
export type { UserCase };

/**
 * Base conversation item interface - matches ChatWindow.tsx (v3.1.0)
 */
export interface ConversationItem {
  id: string;
  question?: string;
  response?: string;
  /**
   * A non-conversational notice about the case — the third content slot,
   * alongside `question` and `response`.
   *
   * Set for backend rows classified `notice` by `messageKind` (`role: "system"`
   * and anything outside the contract vocabulary): today, the outcome of
   * background work such as runbook conversion. Exactly ONE of `question` /
   * `response` / `notice` is populated on a delta-fetched item, which is what
   * keeps a non-conversational row from committing as a contentless ghost —
   * invisible in ChatWindow, yet holding a `message_id` that would permanently
   * block a corrected re-fetch through the id dedup in `handleCaseSelect`.
   *
   * A notice is not attributed to either participant and claims no turn. See
   * `lib/state/message-kind.ts`.
   */
  notice?: string;
  error?: boolean;
  timestamp: string;
  responseType?: string;
  likelihood?: number | null;
  sources?: Source[];

  // v3.1.0 Evidence-centric fields
  evidenceRequests?: EvidenceRequest[];
  investigationMode?: InvestigationMode;

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

  // File attachments processed in this turn
  attachments?: AttachmentResult[];

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
 * Title source types for precedence tracking
 */
export type TitleSource = 'user' | 'backend' | 'system';

/**
 * Optimistic operation status
 */
export type OptimisticStatus = 'pending' | 'completed' | 'failed';