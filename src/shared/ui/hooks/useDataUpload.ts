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
} from '../../../lib/optimistic';
import { queryClient } from '../../../lib/api/query-client';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
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
          const caseData = await createCase({
            title: null,
            priority: 'medium',
            metadata: {
              created_via: 'browser_extension',
              auto_generated: true
            }
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
      const userMessageId = `upload-${Date.now()}`;
      const aiMessageId = `response-${Date.now()}`;

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

      // Step 4: Submit via unified /turns endpoint
      const controller = new AbortController();
      inFlightControllers.current.add(controller);
      let turnResponse: TurnResponse;
      try {
        turnResponse = await resilientOperation({
          operation: async () => {
            return await submitTurn(targetCaseId!, turnRequest, { signal: controller.signal });
          },
          context: {
            operation: 'turn_submit',
            caseId: targetCaseId!,
            metadata: {
              hasQuery: !!turnRequest.query,
              hasFiles: !!turnRequest.files?.length,
              hasPasted: !!turnRequest.pastedContent
            }
          },
          // A turn submission is a non-idempotent POST: never auto-retry an
          // ambiguous network failure (the turn may already have committed).
          idempotent: false
        });
      } catch (error) {
        // Caller-initiated cancellation (hook unmounted): return silently.
        // Don't mark the upload failed and don't rethrow — rethrowing would hit
        // the outer catch and pop an error toast for a turn nobody is waiting on.
        if (controller.signal.aborted) {
          return { success: false, message: '' };
        }
        setConversations(prev => ({
          ...prev,
          [targetCaseId!]: (prev[targetCaseId!] || []).map(item =>
            item.id === aiMessageId
              ? { ...item, response: '', optimistic: false, loading: false, error: true, failed: true } as OptimisticConversationItem
              : item
          )
        }));
        throw error;
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

      // Step 5: Update optimistic messages with real response data
      const attachments: AttachmentResult[] = turnResponse.attachments_processed.length > 0
        ? turnResponse.attachments_processed
        : localAttachments;

      setConversations(prev => ({
        ...prev,
        [targetCaseId!]: (prev[targetCaseId!] || []).map(item => {
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
          [targetCaseId!]: [
            ...(prev[targetCaseId!] || []),
            ...turnResponse.attachments_processed
          ]
        }));
      }

      setActiveCaseId(targetCaseId);

      const currentTurn = turnResponse.turn_number ?? 0;
      if (currentTurn >= TITLE_GENERATION_THRESHOLD && !titleSources[targetCaseId]) {
        log.info('Turn threshold reached, auto-generating smart title', {
          caseId: targetCaseId,
          turn: currentTurn,
          threshold: TITLE_GENERATION_THRESHOLD
        });
        try {
          const titleResult = await generateCaseTitle(targetCaseId, { max_words: 6 });
          if (titleResult.title) {
            setConversationTitles(prev => ({ ...prev, [targetCaseId!]: titleResult.title }));
            setTitleSources(prev => ({ ...prev, [targetCaseId!]: 'backend' }));
            log.info('Smart title auto-generated', { caseId: targetCaseId, title: titleResult.title });
          }
        } catch (error) {
          log.debug('Auto title generation skipped', { reason: 'insufficient context or error', error });
        }
      }

      return { success: true, message: "" };

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
