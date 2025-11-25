/**
 * Message Submission Hook
 *
 * Handles query submission with session-based lazy case creation:
 * - Instant UI feedback (0ms response time)
 * - Lazy case creation on first query (uses session endpoint)
 * - No ID reconciliation needed (real UUIDs from start)
 * - Error handling and retry logic
 * - Conflict resolution for concurrent updates
 */

import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  submitQueryToCase,
  QueryRequest,
  createSession,
  authManager
} from '../../../lib/api';
import { AuthenticationError } from '../../../lib/errors/types';
import {
  OptimisticIdGenerator,
  IdUtils,
  pendingOpsManager,
  conflictResolver,
  MergeStrategies,
  OptimisticUserCase,
  OptimisticConversationItem,
  PendingOperation,
  MergeContext,
  ConflictDetectionResult
} from '../../../lib/optimistic';
import { retryWithBackoff } from '../../../lib/utils/retry';
import { createLogger } from '../../../lib/utils/logger';
import { classifyError, formatErrorForChat } from '../../../lib/utils/api-error-handler';
import type { ConflictResolution } from '../components/ConflictResolutionModal';

const log = createLogger('useMessageSubmission');

export interface UseMessageSubmissionProps {
  // Current state
  sessionId: string | null;
  activeCaseId: string | undefined;
  hasUnsavedNewChat: boolean;
  conversations: Record<string, OptimisticConversationItem[]>;
  
  // State setters (sessionId managed by useSessionManagement hook, not needed here)
  setActiveCaseId: (id: string | undefined) => void;
  setHasUnsavedNewChat: (hasUnsaved: boolean) => void;
  setConversations: React.Dispatch<React.SetStateAction<Record<string, OptimisticConversationItem[]>>>;
  setActiveCase: React.Dispatch<React.SetStateAction<any>>;
  setOptimisticCases: React.Dispatch<React.SetStateAction<OptimisticUserCase[]>>;
  setConversationTitles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTitleSources: React.Dispatch<React.SetStateAction<Record<string, 'user' | 'backend' | 'system'>>>;
  setInvestigationProgress: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  
  // Callbacks
  createOptimisticCaseInBackground: (optimisticCaseId: string, title: string) => Promise<void>;
  refreshSession: () => Promise<string>;
  showError: (error: any, context?: any) => void;
  showErrorWithRetry: (error: any, retryFn: () => Promise<void>, context?: any) => void;
  showConflictResolution: (
    conflict: ConflictDetectionResult,
    localData: any,
    remoteData: any,
    mergeResult?: any
  ) => Promise<ConflictResolution>;
}

