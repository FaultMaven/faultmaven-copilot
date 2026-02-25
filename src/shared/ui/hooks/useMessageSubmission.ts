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
  submitTurn,
  TurnRequest,
  QueryIntent,
  authManager,
  generateCaseTitle
} from '../../../lib/api';
import type { UserCase } from '../../../types/case';
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
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { getRecoveryPlan } from '../../../lib/errors/recovery-strategies';
import { createLogger } from '../../../lib/utils/logger';
import { classifyError, formatErrorForChat } from '../../../lib/utils/api-error-handler';
import type { ConflictResolution } from '../components/ConflictResolutionModal';

const log = createLogger('useMessageSubmission');

// Minimum messages before auto-generating title (must match ConversationItem.tsx)
export const TITLE_GENERATION_THRESHOLD = 5;

export interface UseMessageSubmissionProps {
  // Current state
  sessionId: string | null;
  activeCaseId: string | undefined;
  hasUnsavedNewChat: boolean;
  conversations: Record<string, OptimisticConversationItem[]>;
  titleSources: Record<string, 'user' | 'backend' | 'system'>;

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
  createOptimisticCaseInBackground: (optimisticCaseId: string, title: string | null) => Promise<string>;
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

  // Background query submission function
  const submitOptimisticQueryInBackground = async (
    query: string,
    caseId: string,
    userMessageId: string,
    aiMessageId: string,
    intent?: QueryIntent
  ) => {
    try {
      const response = await resilientOperation({
        operation: async () => {
          log.info('Starting background query submission', { query: query.substring(0, 50), caseId });

          // Submit turn to case (caseId is already the real UUID)
          log.info('Submitting turn to case via API', { caseId });

          const turnRequest: TurnRequest = {
            query: query.trim(),
            intentType: intent?.type,
            intentData: intent ? { ...intent } : undefined,
          };

          const response = await submitTurn(caseId, turnRequest);
          log.info('Turn submitted successfully', { turnNumber: response.turn_number });

          // Update active case status from TurnResponse
          if (response.case_status) {
            props.setActiveCase((prev: UserCase | null) => {
              if (prev && prev.status !== response.case_status) {
                log.info('Updating active case status from backend', {
                  oldStatus: prev.status,
                  newStatus: response.case_status
                });
                return { ...prev, status: response.case_status };
              }
              return prev;
            });
          }

          return response;
        },
        context: {
          operation: 'message_submission',
          caseId,
          metadata: { query: query.substring(0, 50) }
        },
        onError: (error, attempt) => {
          log.warn(`Submission attempt ${attempt} failed`, error);
        },
        onFailure: (error) => {
          log.error('All submission attempts failed', error);
          
          // Mark operation as failed in pendingOpsManager
          pendingOpsManager.fail(aiMessageId, error.message);

          // Update AI message to show error state
          props.setConversations(prev => {
            const currentConversation = prev[caseId] || [];
            const userMessage = formatErrorForChat(error);
            
            return {
              ...prev,
              [caseId]: currentConversation.map(item => {
                if (item.id === aiMessageId) {
                  return {
                    ...item,
                    response: userMessage,
                    error: true,
                    optimistic: false,
                    loading: false,
                    failed: true
                  } as OptimisticConversationItem;
                }
                return item;
              })
            };
          });

          // Show global error UI if needed
          const plan = getRecoveryPlan(error, {
            onRetry: async () => {
              await submitOptimisticQueryInBackground(query, caseId, userMessageId, aiMessageId, intent);
            },
            onLogout: () => {
               // Auth handling is typically global, but we can signal it
            }
          });

          if (plan.strategy === 'manual_retry' || plan.strategy === 'retry_with_backoff') {
             // For manual retry (like 500 error), show the retry UI
             // Even if strategy is retry_with_backoff, if we are in onFailure, it means auto-retries exhausted
             props.showErrorWithRetry(
              error,
              async () => {
                await submitOptimisticQueryInBackground(query, caseId, userMessageId, aiMessageId, intent);
              },
              { operation: 'message_submission' }
             );
          } else if (plan.strategy === 'logout_and_redirect') {
             props.showError('Session expired. Please sign in again.');
          } else {
             props.showError(error.userMessage);
          }
        }
      });

      // SUCCESS HANDLER
      const currentConversation = props.conversations[caseId] || [];

      // Update conversations: replace optimistic messages with real data
      props.setConversations(prev => {
           const conv = prev[caseId] || [];
           return {
             ...prev,
             [caseId]: conv.map(item => {
               if (item.id === userMessageId) {
                 return {
                   ...item,
                   optimistic: false,
                   originalId: userMessageId
                 } as OptimisticConversationItem;
               } else if (item.id === aiMessageId) {
                 return {
                   ...item,
                   response: response.agent_response,
                   turn_number: response.turn_number,
                   caseStatus: response.case_status,
                   suggestedActions: response.suggested_actions ?? null,
                   optimistic: false,
                   loading: false,
                   originalId: aiMessageId,
                   metadata: {
                     milestones_completed: response.milestones_completed,
                     progress_made: response.progress_made,
                     is_stuck: response.is_stuck,
                     attachments_processed: response.attachments_processed,
                   }
                 } as OptimisticConversationItem;
               }
               return item;
             })
           };
         });

         // Mark operation as completed
         pendingOpsManager.complete(aiMessageId);
         log.info('Message submission completed and UI updated');

         // Auto-generate smart title when message count first reaches threshold
         // Each conversation item represents one message (user or AI), so divide by 2 for exchanges
         // After this submission, we have the user message + AI response = 2 new items
         const currentMessageCount = Math.ceil(currentConversation.length / 2);
         const titleSource = props.titleSources[caseId];
         const isUserRenamed = titleSource === 'user';
         const shouldAutoGenerateTitle =
           currentMessageCount === TITLE_GENERATION_THRESHOLD && !isUserRenamed;

         if (shouldAutoGenerateTitle) {
           log.info('Message threshold reached, auto-generating smart title', {
             caseId,
             messageCount: currentMessageCount,
             threshold: TITLE_GENERATION_THRESHOLD
           });
           try {
             const titleResult = await generateCaseTitle(caseId, { max_words: 6 });
             if (titleResult.title) {
               props.setConversationTitles(prev => ({
                 ...prev,
                 [caseId]: titleResult.title
               }));
               props.setTitleSources(prev => ({
                 ...prev,
                 [caseId]: 'backend'
               }));
               log.info('Smart title auto-generated', { caseId, title: titleResult.title });
             }
           } catch (error) {
             log.debug('Auto title generation skipped', { reason: 'insufficient context or error', error });
             // Non-critical - silently ignore, user can manually request later
           }
         } else if (currentMessageCount > TITLE_GENERATION_THRESHOLD) {
           log.debug('Past auto-generation threshold, skipping', { messageCount: currentMessageCount });
         }

    } catch (error) {
       // We rely on onFailure for the UI updates.
       log.debug('Caught error from resilientOperation (handled in onFailure)', error);
    } finally {
      // UNLOCK INPUT: Always unlock input when submission completes
      setSubmitting(false);
      log.debug('Input unlocked - submission completed');
    }
  };

