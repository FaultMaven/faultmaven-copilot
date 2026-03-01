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
import { PersistenceManager } from "../../lib/utils/persistence-manager";

const log = createLogger('SidePanelApp');
import { ConflictResolutionModal, ConflictResolution } from "./components/ConflictResolutionModal";
import { ReportGenerationDialog } from "./components/ReportGenerationDialog";
import { getKnowledgeDocument, createCase, CreateCaseRequest, updateCaseTitle, getCaseConversation } from "../../lib/api";
import { isOptimisticId, isRealId } from "../../lib/utils/data-integrity";
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

  // --- Data Upload (unified turn submission with query + attachments) ---
  const { handleTurnSubmit, uploading: isUploading } = useDataUpload({
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

  // ADR 003: Sidebar state persists via chrome.storage.local
  // Side panels are 400-600px — sidebar should remain expanded by default
  // (no auto-collapse on narrow width). User toggles manually.
  useEffect(() => {
    browser.storage.local.get('sidebarCollapsed').then((result) => {
      if (result.sidebarCollapsed !== undefined) {
        setSidebarCollapsed(result.sidebarCollapsed);
      }
    });
  }, []);

  // Persist sidebar state
  useEffect(() => {
    browser.storage.local.set({ sidebarCollapsed });
  }, [sidebarCollapsed]);

  const handleAuthSuccess = async () => {
    // Auth successful - wait a moment for storage to sync, then check auth state
    log.info('Authentication successful, checking auth state');

    // Small delay to ensure storage sync completes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force reload to trigger useAuth's checkAuth
    window.location.reload();
  };

  const handleLogout = async () => {
    // 1. Clear backend auth state
    await logout();
    await clearSession();

    // 2. Clear persistent storage immediately
    await PersistenceManager.clearAllPersistenceData();

    // 3. Reset local UI state
    setConversationTitles({});
    setTitleSources({});
    setConversations({});
    setPendingOperations({});
    setOptimisticCases([]);
    setPinnedCases(new Set());
    setLoadedConversationIds(new Set());
    setCaseEvidence({});

    // 4. Reset Active State
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
        status: optimisticCase.status || 'inquiry',
        created_at: optimisticCase.created_at || new Date().toISOString(),
        updated_at: optimisticCase.updated_at || new Date().toISOString(),
        owner_id: optimisticCase.owner_id || '',
        message_count: conversations[caseId]?.length || 0
      });
    } else {
      // Derive last known status from conversation messages instead of hardcoding 'inquiry'
      const caseMessages = conversations[caseId] || [];
      const lastStatusMessage = [...caseMessages].reverse().find(m => m.case_status);
      const lastKnownStatus = lastStatusMessage?.case_status || 'inquiry';

      // Set minimal case data - ChatWindow will load full data
      setActiveCase({
        case_id: caseId,
        title: conversationTitles[caseId] || 'Loading...',
        status: lastKnownStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner_id: '',
        message_count: caseMessages.length || 0
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
      // Background status reconciliation (non-blocking, bypasses caseCacheManager)
      // ChatWindow's getCaseUI() also syncs, but this pre-sync reduces the stale status window
      if (isRealId(resolvedCaseId)) {
        getCaseConversation(resolvedCaseId).then(data => {
          const messages = data.messages || [];
          const latestStatus = [...messages].reverse().find((m: any) => m.case_status)?.case_status;
          if (latestStatus) {
            setActiveCase((prev: any) => prev && prev.case_id === caseId && prev.status !== latestStatus
              ? { ...prev, status: latestStatus }
              : prev
            );
          }
        }).catch(err => log.warn('Background status sync failed', err));
      }
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

      // Transform backend messages to OptimisticConversationItem format
      const backendMessages: OptimisticConversationItem[] = messages.map((msg: any) => ({
        id: msg.message_id,
        timestamp: msg.created_at,
        turn_number: msg.turn_number,
        optimistic: false,
        originalId: msg.message_id,
        question: msg.role === 'user' ? msg.content : undefined,
        response: (msg.role === 'agent' || msg.role === 'assistant') ? msg.content : undefined,
        case_status: msg.case_status,
        closure_reason: msg.closure_reason ?? null,
        closed_at: msg.closed_at ?? null
      }));

      // Merge with existing local messages (if any)
      setConversations(prev => {
        const existing = prev[caseId] || [];
        const backendMap = new Map(backendMessages.map(m => [m.id, m]));

        // Preserve local messages, update with backend data if available
        const merged = existing.map(local => {
          const backend = backendMap.get(local.id);
          return backend || local;
        });

        // Add new messages from backend that aren't in local
        const newMessages = backendMessages.filter(m => !existing.some(e => e.id === m.id));

        return {
          ...prev,
          [caseId]: [...merged, ...newMessages]
        };
      });

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
    } catch (error) {
      log.error('Failed to load document', { documentId, error });
    }
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
      {/* ADR 003: SRE-Native Dark Theme root layout */}
      <div className="flex h-screen bg-fm-canvas text-fm-text-primary text-sm font-fm-sans relative overflow-hidden">
        {/* Navigation — isolated boundary (keeps sidebar functional when content crashes) */}
        <ErrorBoundary
          fallback={
            <div className="w-16 bg-fm-surface border-r border-fm-border p-4 flex flex-col items-center">
              <p className="text-xs text-fm-critical text-center mt-4">Nav error</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 text-xs text-fm-accent hover:underline"
              >
                Reload
              </button>
            </div>
          }
          onError={(error) => log.error('Navigation boundary caught error', { error })}
        >
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
              setConversationTitles(prev => ({ ...prev, [caseId]: newTitle }));
              setTitleSources(prev => ({ ...prev, [caseId]: 'user' }));
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
            onAfterDelete={() => { }}
            onCasesLoaded={() => { }}
          />
        </ErrorBoundary>

        {/* Content — isolated boundary with "Return to Dashboard" recovery */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ErrorBoundary
            fallback={
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-sm">
                  <h3 className="text-sm font-medium text-fm-critical mb-2">Chat Error</h3>
                  <p className="text-sm text-fm-text-tertiary mb-4">
                    Something went wrong loading this case.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => { setActiveCaseId(null); setActiveCase(null); }}
                      className="px-3 py-2 bg-fm-accent text-white text-xs rounded hover:opacity-90"
                    >
                      Return to Dashboard
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3 py-2 bg-fm-surface text-fm-text-primary text-xs rounded hover:bg-fm-elevated border border-fm-border"
                    >
                      Reload Extension
                    </button>
                  </div>
                </div>
              </div>
            }
            onError={(error) => log.error('Content area boundary caught error', { error })}
          >
            <ContentArea
              activeTab={activeTab}
              activeCaseId={activeCaseId || undefined}
              activeCase={activeCase}
              conversations={conversations}
              loading={submitting || isUploading}
              submitting={submitting}
              sessionId={sessionId}
              hasUnsavedNewChat={hasUnsavedNewChat}
              caseEvidence={caseEvidence}
              failedOperations={getFailedOperationsForUser()}
              onQuerySubmit={handleQuerySubmit}
              onTurnSubmit={handleTurnSubmit}
              onDocumentView={handleDocumentView}
              onGenerateReports={() => setShowReportDialog(true)}
              onNewChat={handleNewChatFromNav}
              onRetryFailedOperation={handleUserRetry}
              onDismissFailedOperation={handleDismissFailedOperation}
              getErrorMessageForOperation={getErrorMessageForOperation}
              setActiveCase={setActiveCase}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Modals — isolated boundary (fail silently, main UI stays functional) */}
      <ErrorBoundary
        fallback={null}
        onError={(error) => log.error('Modal boundary caught error', { error })}
      >
        <ToastContainer
          activeErrors={getErrorsByType('toast')}
          onDismiss={dismissError}
          onRetry={async () => { }}
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
    </ErrorBoundary>
  );
}
