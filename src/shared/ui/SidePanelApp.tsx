// src/shared/ui/SidePanelApp.tsx
import React, { useState, useEffect } from "react";
import { browser } from "wxt/browser";
import { ErrorHandlerProvider, useErrorHandler, useError } from "../../lib/errors";
import { ToastContainer } from "./components/Toast";
import { ErrorModal } from "./components/ErrorModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { AuthScreen } from "./components/AuthScreen";
import { capabilitiesManager, type BackendCapabilities } from "../../lib/capabilities";
import { createLogger } from "../../lib/utils/logger";
import DocumentDetailsModal from "./components/DocumentDetailsModal";

const log = createLogger('SidePanelApp');
import { ConflictResolutionModal, ConflictResolution } from "./components/ConflictResolutionModal";
import { ReportGenerationDialog } from "./components/ReportGenerationDialog";
import { getKnowledgeDocument, createCase, CreateCaseRequest, updateCaseTitle, getCaseConversation } from "../../lib/api";
import { isOptimisticId } from "../../lib/utils/data-integrity";
import { conflictResolver, ConflictDetectionResult, MergeResult, OptimisticConversationItem, OptimisticUserCase, PendingOperation, idMappingManager } from "../../lib/optimistic";

// Layouts
import { CollapsibleNavigation, ContentArea } from "./layouts";

// Hooks
import { useAuth } from "./hooks/useAuth";
import { useSessionManagement } from "./hooks/useSessionManagement";
import { useCaseManagement } from "./hooks/useCaseManagement";
import { useDataRecovery } from "./hooks/useDataRecovery";
import { usePendingOperations } from "./hooks/usePendingOperations";
import { useMessageSubmission } from "./hooks/useMessageSubmission";
import { useBatchedPersistence } from "./hooks/useBatchedPersistence";
import { useDataUpload } from "./hooks/useDataUpload";

// Wrapper component that provides error handling context
export default function SidePanelApp() {
  return (
    <ErrorHandlerProvider>
      <SidePanelAppContent />
    </ErrorHandlerProvider>
  );
}

