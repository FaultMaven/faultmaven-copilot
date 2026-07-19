/**
 * Message Submission Hook
 *
 * Handles query submission with session-based lazy case creation.
 * Integrated with the centralized Zustand store.
 */

import { useState, useRef, useEffect } from 'react';
import { browser } from 'wxt/browser';
import {
  submitTurn,
  TurnRequest,
  QueryIntent,
  authManager,
  generateCaseTitle,
  getCaseConversation,
  createCase,
  CreateCaseRequest
} from '../../../lib/api';
import type { UserCase } from '../../../types/case';
import {
  AuthenticationError,
  CaseVersionConflictError
} from '../../../lib/errors/types';
import { ErrorClassifier } from '../../../lib/errors/classifier';
import {
  OptimisticIdGenerator,
  idMappingManager,
  pendingOpsManager,
  OptimisticUserCase,
  OptimisticConversationItem,
  PendingOperation
} from '../../../lib/optimistic';
import { queryClient } from '../../../lib/api/query-client';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { getRecoveryPlan } from '../../../lib/errors/recovery-strategies';
import { createLogger } from '../../../lib/utils/logger';
import { formatErrorForChat } from '../../../lib/utils/api-error-handler';
import { useAppStore } from '../../../lib/state/store';
import { getEpoch } from '../../../lib/state/session-epoch';
import { useError } from '../../../lib/errors';

const log = createLogger('useMessageSubmission');

// Minimum messages before auto-generating title (must match ConversationItem.tsx)
export const TITLE_GENERATION_THRESHOLD = 5;

