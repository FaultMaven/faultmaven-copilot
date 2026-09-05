import React from 'react';
import { ChatWindow } from './ChatWindow';
import { UnifiedInputBar, TurnPayload } from './UnifiedInputBar';
import { OptimisticConversationItem, PendingOperation } from '../../../lib/optimistic';
import { UserCase } from '../../../lib/api';
import { createLogger } from '../../../lib/utils/logger';

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
  onDocumentView?: (docId: string) => void;
  onNewChat?: () => void;
  hasUnsavedNewChat?: boolean;
  /**
   * Render the transcript and NOTHING to add to it.
   *
   * Not a disabled composer: a disabled field says "you may write here, later",
   * which is not what a shared case means, and the upload affordance beside it
   * would still be there to press.
   */
  readOnly?: boolean;
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
  onDocumentView,
  onNewChat,
  hasUnsavedNewChat,
  readOnly,
  setActiveCase
}) => {
  const currentMessages = activeCaseId ? conversations[activeCaseId] || [] : [];

  // Check if interaction is allowed — terminal cases allow text Q&A but not evidence
  const isTerminal = !!activeCase && (activeCase.state === 'resolved' || activeCase.state === 'closed');
  const canInteract = (!!activeCase || hasUnsavedNewChat);

  // Empty state — dark themed
  if (!activeCaseId && !hasUnsavedNewChat) {
    log.debug('Showing empty state', { reason: 'no active case, no new chat' });
    return (
      <div className="flex items-center justify-center h-full bg-fm-surface">
        <div className="text-center max-w-md p-6">
          <div className="mb-4">
            <img src="/icon/square-transparent.svg" alt="FaultMaven" className="w-12 h-12 mx-auto rounded-lg opacity-60" />
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
          onQuerySubmit={onQuerySubmit}
          onDocumentView={onDocumentView}
          setActiveCase={setActiveCase}
        />
      </div>

      {/* Input Area — absent entirely when the host says this viewer may not
          write. A disabled composer says "you may write here, later", which is
          not what someone else's case means, and the upload affordance beside
          it would still be there to press. */}
      {!readOnly && (
      <UnifiedInputBar
        onQuerySubmit={onQuerySubmit}
        onTurnSubmit={onTurnSubmit}
        loading={loading}
        submitting={submitting}
        disabled={!canInteract}
        disableAttachments={isTerminal}
        placeholder={
          // A DRAFT case — the composer is open, nothing is saved yet, and the
          // user's first message is what creates the case. This arm used to
          // fall through to "Select a case to start chatting…", which is the
          // one instruction that cannot help here: there is nothing to select,
          // the field is enabled, and typing is exactly what is wanted. It is
          // also the state a host lands on with `initialCase: { kind: 'new' }`,
          // so it is now the first thing that host's users read.
          !activeCase && hasUnsavedNewChat
            ? "Describe what's wrong, or paste data to start..."
            : !activeCase
              ? "Select a case to start chatting..."
              : isTerminal
                ? "Ask about this case, or request a report..."
                : "Ask FaultMaven..."
        }
      />
      )}
    </div>
  );
};
