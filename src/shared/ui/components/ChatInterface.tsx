import React from 'react';
import { ChatWindow } from './ChatWindow';
import { UnifiedInputBar, TurnPayload } from './UnifiedInputBar';
import { OptimisticConversationItem, PendingOperation } from '../../../lib/optimistic';
import { UserCase, UploadedData } from '../../../lib/api';
import { usePageContent } from '../hooks/usePageContent';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('ChatInterface');

interface ChatInterfaceProps {
  activeCaseId?: string;
  activeCase: UserCase | null;
  conversations: Record<string, OptimisticConversationItem[]>;
  loading: boolean;
  submitting: boolean;
  sessionId: string | null;
  onQuerySubmit: (query: string) => Promise<void>;
  onTurnSubmit: (payload: TurnPayload) => Promise<{ success: boolean; message: string }>;
  failedOperations: PendingOperation[];
  onRetryFailedOperation: (opId: string) => void;
  onDismissFailedOperation: (opId: string) => void;
  getErrorMessageForOperation: (op: PendingOperation) => { title: string; message: string; recoveryHint: string };
  investigationProgress?: Record<string, any>;
  caseEvidence?: Record<string, UploadedData[]>;
  onDocumentView?: (docId: string) => void;
  onGenerateReports?: () => void;
  onNewChat?: () => void;
  hasUnsavedNewChat?: boolean;
  setActiveCase?: (updater: (prev: UserCase | null) => UserCase | null) => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  activeCaseId,
  activeCase,
  conversations,
  loading,
  submitting,
  sessionId,
  onQuerySubmit,
  onTurnSubmit,
  failedOperations,
  onRetryFailedOperation,
  onDismissFailedOperation,
  getErrorMessageForOperation,
  investigationProgress,
  caseEvidence,
  onDocumentView,
  onGenerateReports,
  onNewChat,
  hasUnsavedNewChat,
  setActiveCase
}) => {
  const { handlePageInject } = usePageContent();

  const currentMessages = activeCaseId ? conversations[activeCaseId] || [] : [];
  const currentProgress = activeCaseId ? investigationProgress?.[activeCaseId] : undefined;
  const currentEvidence = activeCaseId ? caseEvidence?.[activeCaseId] : undefined;

  // Check if interaction is allowed
  const canInteract = (!!activeCase &&
    activeCase.status !== 'resolved' &&
    activeCase.status !== 'closed') || hasUnsavedNewChat;

  // Empty state — dark themed
  if (!activeCaseId && !hasUnsavedNewChat) {
    log.debug('Showing empty state', { reason: 'no active case, no new chat' });
    return (
      <div className="flex items-center justify-center h-full bg-fm-surface">
        <div className="text-center max-w-md p-6">
          <div className="mb-4">
            <img src="/icon/square-dark.svg" alt="FaultMaven" className="w-12 h-12 mx-auto rounded-lg opacity-60" />
          </div>
          <h2 className="text-base font-semibold text-fm-text-primary mb-2">Start a new case</h2>
          <p className="text-sm text-fm-text-tertiary mb-4">Select a case from the list or create a new one.</p>
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="inline-flex items-center gap-2 py-2 px-4 bg-fm-accent text-fm-bg rounded-md hover:opacity-90 text-sm font-medium"
            >
              + New Case
            </button>
          )}
        </div>
      </div>
    );
  }

  log.debug('Rendering chat interface', { activeCaseId, hasUnsavedNewChat, canInteract });

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Failed Operations Alert */}
      {failedOperations.length > 0 && (
        <div className="flex-shrink-0 p-4 space-y-2 bg-fm-surface border-b border-fm-border">
          {failedOperations.map((operation) => {
            const errorInfo = getErrorMessageForOperation(operation);
            return (
              <div key={operation.id} className="bg-fm-warning-bg border border-fm-warning-border rounded-md p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-fm-warning">{errorInfo.title}</h4>
                    <p className="text-xs text-fm-text-tertiary mt-1">{errorInfo.message}</p>
                    <p className="text-xs text-fm-text-secondary mt-1 italic">{errorInfo.recoveryHint}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => onRetryFailedOperation(operation.id)}
                      className="px-3 py-1 text-xs bg-fm-elevated text-fm-warning rounded hover:bg-fm-surface transition-colors font-medium"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => onDismissFailedOperation(operation.id)}
                      className="text-fm-text-tertiary hover:text-fm-text-primary transition-colors"
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chat History Area */}
      <div className="flex-1 overflow-hidden relative bg-fm-canvas min-h-0">
        <ChatWindow
          conversation={currentMessages}
          activeCase={activeCase}
          loading={loading}
          sessionId={sessionId}
          investigationProgress={currentProgress}
          evidence={currentEvidence}
          onQuerySubmit={onQuerySubmit}
          onDocumentView={onDocumentView}
          onGenerateReports={onGenerateReports}
          setActiveCase={setActiveCase}
        />
      </div>

      {/* Input Area */}
      <UnifiedInputBar
        onQuerySubmit={onQuerySubmit}
        onTurnSubmit={onTurnSubmit}
        onPageInject={handlePageInject}
        loading={loading}
        submitting={submitting}
        disabled={!canInteract}
        placeholder={
          !activeCase
            ? "Select a case to start chatting..."
            : !canInteract
              ? "This case is closed. Reopen to continue."
              : "Ask FaultMaven..."
        }
      />
    </div>
  );
};