export function useMessageSubmission(props: UseMessageSubmissionProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleQuerySubmit = async (query: string) => {
    if (!query.trim()) return;

    // Prevent multiple submissions
    if (submitting) {
      log.warn('Query submission blocked - already submitting');
      return;
    }

    // Check authentication first
    const isAuth = await authManager.isAuthenticated();
    if (!isAuth) {
      log.error('User not authenticated, cannot submit query');
      return;
    }

    log.debug('OPTIMISTIC MESSAGE SUBMISSION START');

    // LOCK INPUT: Prevent multiple submissions (immediate feedback)
    setSubmitting(true);

    // OPTIMISTIC MESSAGE SUBMISSION: Immediate UI updates (0ms response)

    // Generate optimistic message IDs
    const userMessageId = OptimisticIdGenerator.generateMessageId();
    const aiMessageId = OptimisticIdGenerator.generateMessageId();
    const messageTimestamp = new Date().toISOString(); // ISO 8601 format to match backend

    // Step 1: Ensure case exists using session-based lazy creation
    let targetCaseId = props.activeCaseId;

    if (!targetCaseId) {
      log.debug('No active case, creating case via createOptimisticCaseInBackground');

      try {
        // Generate optimistic case ID and create in background
        const optimisticCaseId = OptimisticIdGenerator.generateCaseId();
        targetCaseId = optimisticCaseId;

        // Update UI with optimistic ID immediately
        props.setActiveCaseId(targetCaseId);
        props.setHasUnsavedNewChat(false);

        // Store in localStorage for persistence (frontend state management v2.0)
        await browser.storage.local.set({ faultmaven_current_case: targetCaseId });

        // Create actual case in background (will reconcile ID later)
        await props.createOptimisticCaseInBackground(optimisticCaseId, 'New troubleshooting case');

        log.info('Case created with optimistic ID', { caseId: targetCaseId });
      } catch (error) {
        log.error('Failed to create case', error);
        props.showError('Failed to create case. Please try again.');
        setSubmitting(false);
        return;
      }
    }

    // Safety check
    if (!targetCaseId) {
      log.error('CRITICAL: No case ID available');
      props.showError('No active case. Please try again.');
      setSubmitting(false);
      return;
    }

    log.debug('Creating optimistic messages', { userMessageId, aiMessageId, targetCaseId });

    // IMMEDIATE UI UPDATE 1: Add user message to conversation (0ms)
    const userMessage: OptimisticConversationItem = {
      id: userMessageId,
      question: query,
      response: '',
      error: false,
      timestamp: messageTimestamp,
      optimistic: true,
      loading: false,
      failed: false,
      pendingOperationId: userMessageId,
      originalId: userMessageId
    };

    // IMMEDIATE UI UPDATE 2: Add AI "thinking" message (0ms)
    const aiThinkingMessage: OptimisticConversationItem = {
      id: aiMessageId,
      question: '',
      response: '',
      error: false,
      timestamp: messageTimestamp,
      optimistic: true,
      loading: true,
      failed: false,
      pendingOperationId: aiMessageId,
      originalId: aiMessageId
    };

    // Update conversation immediately
    props.setConversations(prev => ({
      ...prev,
      [targetCaseId]: [...(prev[targetCaseId] || []), userMessage, aiThinkingMessage]
    }));

    // Focus/highlight the active case in the sidebar
    props.setActiveCaseId(targetCaseId);

    log.info('Messages added to UI immediately - 0ms response time');

    // Create pending operation for tracking
    const pendingOperation: PendingOperation = {
      id: aiMessageId,
      type: 'submit_query',
      status: 'pending',
      optimisticData: { userMessage, aiThinkingMessage, query, caseId: targetCaseId },
      rollbackFn: () => {
        log.debug('Rolling back failed message submission');
        props.setConversations(prev => ({
          ...prev,
          [targetCaseId]: (prev[targetCaseId] || []).filter(
            item => item.id !== userMessageId && item.id !== aiMessageId
          )
        }));
      },
      retryFn: async () => {
        log.debug('Retrying message submission');
        await submitOptimisticQueryInBackground(query, targetCaseId, userMessageId, aiMessageId);
      },
      createdAt: Date.now()
    };

    pendingOpsManager.add(pendingOperation);

    // Background API submission (non-blocking)
    submitOptimisticQueryInBackground(query, targetCaseId, userMessageId, aiMessageId);
  };

  // Background query submission function
  const submitOptimisticQueryInBackground = async (
    query: string,
    caseId: string,
    userMessageId: string,
    aiMessageId: string
  ) => {
    try {
      log.info('Starting background query submission', { query: query.substring(0, 50), caseId });

      // Ensure we have a session
      let currentSessionId = props.sessionId;
      if (!currentSessionId) {
        log.info('No session found, creating new session...');
        currentSessionId = await props.refreshSession();
        log.info('New session created', { sessionId: currentSessionId });
      }

      // Step 2: Submit query to case (caseId is already the real UUID)
      // No ID reconciliation needed - we got the real case ID from session endpoint
      log.info('Submitting query to case via API', { caseId, sessionId: currentSessionId });

      const queryRequest: QueryRequest = {
        session_id: currentSessionId,
        query: query.trim(),
        priority: 'low',
        context: {}
      };

      const response = await submitQueryToCase(caseId, queryRequest);
      log.info('Query submitted successfully', { responseType: response.response_type });

      // Update investigation progress from view_state (OODA Framework v3.2.0)
      if (response.view_state && response.view_state.investigation_progress) {
        props.setInvestigationProgress(prev => ({
          ...prev,
          [caseId]: response.view_state!.investigation_progress
        }));
        log.debug('Investigation progress updated', response.view_state.investigation_progress);
      }

      // Update conversations: replace optimistic messages with real data
      props.setConversations(prev => {
        const currentConversation = prev[caseId] || [];
        let updated = currentConversation.map(item => {
          if (item.id === userMessageId) {
            return {
              ...item,
              optimistic: false,
              originalId: userMessageId
            };
          } else if (item.id === aiMessageId) {
            return {
              ...item,
              response: response.content,
              responseType: response.response_type,
              confidenceScore: response.confidence_score,
              sources: response.sources,
              evidenceRequests: response.evidence_requests,
              investigationMode: response.investigation_mode,
              caseStatus: response.case_status,
              suggestedActions: response.suggested_actions,
              clarifyingQuestions: response.clarifying_questions,
              suggestedCommands: response.suggested_commands,
              commandValidation: response.command_validation,
              problemDetected: response.problem_detected,
              problemSummary: response.problem_summary,
              severity: response.severity,
              scopeAssessment: response.scope_assessment,
              plan: response.plan,
              nextActionHint: response.next_action_hint,
              requiresAction: response.response_type === 'CONFIRMATION_REQUEST' || response.response_type === 'CLARIFICATION_REQUEST',
              optimistic: false,
              loading: false,
              originalId: aiMessageId
            };
          }
          return item;
        });

        // No ID reconciliation needed - caseId is already the real UUID from backend
        return {
          ...prev,
          [caseId]: updated
        };
      });

      // Mark operation as completed
      pendingOpsManager.complete(aiMessageId);

      log.info('Message submission completed and UI updated');

    } catch (error) {
      log.error('Background query submission failed', error);

      // Classify the error using centralized handler
      const errorInfo = classifyError(error, 'message_submission');

      // Mark operation as failed
      pendingOpsManager.fail(aiMessageId, errorInfo.technicalMessage);

      // Get user-friendly error message
      const userMessage = formatErrorForChat(errorInfo);

      // Update AI message to show error state
      props.setConversations(prev => {
        const currentConversation = prev[caseId] || [];
        const updated = currentConversation.map(item => {
          if (item.id === aiMessageId) {
            return {
              ...item,
              response: userMessage,
              error: true,
              optimistic: false,
              loading: false,
              failed: true
            };
          }
          return item;
        });

        return {
          ...prev,
          [caseId]: updated
        };
      });

      // Handle based on error type
      if (errorInfo.shouldLogout) {
        // Auth error - user needs to log in, don't show retry
        log.warn('Auth error detected - user needs to re-login');
        props.showError(errorInfo.userMessage);
      } else if (errorInfo.shouldRetry) {
        // Retryable error (network or server) - show retry option
        props.showErrorWithRetry(
          error,
          async () => {
            await submitOptimisticQueryInBackground(query, caseId, userMessageId, aiMessageId);
          },
          {
            operation: 'message_submission',
            metadata: { caseId, query: query.substring(0, 50) }
          }
        );
      } else {
        // Non-retryable error - just show message
        props.showError(errorInfo.userMessage);
      }

    } finally {
      // UNLOCK INPUT: Always unlock input when submission completes
      setSubmitting(false);
      log.debug('Input unlocked - submission completed');
    }
  };

  return {
    submitting,
    handleQuerySubmit
  };
}

