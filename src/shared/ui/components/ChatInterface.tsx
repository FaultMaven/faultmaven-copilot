import React from 'react';
import { ChatWindow } from './ChatWindow';
import { UnifiedInputBar } from './UnifiedInputBar';
import { OptimisticConversationItem, PendingOperation } from '../../../lib/optimistic';
import { UserCase, UploadedData } from '../../../lib/api';
import { usePageContent } from '../hooks/usePageContent';

interface ChatInterfaceProps {
  activeCaseId?: string;
  activeCase: UserCase | null;
  conversations: Record<string, OptimisticConversationItem[]>;
  loading: boolean;
  submitting: boolean;
  onQuerySubmit: (query: string) => Promise<void>;
  onDataUpload: (data: string | File, type: 'text' | 'file' | 'page') => Promise<{ success: boolean; message: string }>;
  failedOperations: PendingOperation[];
  onRetryFailedOperation: (opId: string) => void;
  onDismissFailedOperation: (opId: string) => void;
  getErrorMessageForOperation: (op: PendingOperation) => { title: string; message: string; recoveryHint: string };
  investigationProgress?: Record<string, any>;
  caseEvidence?: Record<string, UploadedData[]>;
  onDocumentView?: (docId: string) => void;
  onGenerateReports?: () => void;
  onNewChat?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  activeCaseId,
  activeCase,
  conversations,
  loading,
  submitting,
  onQuerySubmit,
  onDataUpload,
  failedOperations,
  onRetryFailedOperation,
  onDismissFailedOperation,
  getErrorMessageForOperation,
  investigationProgress,
  caseEvidence,
  onDocumentView,
  onGenerateReports,
  onNewChat
}) => {
  const { handlePageInject } = usePageContent();

  const currentMessages = activeCaseId ? conversations[activeCaseId] || [] : [];
  const currentProgress = activeCaseId ? investigationProgress?.[activeCaseId] : undefined;
  const currentEvidence = activeCaseId ? caseEvidence?.[activeCaseId] : undefined;

  // Check if interaction is allowed
  const canInteract = !!activeCase && 
    activeCase.status !== 'resolved' && 
    activeCase.status !== 'closed';

  if (!activeCaseId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-2">Start a conversation</h2>
          <p className="text-sm text-gray-600 mb-4">Select a chat from the list or create a new one.</p>
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="inline-flex items-center gap-2 py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              New chat
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Failed Operations Alert */}
      {failedOperations.length > 0 && (
        <div className="flex-shrink-0 p-4 space-y-3 bg-white border-b border-gray-100">
          {failedOperations.map((operation) => {
            const errorInfo = getErrorMessageForOperation(operation);
            return (
              <div key={operation.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <h4 className="text-sm font-medium text-yellow-800">{errorInfo.title}</h4>
                    </div>
                    <p className="text-xs text-yellow-700 mt-1">{errorInfo.message}</p>
                    <p className="text-xs text-yellow-600 mt-2 italic">{errorInfo.recoveryHint}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => onRetryFailedOperation(operation.id)}
                      className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 transition-colors font-medium"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => onDismissFailedOperation(operation.id)}
                      className="p-1 text-yellow-600 hover:text-yellow-800 transition-colors"
                      title="Dismiss this error"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chat History Area */}
      <div className="flex-1 overflow-hidden relative">
        <ChatWindow
          conversation={currentMessages}
          activeCase={activeCase}
          loading={loading}
          sessionId={activeCase?.owner_id || null} // Use owner_id as session context if needed
          investigationProgress={currentProgress}
          evidence={currentEvidence}
          onQuerySubmit={onQuerySubmit}
          onDocumentView={onDocumentView}
          onGenerateReports={onGenerateReports}
        />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white p-4">
        <UnifiedInputBar
          onQuerySubmit={onQuerySubmit}
          onDataUpload={onDataUpload}
          onPageInject={handlePageInject}
          loading={loading}
          submitting={submitting}
          disabled={!canInteract}
          placeholder={
            !activeCase 
              ? "Select a case to start chatting..." 
              : !canInteract
                ? "This case is closed. Reopen to continue."
                : "Type a message or / command..."
          }
        />
      </div>
    </div>
  );
};
