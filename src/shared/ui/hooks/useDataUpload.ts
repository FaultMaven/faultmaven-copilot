import { useState, useRef, useEffect } from 'react';
import { browser } from 'wxt/browser';
import {
  createCase,
  submitTurn,
  generateCaseTitle,
  TurnRequest,
  TurnResponse,
  AttachmentResult,
} from '../../../lib/api';
import {
  OptimisticConversationItem,
  OptimisticIdGenerator,
  pendingOpsManager,
  PendingOperation,
} from '../../../lib/optimistic';
import { queryClient } from '../../../lib/api/query-client';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { formatErrorForChat } from '../../../lib/utils/api-error-handler';
import { ErrorClassifier } from '../../../lib/errors/classifier';
import { createLogger } from '../../../lib/utils/logger';
import type { ErrorContext } from '../../../lib/errors/types';
import type { UserCase } from '../../../types/case';
import type { TurnPayload } from '../components/UnifiedInputBar';
import { TITLE_GENERATION_THRESHOLD } from './useMessageSubmission';
import { useAppStore } from '../../../lib/state/store';
import { getEpoch } from '../../../lib/state/session-epoch';
import { useError } from '../../../lib/errors';

const log = createLogger('useDataUpload');

export function useDataUpload() {
  const [loading, setLoading] = useState(false);
  const { showError } = useError();

  // Abort in-flight turn submissions (which may poll for up to POLL_MAX_TOTAL_MS)
  // when this hook unmounts, so a detached poll loop doesn't keep hitting the
  // backend. Aborts are treated as silent cancellations, not upload failures.
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
  const conversations = useAppStore((state) => state.conversations);
  const titleSources = useAppStore((state) => state.titleSources);

  // Selected store actions
  const setActiveCaseId = useAppStore((state) => state.setActiveCaseId);
  const setHasUnsavedNewChat = useAppStore((state) => state.setHasUnsavedNewChat);
  const setActiveCase = useAppStore((state) => state.setActiveCase);
  const setConversations = useAppStore((state) => state.setConversations);
  const setConversationTitles = useAppStore((state) => state.setConversationTitles);
  const setTitleSources = useAppStore((state) => state.setTitleSources);
  const setCaseEvidence = useAppStore((state) => state.setCaseEvidence);
  const triggerRefreshSessions = useAppStore((state) => state.triggerRefreshSessions);

  /**
   * Submit the turn via the unified /turns endpoint and, on success, reconcile
   * the optimistic messages + auto-generate a title.
   *
   * Registered as the pending operation's retryFn so a failed turn keeps a retry
   * affordance (parity with useMessageSubmission): on failure it marks the AI
   * item failed WITHOUT rolling back (both messages stay visible) and records the
   * op as failed so getFailedOperationsForUser surfaces the retry button. The
   * stable aiMessageId doubles as the op id and the Idempotency-Key, so a retry
   * re-sends the same turn and the backend dedupes rather than committing twice.
   */
  const submitTurnInBackground = async (
    targetCaseId: string,
    turnRequest: TurnRequest,
    userMessageId: string,
    aiMessageId: string,
    localAttachments: AttachmentResult[],
  ): Promise<{ success: boolean; message: string }> => {
    // Capture the session epoch before the turn round-trip. A logout while the
    // turn is in flight must not let the success handler write the response back
    // into a purged store (issue #132).
    const epoch = getEpoch();

    const controller = new AbortController();
    inFlightControllers.current.add(controller);
    let turnResponse: TurnResponse;
    try {
      turnResponse = await resilientOperation({
        operation: async () => {
          return await submitTurn(targetCaseId, turnRequest, {
            signal: controller.signal,
            // Stable per-turn key so an ambiguous network failure can be safely
            // retried without submitting a second turn (backend dedupes).
            idempotencyKey: aiMessageId,
          });
        },
        context: {
          operation: 'turn_submit',
          caseId: targetCaseId,
          metadata: {
            hasQuery: !!turnRequest.query,
            hasFiles: !!turnRequest.files?.length,
            hasPasted: !!turnRequest.pastedContent
          }
        },
        // Safe to auto-retry an ambiguous network failure: the request carries a
        // stable Idempotency-Key (aiMessageId), so the backend replays the cached
        // response for a resend instead of committing a second turn.
        idempotent: true
      });
    } catch (error) {
      // Caller-initiated cancellation (hook unmounted): return silently. Don't
      // mark the upload failed and don't surface an error for a turn nobody is
      // waiting on.
      if (controller.signal.aborted) {
        return { success: false, message: '' };
      }
      // Mark the AI item failed WITHOUT rolling back: keeping both messages lets
      // the failed-operation banner offer a retry instead of the turn silently
      // vanishing from the conversation. Render the formatted error INTO the
      // bubble (parity with useMessageSubmission) so the failure is visible in
      // context, not just an empty red bubble beside the banner.
      const chatError = formatErrorForChat(ErrorClassifier.classify(error));
      setConversations(prev => ({
        ...prev,
        [targetCaseId]: (prev[targetCaseId] || []).map(item =>
          item.id === aiMessageId
            ? { ...item, response: chatError, optimistic: false, loading: false, error: true, failed: true } as OptimisticConversationItem
            : item
        )
      }));
      const message = error instanceof Error ? error.message : 'Turn submission failed';
      pendingOpsManager.fail(aiMessageId, message, false);
      showError(error, { operation: 'turn_submit' });
      return { success: false, message };
    } finally {
      inFlightControllers.current.delete(controller);
    }

    log.info('Turn submitted successfully', { caseId: targetCaseId, turnNumber: turnResponse.turn_number });

    // The session may have ended while the turn was in flight. Skip every
    // store/storage write below so a resolved turn can't repopulate a
    // conversation the logout purge just cleared.
    if (epoch !== getEpoch()) {
      log.info('Session changed during turn submission — discarding success writes', { caseId: targetCaseId });
      return { success: false, message: '' };
    }

    if (turnResponse.case_state) {
      setActiveCase((prev: UserCase | null) => {
        if (prev && prev.state !== turnResponse.case_state) {
          log.info('Updating active case status from backend', {
            oldStatus: prev.state,
            newStatus: turnResponse.case_state
          });
          return { ...prev, state: turnResponse.case_state as UserCase['state'] };
        }
        return prev;
      });
    }

    queryClient.invalidateQueries({ queryKey: ['caseUI', targetCaseId] });

    // Update optimistic messages with real response data
    const attachments: AttachmentResult[] = turnResponse.attachments_processed.length > 0
      ? turnResponse.attachments_processed
      : localAttachments;

    setConversations(prev => ({
      ...prev,
      [targetCaseId]: (prev[targetCaseId] || []).map(item => {
        if (item.id === userMessageId) {
          return {
            ...item,
            attachments: attachments.length > 0 ? attachments : undefined,
            turn_number: turnResponse.turn_number,
            optimistic: false,
            originalId: userMessageId,
          } as OptimisticConversationItem;
        }
        if (item.id === aiMessageId) {
          return {
            ...item,
            response: turnResponse.agent_response || "Data uploaded and processed successfully.",
            turn_number: turnResponse.turn_number,
            caseStatus: turnResponse.case_state,
            suggestedActions: turnResponse.suggested_actions ?? null,
            optimistic: false,
            loading: false,
            // Clear any error state from a prior failed attempt (#101) so a
            // successful resubmit doesn't render red / get dropped from persist.
            error: false,
            failed: false,
            errorMessage: undefined,
            originalId: aiMessageId,
            metadata: {
              milestones_completed: turnResponse.milestones_completed,
              progress_made: turnResponse.progress_made,
              attachments_processed: turnResponse.attachments_processed,
            },
          } as OptimisticConversationItem;
        }
        return item;
      })
    }));

    if (turnResponse.attachments_processed.length > 0) {
      setCaseEvidence(prev => ({
        ...prev,
        [targetCaseId]: [
          ...(prev[targetCaseId] || []),
          ...turnResponse.attachments_processed
        ]
      }));
    }

    setActiveCaseId(targetCaseId);

    // The turn committed: mark the pending op complete so the retry affordance
    // (if this was a retry) clears.
    pendingOpsManager.complete(aiMessageId);

    const currentTurn = turnResponse.turn_number ?? 0;
    if (currentTurn >= TITLE_GENERATION_THRESHOLD && !titleSources[targetCaseId]) {
      log.info('Turn threshold reached, auto-generating smart title', {
        caseId: targetCaseId,
        turn: currentTurn,
        threshold: TITLE_GENERATION_THRESHOLD
      });
      try {
        const titleResult = await generateCaseTitle(targetCaseId, { max_words: 6 });
        // Re-check the epoch after the title-gen await: a logout during the
        // (multi-second) LLM call must not write the ended session's title back
        // into the purged store, which the subscriber would then persist (#143).
        if (epoch !== getEpoch()) {
          log.info('Session ended during title generation — discarding title write', { caseId: targetCaseId });
        } else if (titleResult.title) {
          setConversationTitles(prev => ({ ...prev, [targetCaseId]: titleResult.title }));
          setTitleSources(prev => ({ ...prev, [targetCaseId]: 'backend' }));
          log.info('Smart title auto-generated', { caseId: targetCaseId, title: titleResult.title });
        }
      } catch (error) {
        log.debug('Auto title generation skipped', { reason: 'insufficient context or error', error });
      }
    }

    return { success: true, message: "" };
  };

  /**
   * Submit a turn with any combination of query, pasted content, and files.
   * Handles case creation if no active case exists.
   */
  const handleTurnSubmit = async (
    payload: TurnPayload
  ): Promise<{ success: boolean; message: string }> => {
    try {
      setLoading(true);

      if (!sessionId) {
        return {
          success: false,
          message: "Please log in first"
        };
      }

      // Capture the session epoch before any network round-trip. A logout while
      // case creation or the turn is in flight must not let the continuations
      // below re-write state into the just-purged store/storage (issue #132).
      const epoch = getEpoch();

      // Step 1: Ensure case exists
      let targetCaseId = activeCaseId;

      if (!targetCaseId) {
        log.info('No active case, creating case via /api/v1/cases');

        try {
          // Stable key for this logical case creation so an ambiguous network
          // failure can be auto-retried without the backend creating a second
          // case. Generated once, OUTSIDE the retry closure, so every retry of
          // this attempt reuses it.
          const caseIdempotencyKey = crypto.randomUUID();
          const caseData = await resilientOperation({
            operation: () => createCase(
              {
                title: null,
                priority: 'medium',
                metadata: {
                  created_via: 'browser_extension',
                  auto_generated: true
                }
              },
              { idempotencyKey: caseIdempotencyKey }
            ),
            context: { operation: 'case_create' },
            idempotent: true,
          });

          const newCaseId = caseData.case_id;
          if (!newCaseId) {
            throw new Error('Backend response missing case_id');
          }

          // Session ended while the case was being created: discard it rather
          // than re-seeding activeCase / faultmaven_current_case post-logout.
          if (epoch !== getEpoch()) {
            log.info('Session changed during case creation — discarding new case', { newCaseId });
            return { success: false, message: '' };
          }

          targetCaseId = newCaseId;

          setActiveCaseId(newCaseId);
          setHasUnsavedNewChat(false);
          setActiveCase(caseData);

          setConversations(prev => ({
            ...prev,
            [newCaseId]: []
          }));

          if (caseData.title) {
            setConversationTitles(prev => ({ ...prev, [newCaseId]: caseData.title }));
          }

          await browser.storage.local.set({ faultmaven_current_case: targetCaseId });
          triggerRefreshSessions();

          log.info('Case created:', targetCaseId);
        } catch (error) {
          log.error('Failed to create case:', error);
          return {
            success: false,
            message: error instanceof Error ? error.message : 'Failed to create case'
          };
        }
      }

      if (!targetCaseId) {
        return { success: false, message: 'No active case' };
      }

      // Step 2: Build TurnRequest from payload
      const turnRequest: TurnRequest = {};

      if (payload.query?.trim()) {
        turnRequest.query = payload.query.trim();
      }

      if (payload.pastedContent?.trim()) {
        turnRequest.pastedContent = payload.pastedContent;
      }

      if (payload.files && payload.files.length > 0) {
        turnRequest.files = payload.files;
      }

      if (payload.inputType) {
        turnRequest.inputType = payload.inputType;
      }

      if (payload.sourceUrl) {
        turnRequest.sourceUrl = payload.sourceUrl;
      }

      // Step 3: Add optimistic messages immediately (instant "Thinking..." feedback)
      const userQuestion = payload.query?.trim() || 'Submitted data for analysis';
      const messageTimestamp = new Date().toISOString();
      const userMessageId = OptimisticIdGenerator.generateMessageId();
      const aiMessageId = OptimisticIdGenerator.generateMessageId();

      // Build local attachments list for immediate display (optimistic, before server responds)
      const localAttachments: AttachmentResult[] = [];

      for (const f of payload.files || []) {
        localAttachments.push({
          evidence_id: '',
          filename: f.name,
          data_type: '',
          file_size: f.size,
          processing_status: 'pending',
          source_type: 'file_upload',
        });
      }

      if (payload.pastedContent?.trim()) {
        const ts = new Date().toISOString()
          .replace(/[-:]/g, '').replace('T', 'T').slice(0, 15);
        const isPage = payload.inputType === 'page_capture';
        localAttachments.push({
          evidence_id: '',
          filename: isPage ? `page-capture-${ts}.txt` : `pasted-content-${ts}.txt`,
          data_type: '',
          file_size: new TextEncoder().encode(payload.pastedContent).length,
          processing_status: 'pending',
          source_type: payload.inputType ?? 'text_paste',
        });
      }

      const existingMessages = conversations[targetCaseId!] || [];
      const highestTurn = existingMessages.reduce((max: number, msg: OptimisticConversationItem) =>
        Math.max(max, msg.turn_number || 0), 0
      );
      const nextTurnNumber = highestTurn + 1;

      const optimisticUserMessage: OptimisticConversationItem = {
        id: userMessageId,
        question: userQuestion,
        attachments: localAttachments.length > 0 ? localAttachments : undefined,
        timestamp: messageTimestamp,
        turn_number: nextTurnNumber,
        optimistic: true,
        loading: false,
      };

      const optimisticAiMessage: OptimisticConversationItem = {
        id: aiMessageId,
        question: '',
        response: '',
        timestamp: messageTimestamp,
        turn_number: nextTurnNumber,
        optimistic: true,
        loading: true,
      };

      setConversations(prev => ({
        ...prev,
        [targetCaseId!]: [...(prev[targetCaseId!] || []), optimisticUserMessage, optimisticAiMessage]
      }));

      // Step 4: Register a pending operation so a failed turn keeps a retry
      // affordance in the failed-operation banner (parity with
      // useMessageSubmission). The aiMessageId is the op id + Idempotency-Key, so
      // the retry re-sends the same turn and the backend dedupes; the turnRequest
      // (including its File objects) is captured in the retryFn closure and thus
      // survives the input bar clearing its staged file state on this failure.
      const pendingOperation: PendingOperation = {
        id: aiMessageId,
        type: 'submit_query',
        status: 'pending',
        optimisticData: { caseId: targetCaseId, query: userQuestion },
        rollbackFn: () => {
          setConversations(prev => ({
            ...prev,
            [targetCaseId!]: (prev[targetCaseId!] || []).filter(
              item => item.id !== userMessageId && item.id !== aiMessageId
            )
          }));
        },
        retryFn: async () => {
          await submitTurnInBackground(targetCaseId!, turnRequest, userMessageId, aiMessageId, localAttachments);
        },
        createdAt: Date.now(),
      };
      pendingOpsManager.add(pendingOperation);

      // Step 5: Submit the turn and reconcile on success. Self-manages the
      // pending op (complete on success, fail-without-rollback on failure) and
      // returns the { success, message } contract UnifiedInputBar expects.
      return await submitTurnInBackground(targetCaseId!, turnRequest, userMessageId, aiMessageId, localAttachments);

    } catch (error) {
      log.error('Turn submission error:', error);
      showError(error, { operation: 'turn_submit' });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Turn submission failed'
      };
    } finally {
      setLoading(false);
    }
  };

  return {
    handleTurnSubmit,
    uploading: loading,
    abortInFlight
  };
}
