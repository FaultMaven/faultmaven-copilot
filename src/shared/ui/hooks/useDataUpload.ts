import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  createCase,
  uploadDataToCase,
  SourceMetadata,
  formatFileSize,
  UploadedData
} from '../../../lib/api';
import {
  OptimisticConversationItem,
  OptimisticIdGenerator,
  OptimisticUserCase
} from '../../../lib/optimistic';
import { resilientOperation } from '../../../lib/utils/resilient-operation';
import { classifyError, formatErrorForAlert } from '../../../lib/utils/api-error-handler';
import { createLogger } from '../../../lib/utils/logger';

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
  setCaseEvidence: React.Dispatch<React.SetStateAction<Record<string, UploadedData[]>>>;
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

  // Helper: Generate timestamp for filenames
  const generateTimestamp = (): string => {
    const now = new Date();
    return now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .substring(0, 15); // YYYYMMDD-HHMMSS
  };

  // Helper: Extract short URL identifier from full URL
  const extractShortUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, '');
      return hostname.substring(0, 20).replace(/\./g, '-');
    } catch (error) {
      return 'webpage';
    }
  };

  const handleDataUpload = async (
    data: string | File,
    dataSource: "text" | "file" | "page"
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
        log.info('No active case, creating case via /api/v1/cases (v2.0)');

        try {
          // Let backend auto-generate title per API contract
          // NOTE: Must use `null` not `undefined` - JSON.stringify strips undefined
          const caseData = await createCase({
            title: null,  // null triggers backend auto-generation (Case-MMDD-N format)
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

          // Update UI
          setActiveCaseId(newCaseId);
          setHasUnsavedNewChat(false);

          setActiveCase({
            case_id: newCaseId,
            owner_id: caseData.owner_id,
            title: caseData.title,  // Backend MUST provide title per contract
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

          log.info('Case created via v2.0 API:', targetCaseId);
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

      // Capture page URL FIRST
      let capturedUrl: string | undefined;
      if (dataSource === 'page') {
        try {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.url) {
            capturedUrl = tab.url;
          }
        } catch (err) {
          log.warn('Could not capture page URL:', err);
        }
      }

      // Convert to File
      let fileToUpload: File;
      if (data instanceof File) {
        fileToUpload = data;
      } else {
        const blob = new Blob([data], { type: 'text/plain' });
        const timestamp = generateTimestamp();
        let filename: string;

        if (dataSource === 'page') {
          const shortUrl = capturedUrl ? extractShortUrl(capturedUrl) : 'webpage';
          filename = `page-content-${shortUrl}.html`;
        } else {
          filename = `text-data-${timestamp}.txt`;
        }

        fileToUpload = new File([blob], filename, { type: 'text/plain' });
      }

      const sourceMetadata: SourceMetadata = {
        source_type: dataSource === 'file' ? 'file_upload'
          : dataSource === 'page' ? 'page_capture'
            : 'text_paste'
      };

      if (capturedUrl) {
        sourceMetadata.source_url = capturedUrl;
        sourceMetadata.captured_at = new Date().toISOString();
      }

      // Step 2: Upload data
      let uploadResponse;
      try {
        uploadResponse = await resilientOperation({
          operation: async () => {
            return await uploadDataToCase(
              targetCaseId!,
              sessionId,
              fileToUpload,
              sourceMetadata
            );
          },
          context: {
            operation: 'data_upload',
            caseId: targetCaseId!,
            metadata: { fileName: fileToUpload.name, size: fileToUpload.size }
          }
        });
      } catch (error) {
        throw error;
      }

      log.info('Data uploaded successfully to case:', targetCaseId);

      // Generate messages
      const dataTypeBadge = uploadResponse.data_type ? ` [${uploadResponse.data_type}]` : '';
      const compressionInfo = uploadResponse.classification?.compression_ratio
        ? ` (${uploadResponse.classification.compression_ratio.toFixed(1)}x compressed)`
        : '';

      const userMessage: OptimisticConversationItem = {
        id: `upload-${Date.now()}`,
        question: `📎 Uploaded: ${uploadResponse.filename || fileToUpload.name} (${formatFileSize(uploadResponse.file_size || 0)})${dataTypeBadge}${compressionInfo}`,
        timestamp: uploadResponse.uploaded_at || new Date().toISOString(),
        turn_number: uploadResponse.turn_number,
        optimistic: false
      };

      const aiMessage: OptimisticConversationItem = {
        id: `response-${Date.now()}`,
        response: uploadResponse.agent_response || "Data uploaded and processed successfully.",
        timestamp: new Date().toISOString(),
        turn_number: uploadResponse.turn_number,
        caseStatus: uploadResponse.case_status,
        optimistic: false
      };

      setConversations(prev => ({
        ...prev,
        [targetCaseId!]: [...(prev[targetCaseId!] || []), userMessage, aiMessage]
      }));

      setCaseEvidence(prev => ({
        ...prev,
        [targetCaseId!]: [...(prev[targetCaseId!] || []), uploadResponse]
      }));

      setActiveCaseId(targetCaseId);

      return { success: true, message: "" };

    } catch (error) {
      log.error('Data upload error:', error);

      const errorInfo = classifyError(error, 'data_upload');
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
    handleDataUpload,
    uploading: loading
  };
}
