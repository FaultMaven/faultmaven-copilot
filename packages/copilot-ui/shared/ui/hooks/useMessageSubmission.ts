/**
 * Message Submission Hook
 *
 * Handles query submission with session-based lazy case creation.
 * Integrated with the centralized Zustand store.
 */

import { useState, useRef, useEffect } from 'react';
import {
  submitTurn,
  TurnRequest,
  QueryIntent,
  createCase,
  CreateCaseRequest
} from '../../../lib/api';
import type { UserCase } from '../../../types/case';
import {
  CaseVersionConflictError
} from '../../../lib/errors/types';
import { ErrorClassifier } from '../../../lib/errors/classifier';
import {
  OptimisticIdGenerator,
  idMappingManager,
  pendingOpsManager,
  OptimisticConversationItem,
  PendingOperation
} from '../../../lib/optimistic';
import { isOptimisticId } from '../../../lib/utils/data-integrity';
import { queryClient } from '../../../lib/api/query-client';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { getRecoveryPlan } from '../../../lib/errors/recovery-strategies';
import { createLogger } from '../../../lib/utils/logger';
import { formatErrorForChat } from '../../../lib/utils/api-error-handler';
import { useAppStore } from '../../../lib/state/store';
import { getEpoch } from '../../../lib/state/session-epoch';
import { useError } from '../../../lib/errors';

const log = createLogger('useMessageSubmission');

// There is deliberately no TITLE_GENERATION_THRESHOLD here any more.
//
// Auto-titling is the server's job: POST /cases/{id}/turns names a case still
// carrying its `Case-YYMMDD-N` placeholder once it has enough substance to name,
// in the background. This hook used to do it too, gated on `turn_number >= 5` —
// a copy of a backend policy, written in TypeScript, that drifted from it and
// blocked exactly the upload-driven cases the backend gate was relaxed to allow
// (fm#1069). Two triggers for one job is how they disagree; the client keeps the
// user-initiated "Generate title" action in ConversationsList and nothing else.

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
  const activeCaseId = useAppStore((state) => state.activeCaseId);
  const conversations = useAppStore((state) => state.conversations);

  // Selected store actions
  const setActiveCaseId = useAppStore((state) => state.setActiveCaseId);
  const setHasUnsavedNewChat = useAppStore((state) => state.setHasUnsavedNewChat);
  const setConversations = useAppStore((state) => state.setConversations);
  const setActiveCase = useAppStore((state) => state.setActiveCase);
  const setConversationTitles = useAppStore((state) => state.setConversationTitles);
  const setTitleSources = useAppStore((state) => state.setTitleSources);
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
        const optimisticTitle = prev[optimisticId];
        if (optimisticId === realCaseId || !optimisticTitle) return prev;

        // Carry a title the user set on the optimistic case over to the real id —
        // and nothing else. This used to write `newCase.title`, which for a
        // just-created case is the backend placeholder `Case-YYMMDD-N`. Because
        // the store wins over the backend title in `selectCaseTitle`, that pinned
        // the placeholder ahead of the real title the server writes moments later,
        // and the sidebar kept showing `Case-YYMMDD-N` for a case that had been
        // named (fm#1069). With no entry, the backend title renders.
        const updated = { ...prev };
        updated[realCaseId] = optimisticTitle;
        delete updated[optimisticId];
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

      setActiveCase(newCase);

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
    // Set when this turn moved the case to a new state — see the refresh at the
    // end of this function for why that suppresses the post-turn list refetch.
    let caseStateChanged = false;
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
                // Recorded because a state change makes SidePanelApp's transition
                // effect refresh the case list on its own; the post-turn refresh
                // below stands down rather than asking for the same list twice.
                caseStateChanged = true;
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
            // The conflict means our copy of the case is stale — refresh it
            // from the backend case row.
            void useAppStore.getState().refreshActiveCase(caseId);
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
                // The local turn_number was a PREDICTION (`highestTurn + 1`
                // below); take the backend's, as the agent item already does.
                // A user message and its agent reply share a turn_number by
                // backend design, so both rows land on the same real value.
                // Without this the user row keeps a number that is merely
                // usually right, and the id reconciliation in the delta merge
                // (#213) — which matches on turn AND slot — silently misses it
                // whenever the prediction was off, putting back the duplicate
                // it exists to prevent.
                turn_number: response.turn_number,
                originalId: userMessageId
              } as OptimisticConversationItem;
            } else if (item.id === aiMessageId) {
              return {
                ...item,
                response: response.agent_response,
                turn_number: response.turn_number,
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

      // The backend may have named this case while processing the turn (see
      // POST /cases/{id}/turns). Refetch the list so a title the client never
      // asked for still reaches the sidebar.
      //
      // Not gated on the store: it holds an entry only for cases the user
      // renamed or generated a title for, so "no store entry" does not mean "no
      // server title", and gating on it would skip the refresh for every case
      // loaded from the server.
      //
      // Skipped when the turn changed case_state, because SidePanelApp's
      // transition effect then runs reconcileActiveCaseState, which invalidates
      // the list cache and bumps this same counter itself. Firing both would
      // spend two list GETs to answer one question.
      if (!caseStateChanged) {
        triggerRefreshSessions();
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

    log.debug('OPTIMISTIC MESSAGE SUBMISSION START');

    setSubmitting(true);

    const userMessageId = OptimisticIdGenerator.generateMessageId();
    const aiMessageId = OptimisticIdGenerator.generateMessageId();
    const messageTimestamp = new Date().toISOString();

    let targetCaseId = activeCaseId;

    // Never carry a stale optimistic case id into a turn submit. A prior failed
    // case-create can leave activeCaseId (and faultmaven_current_case) as an
    // unreconciled opt_case_*; POSTing a turn against it 404s. Resolve it via the
    // id-mapping if it was reconciled, otherwise treat as no active case so a
    // fresh real case is created below.
    if (targetCaseId && isOptimisticId(targetCaseId)) {
      targetCaseId = idMappingManager.getRealId(targetCaseId) ?? null;
    }

    if (!targetCaseId) {
      log.debug('No active case, creating case via createOptimisticCaseInBackground');

      try {
        const optimisticCaseId = OptimisticIdGenerator.generateCaseId();

        setActiveCaseId(optimisticCaseId);
        setHasUnsavedNewChat(false);

        const realCaseId = await createOptimisticCaseInBackground(optimisticCaseId, null);

        targetCaseId = realCaseId;

        log.info('Case created and ID reconciled', { optimisticId: optimisticCaseId, realId: targetCaseId });
      } catch (error) {
        log.error('Failed to create case', error);
        // Roll back the optimistic active-case state set above. Creation failed,
        // so no id-mapping exists; leaving activeCaseId as a stale opt_case_*
        // would make the next submit POST a turn against an optimistic id → 404.
        // Clear it (this also removes faultmaven_current_case) and restore the
        // unsaved-new-chat flag so the UI returns to the fresh composer.
        await setActiveCaseId(null);
        setHasUnsavedNewChat(true);
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
