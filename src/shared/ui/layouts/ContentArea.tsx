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
import { ChatInterface } from '../components/ChatInterface';
import type { UserCase, InvestigationProgress, UploadedData } from '../../../lib/api';
import type { OptimisticConversationItem } from '../../../lib/optimistic';

export interface ContentAreaProps {
  // Active view (chat-only, no KB tabs)
  activeTab: 'copilot';

  // Chat state
  activeCaseId?: string;
  activeCase: UserCase | null;
  conversations: Record<string, OptimisticConversationItem[]>;
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
  onQuerySubmit: (query: string) => Promise<void>;
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
    console.log('[ContentArea] Rendering chat content:', {
      activeCaseId,
      hasUnsavedNewChat,
      shouldShowEmptyState: !activeCaseId && !hasUnsavedNewChat,
      shouldShowChat: activeCaseId || hasUnsavedNewChat
    });

    // Show empty state if no active case and no new chat
    if (!activeCaseId && !hasUnsavedNewChat) {
      console.log('[ContentArea] Showing empty state');
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
          <ChatInterface
            activeCaseId={activeCaseId}
            activeCase={activeCase}
            conversations={conversations}
            loading={loading}
            submitting={submitting}
            sessionId={sessionId}
            onQuerySubmit={onQuerySubmit}
            onDataUpload={onDataUpload}
            failedOperations={failedOperations}
            onRetryFailedOperation={onRetryFailedOperation}
            onDismissFailedOperation={onDismissFailedOperation}
            getErrorMessageForOperation={getErrorMessageForOperation}
            investigationProgress={investigationProgress}
            caseEvidence={caseEvidence}
            onDocumentView={onDocumentView}
            onGenerateReports={onGenerateReports}
            onNewChat={onNewChat}
            hasUnsavedNewChat={hasUnsavedNewChat}
          />
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