  const handleQuerySubmit = async (query: string, intent?: QueryIntent) => {
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
        // Generate optimistic case ID
        const optimisticCaseId = OptimisticIdGenerator.generateCaseId();

        // Update UI with optimistic ID immediately (for instant feedback)
        props.setActiveCaseId(optimisticCaseId);
        props.setHasUnsavedNewChat(false);

        // Store in localStorage for persistence (frontend state management v2.0)
        await browser.storage.local.set({ faultmaven_current_case: optimisticCaseId });

        // Create actual case on backend (will reconcile ID and update state)
        // This function creates the case, gets the real UUID, updates all state, and returns the real ID
        // Pass null to trigger backend auto-generation of Case-MMDD-N format
        const realCaseId = await props.createOptimisticCaseInBackground(optimisticCaseId, null);

        // Use the real case ID for query submission
        targetCaseId = realCaseId;

        log.info('Case created and ID reconciled', { optimisticId: optimisticCaseId, realId: targetCaseId });
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

    // Calculate turn_number for optimistic messages
    // Per API contract: "Turn number in conversation (user messages increment turn)"
    // Each turn = one user message + one agent response
    const existingMessages = props.conversations[targetCaseId] || [];
    const highestTurn = existingMessages.reduce((max, msg) =>
      Math.max(max, msg.turn_number || 0), 0
    );
    const nextTurnNumber = highestTurn + 1;

    // IMMEDIATE UI UPDATE 1: Add user message to conversation (0ms)
    const userMessage: OptimisticConversationItem = {
      id: userMessageId,
      question: query,
      response: '',
      error: false,
      timestamp: messageTimestamp,
      turn_number: nextTurnNumber,
      optimistic: true,
      loading: false,
      failed: false,
      pendingOperationId: userMessageId,
      originalId: userMessageId
    } as OptimisticConversationItem;

    // IMMEDIATE UI UPDATE 2: Add AI "thinking" message (0ms)
    // Same turn_number as user message (they're part of the same turn)
    const aiThinkingMessage: OptimisticConversationItem = {
      id: aiMessageId,
      question: '',
      response: '',
      error: false,
      timestamp: messageTimestamp,
      turn_number: nextTurnNumber,
      optimistic: true,
      loading: true,
      failed: false,
      pendingOperationId: aiMessageId,
      originalId: aiMessageId
    } as OptimisticConversationItem;

    // Update conversation immediately
    props.setConversations(prev => ({
      ...prev,
      [targetCaseId!]: [...(prev[targetCaseId!] || []), userMessage, aiThinkingMessage]
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
          [targetCaseId!]: (prev[targetCaseId!] || []).filter(
            item => item.id !== userMessageId && item.id !== aiMessageId
          )
        }));
      },
      retryFn: async () => {
        log.debug('Retrying message submission');
        await submitOptimisticQueryInBackground(query, targetCaseId!, userMessageId, aiMessageId, intent);
      },
      createdAt: Date.now()
    };

    pendingOpsManager.add(pendingOperation);

    // Background API submission (non-blocking)
    submitOptimisticQueryInBackground(query, targetCaseId!, userMessageId, aiMessageId, intent);
  };

  return {
    submitting,
    handleQuerySubmit
  };
}
