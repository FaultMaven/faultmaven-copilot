// src/shared/ui/layouts/ContentArea.tsx
/**
 * Content Area Component
 *
 * Manages the main content area for chat-only UI:
 * - Copilot Chat (active case or new chat)
 *
 * Knowledge Base management now handled via dashboard (see CollapsibleNavigation.tsx)
 *
 * Phase 1, Week 1 implementation (updated for Universal Split Architecture)
 */

import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ChatWindow } from '../components/ChatWindow';
import type { UserCase, InvestigationProgress, UploadedData } from '../../../lib/api';

export interface ContentAreaProps {
  // Active view (chat-only, no KB tabs)
  activeTab: 'copilot';

  // Chat state
  activeCaseId?: string;
  activeCase: UserCase | null;
  conversations: Record<string, any[]>;
  loading: boolean;
  submitting: boolean;
  sessionId: string | null;
  hasUnsavedNewChat: boolean;
  investigationProgress: Record<string, InvestigationProgress>;

  // Evidence state (Phase 3 Week 7)
  caseEvidence: Record<string, UploadedData[]>;

  // Failed operations for error display
  failedOperations: any[];

  // Chat callbacks
  onQuerySubmit: (query: string) => void;
  onDataUpload: (data: string | File, dataSource: "text" | "file" | "page") => Promise<{ success: boolean; message: string }>;
  onDocumentView?: (documentId: string) => void;
  onGenerateReports?: () => void;
  onNewChat: () => void;
  onRetryFailedOperation: (operationId: string) => void;
  onDismissFailedOperation: (operationId: string) => void;
  getErrorMessageForOperation: (operation: any) => { title: string; message: string; recoveryHint: string };
}

/**
 * ContentArea Component (Memoized)
 *
 * Performance optimization: Only re-render when props actually change.
 * Custom comparison prevents re-renders from function reference changes.
 */
const ContentAreaComponent = ({
  activeTab,
  activeCaseId,
  activeCase,
  conversations,
  loading,
  submitting,
  sessionId,
  hasUnsavedNewChat,
  investigationProgress,
  caseEvidence,
  failedOperations,
  onQuerySubmit,
  onDataUpload,
  onDocumentView,
  onGenerateReports,
  onNewChat,
  onRetryFailedOperation,
  onDismissFailedOperation,
  getErrorMessageForOperation,
}: ContentAreaProps) => {
  // Render chat content (copilot tab)
  const renderChatContent = () => {
    // Show empty state if no active case and no new chat
    if (!activeCaseId && !hasUnsavedNewChat) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">Start a conversation</h2>
            <p className="text-sm text-gray-600 mb-4">Select a chat from the list or create a new one.</p>
            <button
              onClick={onNewChat}
              className="inline-flex items-center gap-2 py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
            >
              New chat
            </button>
          </div>
        </div>
      );
    }

    return (
      <ErrorBoundary
        fallback={
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">Error loading chat</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Retry
            </button>
          </div>
        }
      >
        <div className="h-full flex flex-col">
          {/* Failed Operations Alert */}
          {failedOperations.length > 0 && (
            <div className="flex-shrink-0 p-4 space-y-3">
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

          {/* Main Chat Window */}
          <div className="flex-1 min-h-0">
            <ChatWindow
              conversation={conversations[activeCaseId || ''] || []}
              activeCase={activeCase}
              loading={loading}
              submitting={submitting}
              sessionId={sessionId}
              isNewUnsavedChat={hasUnsavedNewChat}
              investigationProgress={activeCaseId ? investigationProgress[activeCaseId] : null}
              evidence={activeCaseId ? caseEvidence[activeCaseId] : undefined}
              onQuerySubmit={onQuerySubmit}
              onDataUpload={onDataUpload}
              onDocumentView={onDocumentView}
              onGenerateReports={onGenerateReports}
              className="h-full"
            />
          </div>
        </div>
      </ErrorBoundary>
    );
  };

  // Main content area - chat-only (no tabs)
  // KB management now handled via external dashboard
  return (
    <div className="flex-1 flex flex-col min-w-0 max-w-none">
      <div className="flex-1 overflow-y-auto">
        {renderChatContent()}
      </div>
    </div>
  );
};

/**
 * Custom comparison function for React.memo()
 *
 * Prevents re-renders when:
 * - Function references change but content is same (callbacks)
 * - Non-visual state changes that don't affect this component
 */
const arePropsEqual = (prevProps: ContentAreaProps, nextProps: ContentAreaProps): boolean => {
  // Always re-render on tab change
  if (prevProps.activeTab !== nextProps.activeTab) return false;

  // Always re-render on case change
  if (prevProps.activeCaseId !== nextProps.activeCaseId) return false;

  // Re-render on loading state changes
  if (prevProps.loading !== nextProps.loading) return false;
  if (prevProps.submitting !== nextProps.submitting) return false;
  if (prevProps.hasUnsavedNewChat !== nextProps.hasUnsavedNewChat) return false;

  // Re-render on conversation content changes
  const prevConv = prevProps.conversations[prevProps.activeCaseId || ''] || [];
  const nextConv = nextProps.conversations[nextProps.activeCaseId || ''] || [];
  if (prevConv.length !== nextConv.length) return false;

  // Re-render on failed operations changes
  if (prevProps.failedOperations.length !== nextProps.failedOperations.length) return false;

  // Re-render on active case object changes (deep comparison by case_id)
  if (prevProps.activeCase?.case_id !== nextProps.activeCase?.case_id) return false;

  // Re-render on investigation progress changes for active case
  if (prevProps.activeCaseId && nextProps.activeCaseId) {
    const prevProgress = prevProps.investigationProgress[prevProps.activeCaseId];
    const nextProgress = nextProps.investigationProgress[nextProps.activeCaseId];
    if (prevProgress?.phase !== nextProgress?.phase) return false;
    if (prevProgress?.ooda_iteration !== nextProgress?.ooda_iteration) return false;
    if (prevProgress?.case_status !== nextProgress?.case_status) return false;
  }

  // Phase 3 Week 7: Re-render on evidence changes for active case
  if (prevProps.activeCaseId && nextProps.activeCaseId) {
    const prevEvidence = prevProps.caseEvidence[prevProps.activeCaseId] || [];
    const nextEvidence = nextProps.caseEvidence[nextProps.activeCaseId] || [];
    if (prevEvidence.length !== nextEvidence.length) return false;
  }

  // Ignore function reference changes (callbacks are stable from parent)
  return true;
};

export const ContentArea = React.memo(ContentAreaComponent, arePropsEqual);