// Main app content with error handler integration
function SidePanelAppContent() {
  const { getErrorsByType, dismissError } = useErrorHandler();
  const { showError } = useError();

  // --- UI State ---
  const [activeTab, setActiveTab] = useState<'copilot'>('copilot');
  const [hasCompletedFirstRun, setHasCompletedFirstRun] = useState<boolean | null>(null);

  // --- Auth & Session ---
  const { isAuthenticated, isAdmin, logout, authError } = useAuth();
  // Only initialize session management after first-run is complete
  // This prevents race condition where session tries to connect to API before storage is configured
  const shouldInitializeSession = hasCompletedFirstRun === true;
  const { sessionId, refreshSession, clearSession } = useSessionManagement(shouldInitializeSession);
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const [initializingCapabilities, setInitializingCapabilities] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasUnsavedNewChat, setHasUnsavedNewChat] = useState(false);
  const [refreshSessions, setRefreshSessions] = useState(0);
  
  // --- Data State ---
  const [conversations, setConversations] = useState<Record<string, OptimisticConversationItem[]>>({});
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({});
  const [titleSources, setTitleSources] = useState<Record<string, 'user' | 'backend' | 'system'>>({});
  const [pendingOperations, setPendingOperations] = useState<Record<string, PendingOperation>>({});
  const [optimisticCases, setOptimisticCases] = useState<OptimisticUserCase[]>([]);
  const [pinnedCases, setPinnedCases] = useState<Set<string>>(new Set());
  const [loadedConversationIds, setLoadedConversationIds] = useState<Set<string>>(new Set());
  const [activeCase, setActiveCase] = useState<any | null>(null); // Should be UserCase
  const [investigationProgress, setInvestigationProgress] = useState<Record<string, any>>({});
  const [caseEvidence, setCaseEvidence] = useState<Record<string, any[]>>({}); // Should be UploadedData[]

  // --- Case Management ---
  const {
    currentCaseId: activeCaseId,
    setActiveCase: setActiveCaseId
  } = useCaseManagement(sessionId);

  // --- Data Recovery ---
  const { isRecovering } = useDataRecovery(
    (recoveredData) => {
      setConversationTitles(recoveredData.conversationTitles);
      setTitleSources(recoveredData.titleSources);
      setConversations(recoveredData.conversations);
      setPendingOperations(recoveredData.pendingOperations);
      setOptimisticCases(recoveredData.optimisticCases);
      setPinnedCases(recoveredData.pinnedCases);
    },
    (error) => showError(error)
  );

  // --- Persistence ---
  useBatchedPersistence({
    conversationTitles,
    titleSources,
    conversations,
    pendingOperations,
    optimisticCases,
    pinnedCases: Array.from(pinnedCases)
  });

  // --- Pending Operations ---
  const {
    getFailedOperationsForUser,
    handleUserRetry,
    handleDismissFailedOperation,
    getErrorMessageForOperation
  } = usePendingOperations(activeCaseId || undefined, showError);

  // --- Conflict Resolution State ---
  const [conflictResolutionData, setConflictResolutionData] = useState<{
    isOpen: boolean;
    conflict: ConflictDetectionResult | null;
    localData: any;
    remoteData: any;
    mergeResult?: MergeResult<any>;
    resolveCallback?: (resolution: ConflictResolution) => void;
  }>({
    isOpen: false,
    conflict: null,
    localData: null,
    remoteData: null
  });

  const showConflictResolution = (
    conflict: ConflictDetectionResult,
    localData: any,
    remoteData: any,
    mergeResult?: MergeResult<any>
  ): Promise<ConflictResolution> => {
    return new Promise((resolve) => {
      setConflictResolutionData({
        isOpen: true,
        conflict,
        localData,
        remoteData,
        mergeResult,
        resolveCallback: resolve
      });
    });
  };

  // --- Message Submission ---
  const { submitting, handleQuerySubmit } = useMessageSubmission({
    sessionId,
    activeCaseId: activeCaseId || undefined,
    hasUnsavedNewChat,
    conversations,
    titleSources,
    setActiveCaseId,
    setHasUnsavedNewChat,
    setConversations,
    setActiveCase,
    setOptimisticCases,
    setConversationTitles,
    setTitleSources,
    setInvestigationProgress,
    createOptimisticCaseInBackground: async (optimisticId, title) => {
      try {
        log.info('Creating case on backend', { optimisticId, title });

        // Create the case on the backend
        // Backend auto-generates title in Case-MMDD-N format per API contract
        // NOTE: Must use `null` not `undefined` - JSON.stringify strips undefined
        const caseRequest: CreateCaseRequest = {
          title: title || null,  // null triggers backend auto-generation
          priority: 'low'
        };

        const newCase = await createCase(caseRequest);
        const realCaseId = newCase.case_id;

        log.info('Case created on backend', { optimisticId, realCaseId });

        // Update ID mapping
        idMappingManager.addMapping(optimisticId, realCaseId);

        // Replace optimistic ID with real ID in all state
        setActiveCaseId(realCaseId);

        // Update conversations - move from optimistic ID to real ID
        setConversations(prev => {
          const optimisticConversation = prev[optimisticId];
          if (!optimisticConversation) return prev;

          const updated = { ...prev };
          delete updated[optimisticId];
          updated[realCaseId] = optimisticConversation;
          return updated;
        });

        // Update conversation titles
        setConversationTitles(prev => {
          const updated = { ...prev };

          // Backend MUST provide title per API contract (openapi.locked.yaml:5909)
          // "Case title (optional, auto-generated if not provided)"
          updated[realCaseId] = newCase.title;

          // Remove optimistic ID if different
          if (optimisticId !== realCaseId && updated[optimisticId]) {
            delete updated[optimisticId];
          }

          return updated;
        });

        // Update title sources
        setTitleSources(prev => {
          const optimisticSource = prev[optimisticId];
          if (!optimisticSource) return prev;

          const updated = { ...prev };
          delete updated[optimisticId];
          updated[realCaseId] = 'backend';
          return updated;
        });

        // Remove optimistic case (real case will come from getUserCases() API)
        setOptimisticCases(prev => {
          // Remove the reconciled optimistic case
          // Real cases are loaded separately via getUserCases() API
          return prev.filter(c => c.case_id !== optimisticId);
        });

        // Update active case
        setActiveCase(newCase);

        // Persist to storage
        await browser.storage.local.set({
          faultmaven_current_case: realCaseId
        });

        log.info('Case ID reconciliation completed', { optimisticId, realCaseId });

        // Trigger case list refresh to load the new case from backend
        setRefreshSessions(prev => prev + 1);

        // Return the real case ID for immediate use
        return realCaseId;

      } catch (error) {
        log.error('Failed to create case on backend', error);
        throw error;
      }
    },
    refreshSession: async () => {
        return refreshSession();
    },
    showError,
    showErrorWithRetry: (error, retryFn, context) => {
        // Implement retry logic wrapper if needed, or pass directly
        showError(error instanceof Error ? error.message : String(error));
    },
    showConflictResolution
  });

  // --- Data Upload ---
  const { handleDataUpload, uploading: isUploading } = useDataUpload({
    sessionId,
    activeCaseId: activeCaseId || undefined,
    setActiveCaseId,
    setHasUnsavedNewChat,
    setActiveCase,
    setConversations,
    setConversationTitles,
    setTitleSources,
    setCaseEvidence,
    setRefreshSessions
  });

  // --- UI Handlers ---
  
  // Initialize first-run status and capabilities
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // First, load first-run status from storage
        const stored = await browser.storage.local.get(['hasCompletedFirstRun', 'apiEndpoint']);
        const completedFirstRun = stored.hasCompletedFirstRun || false;

        setHasCompletedFirstRun(completedFirstRun);

        // If first-run not completed, skip capabilities loading
        if (!completedFirstRun) {
          setInitializingCapabilities(false);
          return;
        }

        // Derive API URL from Dashboard URL for capabilities fetch
        // Note: apiEndpoint now stores Dashboard URL, but capabilities endpoint is on API
        const dashboardUrl = stored.apiEndpoint || 'https://app.faultmaven.ai';
        const apiEndpoint = dashboardUrl.includes('localhost') || dashboardUrl.includes('127.0.0.1')
          ? dashboardUrl.replace(':3333', ':8090')
          : dashboardUrl.replace('app.', 'api.');

        // Load backend capabilities
        const caps = await capabilitiesManager.fetch(apiEndpoint);
        setCapabilities(caps);
        setCapabilitiesError(null);
      } catch (error) {
        log.error('Failed to initialize app:', error);
        setCapabilitiesError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setInitializingCapabilities(false);
      }
    };

    initializeApp();
  }, []); // Run once on mount

  // Handle responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 600) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleAuthSuccess = async () => {
    // Auth successful - wait a moment for storage to sync, then check auth state
    log.info('Authentication successful, checking auth state');

    // Small delay to ensure storage sync completes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force reload to trigger useAuth's checkAuth
    window.location.reload();
  };

  const handleLogout = async () => {
    await logout();
    await clearSession();
    setHasUnsavedNewChat(true);
    setActiveCaseId(null);
    setActiveCase(null);
  };

  const handleNewChatFromNav = () => {
    log.debug('Setting up new chat from nav');
    setActiveTab('copilot');
    setActiveCaseId(null);
    setActiveCase(null);
    setHasUnsavedNewChat(true);
    log.debug('New chat state updated', { activeTab: 'copilot', activeCaseId: null, hasUnsavedNewChat: true });
  };

  const handleCaseSelect = async (caseId: string) => {
    // Set UI state immediately
    setActiveCaseId(caseId);
    setHasUnsavedNewChat(false);
    setActiveTab('copilot');

    // Set activeCase immediately to enable chat interaction (canInteract depends on !!activeCase)
    const optimisticCase = optimisticCases.find(c => c.case_id === caseId);
    if (optimisticCase) {
      // Use optimistic case data
      setActiveCase({
        case_id: optimisticCase.case_id,
        title: optimisticCase.title || conversationTitles[caseId] || 'New Case',
        status: optimisticCase.status || 'consulting',
        created_at: optimisticCase.created_at || new Date().toISOString(),
        updated_at: optimisticCase.updated_at || new Date().toISOString(),
        owner_id: optimisticCase.owner_id || '',
        message_count: conversations[caseId]?.length || 0
      });
    } else {
      // Set minimal case data - ChatWindow will load full data
      setActiveCase({
        case_id: caseId,
        title: conversationTitles[caseId] || 'Loading...',
        status: 'consulting',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner_id: '',
        message_count: conversations[caseId]?.length || 0
      });
    }

    // Resolve optimistic IDs to real IDs
    const resolvedCaseId = isOptimisticId(caseId)
      ? idMappingManager.getRealId(caseId) || caseId
      : caseId;

    // Check if we have already loaded this conversation
    const alreadyLoaded = loadedConversationIds.has(resolvedCaseId);
    const hasLocalData = (conversations[caseId]?.length > 0) || (conversations[resolvedCaseId]?.length > 0);

    if (alreadyLoaded || hasLocalData) {
      log.debug('Case already loaded, skipping fetch', { caseId, resolvedCaseId, alreadyLoaded, hasLocalData });
      return;
    }

    // If optimistic and unreconciled, use local data (don't fetch from backend)
    if (isOptimisticId(caseId) && !idMappingManager.getRealId(caseId)) {
      log.debug('Optimistic case not yet reconciled, skipping fetch', { caseId });
      return;
    }

    // Lazy-load conversation from backend
    try {
      log.info('Lazy-loading conversation for case', { caseId, resolvedCaseId });
      const conversationData = await getCaseConversation(resolvedCaseId);
      const messages = conversationData.messages || [];

      // Group messages by turn_number to pair user questions with assistant responses
      // This prevents duplicate display when backend returns separate user/assistant messages
      const turnMap = new Map<number, { user?: any; assistant?: any }>();

      messages.forEach((msg: any) => {
        const turnNum = msg.turn_number || 1;
        if (!turnMap.has(turnNum)) {
          turnMap.set(turnNum, {});
        }
        const turn = turnMap.get(turnNum)!;
        if (msg.role === 'user') {
          turn.user = msg;
        } else if (msg.role === 'agent' || msg.role === 'assistant') {
          turn.assistant = msg;
        }
      });

      // Transform grouped turns into OptimisticConversationItem format
      // Each turn becomes ONE conversation item with both question and response
      const backendMessages: OptimisticConversationItem[] = Array.from(turnMap.entries())
        .sort(([a], [b]) => a - b) // Sort by turn number
        .map(([turnNum, turn]) => ({
          // Use user message ID if available, otherwise assistant message ID
          id: turn.user?.message_id || turn.assistant?.message_id || `turn-${turnNum}`,
          timestamp: turn.user?.created_at || turn.assistant?.created_at || new Date().toISOString(),
          turn_number: turnNum,
          optimistic: false,
          originalId: turn.user?.message_id || turn.assistant?.message_id,
          question: turn.user?.content,
          response: turn.assistant?.content,
          case_status: turn.assistant?.case_status || turn.user?.case_status,
          closure_reason: turn.assistant?.closure_reason ?? turn.user?.closure_reason ?? null,
          closed_at: turn.assistant?.closed_at ?? turn.user?.closed_at ?? null
        }));

      // Replace local messages entirely with backend data (backend is source of truth after reload)
      // This prevents duplicates from optimistic messages with different IDs
      setConversations(prev => ({
        ...prev,
        [caseId]: backendMessages
      }));

      // Mark this case as loaded to prevent refetching
      setLoadedConversationIds(prev => {
        const newSet = new Set(prev);
        newSet.add(resolvedCaseId);
        return newSet;
      });

      log.debug('Conversation loaded successfully', { caseId, messageCount: backendMessages.length });
    } catch (error) {
      log.error('Failed to load conversation', { caseId, resolvedCaseId, error });
      // Don't show error to user for load failures - they can still type new messages
    }
  };

  // Modals state
  const [viewingDocument, setViewingDocument] = useState<any | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);

  const handleDocumentView = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsDocumentModalOpen(true);
    } catch {}
  };

  // --- Render ---

  if (hasCompletedFirstRun === false) {
    return (
      <ErrorBoundary>
        <WelcomeScreen onComplete={() => setHasCompletedFirstRun(true)} />
      </ErrorBoundary>
    );
  }

  if (initializingCapabilities || isRecovering) {
    return (
      <ErrorBoundary>
        <LoadingScreen message={isRecovering ? "Recovering session..." : "Connecting to FaultMaven..."} />
      </ErrorBoundary>
    );
  }

  if (capabilitiesError) {
    return (
      <ErrorBoundary>
        <ErrorScreen
          message={`Failed to connect to backend: ${capabilitiesError}`}
          action={{
            label: "Open Settings",
            onClick: () => browser.runtime.openOptionsPage()
          }}
        />
      </ErrorBoundary>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans">
        <CollapsibleNavigation
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          activeTab={activeTab}
          activeCaseId={activeCaseId || undefined}
          sessionId={sessionId || undefined}
          hasUnsavedNewChat={hasUnsavedNewChat}
          isAdmin={isAdmin()}
          conversationTitles={conversationTitles}
          optimisticCases={optimisticCases}
          pinnedCases={pinnedCases}
          refreshTrigger={refreshSessions}
          dashboardUrl={capabilities?.dashboardUrl}
          onTabChange={setActiveTab}
          onOpenDashboard={() => capabilities?.dashboardUrl && window.open(capabilities.dashboardUrl, '_blank')}
          onCaseSelect={handleCaseSelect}
          onNewChat={handleNewChatFromNav}
          onLogout={handleLogout}
          onCaseTitleChange={async (caseId: string, newTitle: string) => {
            // Update local state optimistically
            setConversationTitles(prev => ({ ...prev, [caseId]: newTitle }));
            setTitleSources(prev => ({ ...prev, [caseId]: 'user' }));

            // Persist to backend
            try {
              await updateCaseTitle(caseId, newTitle);
              log.info('[SidePanelApp] Case title updated successfully', { caseId, newTitle });
            } catch (error) {
              log.error('[SidePanelApp] Failed to update case title', { caseId, newTitle, error });
              showError({
                title: 'Failed to update title',
                message: error instanceof Error ? error.message : 'Unknown error',
                type: 'error'
              });
              // Revert optimistic update on failure
              setConversationTitles(prev => {
                const { [caseId]: _, ...rest } = prev;
                return rest;
              });
            }
          }}
          onPinToggle={(id) => {
            const newSet = new Set(pinnedCases);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            setPinnedCases(newSet);
          }}
          onAfterDelete={() => {}} // TODO: Implement deletion handler
          onCasesLoaded={() => {}}
        />

        <ContentArea
          activeTab={activeTab}
          activeCaseId={activeCaseId || undefined}
          activeCase={activeCase}
          conversations={conversations}
          loading={submitting || isUploading} // using submitting as general loading state for now
          submitting={submitting}
          sessionId={sessionId}
          hasUnsavedNewChat={hasUnsavedNewChat}
          investigationProgress={investigationProgress}
          caseEvidence={caseEvidence}
          failedOperations={getFailedOperationsForUser()}
          onQuerySubmit={handleQuerySubmit}
          onDataUpload={handleDataUpload}
          onDocumentView={handleDocumentView}
          onGenerateReports={() => setShowReportDialog(true)}
          onNewChat={handleNewChatFromNav}
          onRetryFailedOperation={handleUserRetry}
          onDismissFailedOperation={handleDismissFailedOperation}
          getErrorMessageForOperation={getErrorMessageForOperation} // Updated to use the correct type signature
        />
      </div>

      <ToastContainer
        activeErrors={getErrorsByType('toast')}
        onDismiss={dismissError}
        onRetry={async () => {}}
        position="top-right"
      />

      <ErrorModal
        activeError={getErrorsByType('modal')[0] || null}
        onAction={async (errorId) => {
          const modalError = getErrorsByType('modal').find(e => e.id === errorId);
          if (modalError?.error.category === 'authentication') {
            await handleLogout();
          }
          dismissError(errorId);
        }}
      />

      <DocumentDetailsModal
        document={viewingDocument}
        isOpen={isDocumentModalOpen}
        onClose={() => { setIsDocumentModalOpen(false); setViewingDocument(null); }}
        onEdit={() => { setIsDocumentModalOpen(false); setViewingDocument(null); }}
      />

      <ConflictResolutionModal
        isOpen={conflictResolutionData.isOpen}
        conflict={conflictResolutionData.conflict!}
        localData={conflictResolutionData.localData}
        remoteData={conflictResolutionData.remoteData}
        mergeResult={conflictResolutionData.mergeResult}
        availableBackups={conflictResolutionData.conflict ? conflictResolver.getBackupsForCase(conflictResolutionData.conflict.affectedData.caseId || '') : []}
        onResolve={(res) => {
            if (conflictResolutionData.resolveCallback) conflictResolutionData.resolveCallback(res);
            setConflictResolutionData(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => {
            if (conflictResolutionData.resolveCallback) conflictResolutionData.resolveCallback({ choice: 'keep_local' });
            setConflictResolutionData(prev => ({ ...prev, isOpen: false }));
        }}
      />

      {showReportDialog && activeCaseId && (
        <ReportGenerationDialog
          caseId={activeCaseId}
          caseTitle={activeCase?.title || 'Untitled Case'}
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          onReportsGenerated={() => setShowReportDialog(false)}
        />
      )}
    </ErrorBoundary>
  );
}
