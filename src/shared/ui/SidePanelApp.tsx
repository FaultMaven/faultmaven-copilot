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
import { capabilitiesManager, type BackendCapabilities } from "../../lib/capabilities";
import { createLogger } from "../../lib/utils/logger";
import DocumentDetailsModal from "./components/DocumentDetailsModal";

const log = createLogger('SidePanelApp');
import { ConflictResolutionModal, ConflictResolution } from "./components/ConflictResolutionModal";
import { ReportGenerationDialog } from "./components/ReportGenerationDialog";
import { getKnowledgeDocument } from "../../lib/api";
import { conflictResolver, ConflictDetectionResult, MergeResult, OptimisticConversationItem, OptimisticUserCase, PendingOperation } from "../../lib/optimistic";

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
    setActiveCaseId,
    setHasUnsavedNewChat,
    setConversations,
    setActiveCase,
    setOptimisticCases,
    setConversationTitles,
    setTitleSources,
    setInvestigationProgress,
    createOptimisticCaseInBackground: async (id, title) => {
      // This needs to be implemented or extracted if not fully covered by useMessageSubmission
      // For now, useMessageSubmission handles the optimistic logic internally
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

  const handleLogin = async () => {
    try {
      // Initiate Dashboard OAuth flow (opens /auth/authorize with PKCE challenge)
      // This follows the OAuth 2.0 Authorization Code Flow with PKCE as designed
      const response = await browser.runtime.sendMessage({
        action: 'initiateOIDCLogin'  // Triggers OAuth flow in background.ts:handleInitiateDashboardOAuth()
      });

      if (response?.status !== 'success') {
        log.error('Failed to initiate Dashboard OAuth:', response?.message);
        showError('Failed to start authentication. Please try again.');
      }
    } catch (error) {
      log.error('OAuth initiation failed:', error);
      showError('Failed to start authentication. Please try again.');
    }
  };

  const handleLogout = async () => {
    await logout();
    await clearSession();
    setHasUnsavedNewChat(true);
    setActiveCaseId(null);
    setActiveCase(null);
  };

  const handleNewChatFromNav = () => {
    setActiveTab('copilot');
    setActiveCaseId(null);
    setActiveCase(null);
    setHasUnsavedNewChat(true);
  };

  const handleCaseSelect = async (caseId: string) => {
    // Basic implementation - actual logic should be in useCaseManagement or similar
    // For now, setting active ID triggers effects in components
    setActiveCaseId(caseId);
    setHasUnsavedNewChat(false);
    setActiveTab('copilot');
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
        <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans items-center justify-center">
          <div className="bg-white border border-gray-200 rounded-lg p-6 w-full max-w-sm shadow-sm text-center">
            <img src="/icon/square-light.svg" alt="FaultMaven" className="w-12 h-12 mx-auto mb-2" />
            <h2 className="text-base font-semibold text-gray-800">Welcome to FaultMaven</h2>
            <p className="text-xs text-gray-500 mb-4">Sign in to start working</p>
            {authError && <div className="text-xs text-red-600 mb-4">{authError}</div>}
            <button
              onClick={handleLogin}
              className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center gap-2"
            >
              <span>Sign In to Work</span>
            </button>
          </div>
        </div>
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
          onCaseTitleChange={() => {}} // TODO: Implement title change handler
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
