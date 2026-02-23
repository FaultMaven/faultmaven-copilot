import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  createCase,
  submitTurn,
  TurnRequest,
  TurnResponse,
  AttachmentResult,
  formatFileSize,
} from '../../../lib/api';
import {
  OptimisticConversationItem,
  OptimisticIdGenerator,
  OptimisticUserCase
} from '../../../lib/optimistic';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { classifyError, formatErrorForAlert } from '../../../lib/utils/api-error-handler';
import { createLogger } from '../../../lib/utils/logger';
import type { TurnPayload } from '../components/UnifiedInputBar';

const log = createLogger('useDataUpload');

interface UseDataUploadProps {
  sessionId: string | null;
  activeCaseId: string | undefined;
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

      // Step 3: Submit via unified /turns endpoint
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
        throw error;
      }

      log.info('Turn submitted successfully:', targetCaseId);

      // Step 4: Build conversation messages
      const attachmentsSummary = turnResponse.attachments_processed
        .map(a => `${a.filename} (${formatFileSize(a.file_size)}) [${a.data_type}]`)
        .join(', ');

      // Build user message text
      const parts: string[] = [];
      if (payload.query?.trim()) {
        parts.push(payload.query.trim());
      }

      const attachmentLabels: string[] = [];
      if (attachmentsSummary) {
        attachmentLabels.push(attachmentsSummary);
      } else {
        // Fallback labels when backend hasn't processed yet
        if (payload.files?.length) {
          attachmentLabels.push(payload.files.map(f => f.name).join(', '));
        }
        if (payload.pastedContent) {
          attachmentLabels.push('pasted data');
        }
      }

      if (attachmentLabels.length > 0) {
        parts.push(`[Attached: ${attachmentLabels.join(', ')}]`);
      }

      const userQuestion = parts.join('\n\n') || 'Submitted data for analysis';

      const userMessage: OptimisticConversationItem = {
        id: `upload-${Date.now()}`,
        question: userQuestion,
        timestamp: new Date().toISOString(),
        turn_number: turnResponse.turn_number,
        optimistic: false
      };

      const aiMessage: OptimisticConversationItem = {
        id: `response-${Date.now()}`,
        response: turnResponse.agent_response || "Data uploaded and processed successfully.",
        timestamp: new Date().toISOString(),
        turn_number: turnResponse.turn_number,
        caseStatus: turnResponse.case_status,
        optimistic: false
      };

      setConversations(prev => ({
        ...prev,
        [targetCaseId!]: [...(prev[targetCaseId!] || []), userMessage, aiMessage]
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
