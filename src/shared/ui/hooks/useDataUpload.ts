import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  createCase,
  submitTurn,
  TurnRequest,
  TurnResponse,
  AttachmentResult,
} from '../../../lib/api';
import {
  OptimisticConversationItem,
} from '../../../lib/optimistic';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { classifyError, formatErrorForAlert } from '../../../lib/utils/api-error-handler';
import { createLogger } from '../../../lib/utils/logger';
import type { TurnPayload } from '../components/UnifiedInputBar';

const log = createLogger('useDataUpload');

interface UseDataUploadProps {
  sessionId: string | null;
  activeCaseId: string | undefined;
  conversations: Record<string, OptimisticConversationItem[]>;
  setActiveCaseId: (id: string) => void;
  setHasUnsavedNewChat: (hasUnsaved: boolean) => void;
  setActiveCase: (caseData: any) => void;
  setConversations: React.Dispatch<React.SetStateAction<Record<string, OptimisticConversationItem[]>>>;
  setConversationTitles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTitleSources: React.Dispatch<React.SetStateAction<Record<string, 'user' | 'backend' | 'system'>>>;
  setCaseEvidence: React.Dispatch<React.SetStateAction<Record<string, AttachmentResult[]>>>;
  setRefreshSessions: React.Dispatch<React.SetStateAction<number>>;
}

export function useDataUpload({
  sessionId,
  activeCaseId,
  conversations,
  setActiveCaseId,
  setHasUnsavedNewChat,
  setActiveCase,
  setConversations,
  setConversationTitles,
  setTitleSources,
  setCaseEvidence,
  setRefreshSessions
}: UseDataUploadProps) {
  const [loading, setLoading] = useState(false);

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

          targetCaseId = newCaseId;

          setActiveCaseId(newCaseId);
          setHasUnsavedNewChat(false);

          setActiveCase({
            case_id: newCaseId,
            owner_id: caseData.owner_id,
            title: caseData.title,
            status: caseData.status || 'inquiry',
            created_at: caseData.created_at || new Date().toISOString(),
            updated_at: caseData.updated_at || new Date().toISOString(),
            message_count: 0
          });

          setConversations(prev => ({
            ...prev,
            [newCaseId]: []
          }));

          if (caseData.title) {
            setConversationTitles(prev => ({ ...prev, [newCaseId]: caseData.title }));
            setTitleSources(prev => ({ ...prev, [newCaseId]: 'backend' }));
          }

          await browser.storage.local.set({ faultmaven_current_case: targetCaseId });
          setRefreshSessions(prev => prev + 1);

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
        // Mirror the filename pattern the backend will assign
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
      let turnResponse: TurnResponse;
      try {
        turnResponse = await resilientOperation({
          operation: async () => {
            return await submitTurn(targetCaseId!, turnRequest);
          },
          context: {
            operation: 'turn_submit',
            caseId: targetCaseId!,
            metadata: {
              hasQuery: !!turnRequest.query,
              hasFiles: !!turnRequest.files?.length,
              hasPasted: !!turnRequest.pastedContent
            }
          }
        });
      } catch (error) {
        // Update optimistic AI message to show error
        setConversations(prev => ({
          ...prev,
          [targetCaseId!]: (prev[targetCaseId!] || []).map(item =>
            item.id === aiMessageId
              ? { ...item, response: '', optimistic: false, loading: false, error: true, failed: true } as OptimisticConversationItem
              : item
          )
        }));
        throw error;
      }

      log.info('Turn submitted successfully:', targetCaseId);

      // Step 5: Update optimistic messages with real response data
      // Prefer backend-processed attachments over local file info
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
            } as OptimisticConversationItem;
          }
          if (item.id === aiMessageId) {
            return {
              ...item,
              response: turnResponse.agent_response || "Data uploaded and processed successfully.",
              turn_number: turnResponse.turn_number,
              caseStatus: turnResponse.case_status,
              suggestedActions: turnResponse.suggested_actions ?? null,
              optimistic: false,
              loading: false,
            } as OptimisticConversationItem;
          }
          return item;
        })
      }));

      // Track processed attachments as evidence
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

      return { success: true, message: "" };

    } catch (error) {
      log.error('Turn submission error:', error);

      const errorInfo = classifyError(error, 'turn_submit');
      const friendlyMessage = formatErrorForAlert(errorInfo);

      return {
        success: false,
        message: friendlyMessage
      };
    } finally {
      setLoading(false);
    }
  };

  return {
    handleTurnSubmit,
    uploading: loading
  };
}