export function useMessageSubmission() {
  const [submitting, setSubmitting] = useState(false);
  const { showError } = useError();

  // Controllers for in-flight turn submissions. A submitted turn can poll the
  // backend for up to POLL_MAX_TOTAL_MS; if this hook unmounts (side panel
  // closed) we abort so the detached poll loop stops instead of hammering the
  // job endpoint. Aborts are treated as silent cancellations, not failures.
  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const controllers = inFlightControllers.current;
    return () => {
      controllers.forEach(c => c.abort());
      controllers.clear();
    };
  }, []);

  // Abort every in-flight turn immediately. Called from handleLogout so a turn's
  // detached poll loop stops hitting the backend post-logout (a budget concern;
  // the session-epoch fence is what guarantees stale writes never land).
  const abortInFlight = () => {
    inFlightControllers.current.forEach(c => c.abort());
    inFlightControllers.current.clear();
  };

  // Selected store state
  const sessionId = useAppStore((state) => state.sessionId);
  const activeCaseId = useAppStore((state) => state.activeCaseId);
  const titleSources = useAppStore((state) => state.titleSources);
  const conversations = useAppStore((state) => state.conversations);

  // Selected store actions
  const setActiveCaseId = useAppStore((state) => state.setActiveCaseId);
  const setHasUnsavedNewChat = useAppStore((state) => state.setHasUnsavedNewChat);
  const setConversations = useAppStore((state) => state.setConversations);
  const setActiveCase = useAppStore((state) => state.setActiveCase);
  const setOptimisticCases = useAppStore((state) => state.setOptimisticCases);
  const setConversationTitles = useAppStore((state) => state.setConversationTitles);
  const setTitleSources = useAppStore((state) => state.setTitleSources);
  const refreshSession = useAppStore((state) => state.refreshSession);
  const triggerRefreshSessions = useAppStore((state) => state.triggerRefreshSessions);

  // Reconcile optimistic case ID with backend ID
  const createOptimisticCaseInBackground = async (optimisticId: string, title: string | null) => {
    // Capture the session epoch before the network round-trip. If the user logs
    // out (or a hard 401 fires) while createCase is in flight, the continuation
    // below must NOT re-write faultmaven_current_case, id-mappings, or
    // conversations back into the just-purged store/storage (issue #132).
    const epoch = getEpoch();
    try {
      log.info('Creating case on backend', { optimisticId, title });

      const caseRequest: CreateCaseRequest = {
        title: title || null,
        priority: 'low'
      };

      // optimisticId is stable for this logical case creation, so it doubles as
      // the Idempotency-Key: an ambiguous network failure can be auto-retried
      // without the backend creating a second case.
      const newCase = await resilientOperation({
        operation: () => createCase(caseRequest, { idempotencyKey: optimisticId }),
        context: { operation: 'case_create', metadata: { optimisticId } },
        idempotent: true,
      });
      const realCaseId = newCase.case_id;

      if (epoch !== getEpoch()) {
        log.info('Session changed during case creation — discarding stale reconciliation', {
          optimisticId,
          realCaseId
        });
        return realCaseId;
      }

      log.info('Case created on backend', { optimisticId, realCaseId });
      idMappingManager.addMapping(optimisticId, realCaseId);

      await setActiveCaseId(realCaseId);

      // Re-check after setActiveCaseId's await: a logout during that write must
      // not let the remaining store/storage writes below repopulate the purge.
      if (epoch !== getEpoch()) {
        log.info('Session changed mid-reconciliation — discarding remaining writes', {
          optimisticId,
          realCaseId
        });
        return realCaseId;
      }

      setConversations(prev => {
        const optimisticConversation = prev[optimisticId];
        if (!optimisticConversation) return prev;

        const updated = { ...prev };
        delete updated[optimisticId];
        updated[realCaseId] = optimisticConversation;
        return updated;
      });

      setConversationTitles(prev => {
        const updated = { ...prev };
        updated[realCaseId] = newCase.title;
        if (optimisticId !== realCaseId && updated[optimisticId]) {
          delete updated[optimisticId];
        }
        return updated;
      });

      setTitleSources(prev => {
        const optimisticSource = prev[optimisticId];
        if (!optimisticSource) return prev;

        const updated = { ...prev };
        delete updated[optimisticId];
        if (optimisticSource === 'user') {
          updated[realCaseId] = optimisticSource;
        }
        return updated;
      });

      setOptimisticCases(prev => {
        return prev.filter(c => c.case_id !== optimisticId);
      });

      setActiveCase(newCase);

      await browser.storage.local.set({
        faultmaven_current_case: realCaseId
      });

      log.info('Case ID reconciliation completed', { optimisticId, realCaseId });

      triggerRefreshSessions();

      return realCaseId;
    } catch (error) {
      log.error('Failed to create case on backend', error);
      throw error;
    }
  };

  // Background query submission function
  const submitOptimisticQueryInBackground = async (
    query: string,
    caseId: string,
    userMessageId: string,
    aiMessageId: string,
    intent?: QueryIntent
  ) => {
    const controller = new AbortController();
    inFlightControllers.current.add(controller);
    // Capture the session epoch before the turn round-trip. A logout while the
    // turn is in flight (or its poll loop is running) must not let the success
    // handler write the response / complete the pending op / set a title back
    // into a purged store (issue #132).
    const epoch = getEpoch();
    try {
      const response = await resilientOperation({
        operation: async () => {
          log.info('Starting background query submission', { query: query.substring(0, 50), caseId });

          const turnRequest: TurnRequest = {
            query: query.trim(),
            intentType: intent?.type,
            intentData: intent ? { ...intent } : undefined,
          };

          const response = await submitTurn(caseId, turnRequest, {
            signal: controller.signal,
            // aiMessageId is stable across every retry of this turn (the auto-retry
            // closure captures it; the manual-retry onRetry re-passes it), so it is
            // the natural per-turn Idempotency-Key — the backend dedupes a resend.
            idempotencyKey: aiMessageId,
          });
          log.info('Turn submitted successfully', { turnNumber: response.turn_number });

          if (response.case_state) {
            setActiveCase((prev: UserCase | null) => {
              if (prev && prev.state !== response.case_state) {
                log.info('Updating active case status from backend', {
                  oldStatus: prev.state,
                  newStatus: response.case_state
                });
                return { ...prev, state: response.case_state as UserCase['state'] };
              }
              return prev;
            });
          }

          queryClient.invalidateQueries({ queryKey: ['caseUI', caseId] });

          return response;
        },
        context: {
          operation: 'message_submission',
          caseId,
          metadata: { query: query.substring(0, 50) }
        },
        // Safe to auto-retry an ambiguous network failure: the request carries a
        // stable Idempotency-Key (aiMessageId), so the backend replays the cached
        // response for a resend instead of committing a second turn.
        idempotent: true,
        onError: (error, attempt) => {
          log.warn(`Submission attempt ${attempt} failed`, error);
        },
        onFailure: (error) => {
          // Caller-initiated cancellation (hook unmounted): silently stop, don't
          // mark the message failed or surface an error the user can't act on.
          if (controller.signal.aborted) {
            log.debug('Turn submission aborted (unmount) — skipping failure UI');
            return;
          }
          log.error('All submission attempts failed', error);

          const classified = ErrorClassifier.classify(error);
          if (classified instanceof CaseVersionConflictError) {
            log.warn('Case version conflict on turn submission', {
              caseId,
              expectedVersion: classified.expectedVersion,
              actualVersion: classified.actualVersion,
            });
            getCaseConversation(caseId)
              .then(data => {
                const fresh = (data?.messages ?? []) as Array<{
                  message_id: string;
                  case_state?: string;
                  closure_reason?: string | null;
                  closed_at?: string | null;
                }>;
                const last = fresh[fresh.length - 1];
                if (last?.case_state) {
                  setActiveCase((prev: UserCase | null) => {
                    if (prev && prev.state !== last.case_state) {
                      log.info('activeCase status refreshed after 409', {
                        oldStatus: prev.state,
                        newStatus: last.case_state,
                      });
                      return { ...prev, state: last.case_state as UserCase['state'] };
                    }
                    return prev;
                  });
                }
              })
              .catch(refreshErr => {
                log.debug('Post-409 case refresh failed', refreshErr);
              });
          }

          // Mark the op failed WITHOUT rolling back: the default rollback would
          // delete the user + AI messages, so the mark-failed below would find
          // nothing and the whole turn would silently vanish. Keep both messages
          // and render the AI item as failed (red) so the user can retry.
          pendingOpsManager.fail(aiMessageId, error.message, false);

          setConversations(prev => {
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

          const plan = getRecoveryPlan(error, {
            onRetry: async () => {
              await submitOptimisticQueryInBackground(query, caseId, userMessageId, aiMessageId, intent);
            },
            onLogout: () => {}
          });

          if (plan.strategy === 'manual_retry' || plan.strategy === 'retry_with_backoff') {
             showError(error);
          } else if (plan.strategy === 'logout_and_redirect') {
             showError('Session expired. Please sign in again.');
          } else {
             showError(error.userMessage);
          }
        }
      });

      // SUCCESS HANDLER
      // The session may have ended while the turn was in flight. Skip all
      // store/singleton writes below so a resolved turn can't repopulate a
      // conversation the logout purge just cleared.
      if (epoch !== getEpoch()) {
        log.info('Session changed during turn submission — discarding success writes', { caseId });
        return;
      }

      setConversations(prev => {
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
                caseStatus: response.case_state,
                suggestedActions: response.suggested_actions ?? null,
                optimistic: false,
                loading: false,
                // A successful (re)submission must clear any error state left by a
                // prior failed attempt (#101): otherwise the AI item renders in
                // error styling and isCommittedMessage drops it from persistence.
                error: false,
                failed: false,
                errorMessage: undefined,
                originalId: aiMessageId,
                metadata: {
                  milestones_completed: response.milestones_completed,
                  progress_made: response.progress_made,
                  attachments_processed: response.attachments_processed,
                }
              } as OptimisticConversationItem;
            }
            return item;
          })
        };
      });

      pendingOpsManager.complete(aiMessageId);
      log.info('Message submission completed and UI updated');

      const currentTurn = response.turn_number ?? 0;
      const titleSource = titleSources[caseId];
      const shouldAutoGenerateTitle =
        currentTurn >= TITLE_GENERATION_THRESHOLD && !titleSource;

      if (shouldAutoGenerateTitle) {
        log.info('Turn threshold reached, auto-generating smart title', {
          caseId,
          turn: currentTurn,
          threshold: TITLE_GENERATION_THRESHOLD
        });
        try {
          const titleResult = await generateCaseTitle(caseId, { max_words: 6 });
          // Re-check the epoch after the title-gen await: a logout during the
          // (multi-second) LLM call must not write the ended session's title back
          // into the purged store, which the subscriber would then persist (#143).
          if (epoch !== getEpoch()) {
            log.info('Session ended during title generation — discarding title write', { caseId });
          } else if (titleResult.title) {
            setConversationTitles(prev => ({
              ...prev,
              [caseId]: titleResult.title
            }));
            setTitleSources(prev => ({
              ...prev,
              [caseId]: 'backend'
            }));
            log.info('Smart title auto-generated', { caseId, title: titleResult.title });
          }
        } catch (error) {
          log.debug('Auto title generation skipped', { reason: 'insufficient context or error', error });
        }
      }

    } catch (error) {
      log.debug('Caught error from resilientOperation (handled in onFailure)', error);
    } finally {
      inFlightControllers.current.delete(controller);
      setSubmitting(false);
      log.debug('Input unlocked - submission completed');
    }
  };

  const handleQuerySubmit = async (query: string, intent?: QueryIntent) => {
    if (!query.trim()) return;

    if (submitting) {
      log.warn('Query submission blocked - already submitting');
      return;
    }

    // Capture the epoch up front: if the user logs out during case creation
    // below, we must stop before adding optimistic messages to a purged store.
    const epoch = getEpoch();

    const isAuth = await authManager.isAuthenticated();
    if (!isAuth) {
      log.error('User not authenticated, cannot submit query');
      return;
    }

    log.debug('OPTIMISTIC MESSAGE SUBMISSION START');

    setSubmitting(true);

    const userMessageId = OptimisticIdGenerator.generateMessageId();
    const aiMessageId = OptimisticIdGenerator.generateMessageId();
    const messageTimestamp = new Date().toISOString();

    let targetCaseId = activeCaseId;

    if (!targetCaseId) {
      log.debug('No active case, creating case via createOptimisticCaseInBackground');

      try {
        const optimisticCaseId = OptimisticIdGenerator.generateCaseId();

        setActiveCaseId(optimisticCaseId);
        setHasUnsavedNewChat(false);

        await browser.storage.local.set({ faultmaven_current_case: optimisticCaseId });

        const realCaseId = await createOptimisticCaseInBackground(optimisticCaseId, null);

        targetCaseId = realCaseId;

        log.info('Case created and ID reconciled', { optimisticId: optimisticCaseId, realId: targetCaseId });
      } catch (error) {
        log.error('Failed to create case', error);
        showError('Failed to create case. Please try again.');
        setSubmitting(false);
        return;
      }
    }

    if (!targetCaseId) {
      log.error('CRITICAL: No case ID available');
      showError('No active case. Please try again.');
      setSubmitting(false);
      return;
    }

    // A logout during case creation ends this submission: don't add optimistic
    // messages or fire a turn against a case that belongs to the ended session.
    if (epoch !== getEpoch()) {
      log.info('Session changed during submission setup — aborting query submit');
      setSubmitting(false);
      return;
    }

    log.debug('Creating optimistic messages', { userMessageId, aiMessageId, targetCaseId });

    const existingMessages = conversations[targetCaseId] || [];
    const highestTurn = existingMessages.reduce((max, msg) =>
      Math.max(max, msg.turn_number || 0), 0
    );
    const nextTurnNumber = highestTurn + 1;

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

    setConversations(prev => ({
      ...prev,
      [targetCaseId!]: [...(prev[targetCaseId!] || []), userMessage, aiThinkingMessage]
    }));

    setActiveCaseId(targetCaseId);

    log.info('Messages added to UI immediately - 0ms response time');

    const pendingOperation: PendingOperation = {
      id: aiMessageId,
      type: 'submit_query',
      status: 'pending',
      optimisticData: { userMessage, aiThinkingMessage, query, caseId: targetCaseId },
      rollbackFn: () => {
        log.debug('Rolling back failed message submission');
        setConversations(prev => ({
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

    submitOptimisticQueryInBackground(query, targetCaseId!, userMessageId, aiMessageId, intent);
  };

  return {
    submitting,
    handleQuerySubmit,
    abortInFlight
  };
}
