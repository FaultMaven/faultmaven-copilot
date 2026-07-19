// src/shared/ui/SidePanelApp.tsx
import React, { useEffect } from "react";
import { browser } from "wxt/browser";
import { ErrorHandlerProvider, useErrorHandler, useError } from "../../lib/errors";
import { ToastContainer } from "./components/Toast";
import { ErrorModal } from "./components/ErrorModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { AuthScreen } from "./components/AuthScreen";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import { PersistenceManager } from "../../lib/utils/persistence-manager";
import { idMappingManager, pendingOpsManager } from "../../lib/optimistic";
import { bumpEpoch } from "../../lib/state/session-epoch";
import { createLogger } from "../../lib/utils/logger";
import { getKnowledgeDocument, updateCaseTitle } from "../../lib/api";
import { getDashboardUrl } from "../../config";
import { useAppStore, debouncedPersist } from "../../lib/state/store";

const log = createLogger('SidePanelApp');

// Layouts
import { CollapsibleNavigation, ContentArea } from "./layouts";

// Hooks
import { useAuth } from "./hooks/useAuth";
import { useSessionManagement } from "./hooks/useSessionManagement";
import { useCaseManagement } from "./hooks/useCaseManagement";
import { useDataRecovery } from "./hooks/useDataRecovery";
import { usePendingOperations } from "./hooks/usePendingOperations";
import { useMessageSubmission } from "./hooks/useMessageSubmission";
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

  // --- Zustand Store Selectors ---
  const activeTab = useAppStore((state) => state.activeTab);
  const hasCompletedFirstRun = useAppStore((state) => state.hasCompletedFirstRun);
  const capabilities = useAppStore((state) => state.capabilities);
  const initializingCapabilities = useAppStore((state) => state.initializingCapabilities);
  const capabilitiesError = useAppStore((state) => state.capabilitiesError);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const refreshSessions = useAppStore((state) => state.refreshSessions);
  const viewingDocument = useAppStore((state) => state.viewingDocument);
  const isDocumentModalOpen = useAppStore((state) => state.isDocumentModalOpen);
  const hasUnsavedNewChat = useAppStore((state) => state.hasUnsavedNewChat);

  const conversations = useAppStore((state) => state.conversations);
  const conversationTitles = useAppStore((state) => state.conversationTitles);
  const titleSources = useAppStore((state) => state.titleSources);
  const optimisticCases = useAppStore((state) => state.optimisticCases);
  const pinnedCases = useAppStore((state) => state.pinnedCases);
  const activeCase = useAppStore((state) => state.activeCase);

  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setHasCompletedFirstRun = useAppStore((state) => state.setHasCompletedFirstRun);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const setViewingDocument = useAppStore((state) => state.setViewingDocument);
  const setIsDocumentModalOpen = useAppStore((state) => state.setIsDocumentModalOpen);
  const initializeApp = useAppStore((state) => state.initializeApp);

  const setConversationTitles = useAppStore((state) => state.setConversationTitles);
  const setTitleSources = useAppStore((state) => state.setTitleSources);
  const setPinnedCases = useAppStore((state) => state.setPinnedCases);
  const setActiveCaseObj = useAppStore((state) => state.setActiveCase);
  const handleCaseSelect = useAppStore((state) => state.handleCaseSelect);
  const reconcileActiveCaseState = useAppStore((state) => state.reconcileActiveCaseState);

  // --- Auth & Session ---
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const shouldInitializeSession = hasCompletedFirstRun === true;
  const { sessionId, clearSession } = useSessionManagement(shouldInitializeSession);

  // --- Case Management ---
  const {
    currentCaseId: activeCaseId,
    setActiveCase: setActiveCaseId
  } = useCaseManagement(sessionId);

  // --- Data Recovery ---
  const { isRecovering } = useDataRecovery();

  // --- Pending Operations ---
  const {
    getFailedOperationsForUser,
    handleUserRetry,
    handleDismissFailedOperation,
    getErrorMessageForOperation
  } = usePendingOperations(activeCaseId || undefined, showError);

  // --- Message Submission ---
  const {
    submitting,
    handleQuerySubmit,
    abortInFlight: abortInFlightMessageTurns
  } = useMessageSubmission();

  // --- Data Upload ---
  const {
    handleTurnSubmit,
    uploading: isUploading,
    abortInFlight: abortInFlightUploadTurns
  } = useDataUpload();

  // Initialize first-run status and capabilities
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Reconcile case state transitions
  useEffect(() => {
    reconcileActiveCaseState();
  }, [activeCase?.case_id, activeCase?.state, reconcileActiveCaseState]);

  const handleAuthSuccess = async () => {
    log.info('Authentication successful, checking auth state');
    await new Promise(resolve => setTimeout(resolve, 100));
    window.location.reload();
  };

  const handleLogout = async () => {
    // 0. Fence the session FIRST, synchronously, before any await. handleLogout
    //    has several sequential awaits below during which a background writer
    //    (e.g. a createCase whose continuation is already queued) can resolve and
    //    re-write the state we're about to clear. Bumping the epoch here makes
    //    every in-flight writer's captured epoch stale, so its post-await store/
    //    storage/singleton writes are discarded instead of repopulating the purge.
    bumpEpoch();

    // Stop in-flight turn poll loops so they don't keep hitting the backend for
    // up to POLL_MAX_TOTAL_MS after logout. This is a budget concern, not a
    // correctness one — the epoch fence above already prevents stale writes.
    abortInFlightMessageTurns();
    abortInFlightUploadTurns();

    // 1. Best-effort backend logout + session teardown. Their failure (offline,
    //    a 401) must NOT skip the local purge below — otherwise the previous
    //    user's conversations / case-pointer / session survive in storage and
    //    rehydrate on the next login, possibly a DIFFERENT user on a shared
    //    profile (#143). logout() already completes the local logout even on a
    //    failed POST; wrap clearSession too so a throw there can't skip the purge.
    try {
      await logout();
      await clearSession();
    } catch (error) {
      log.warn('Logout/session teardown failed; proceeding with local purge', error);
    }

    // 2. Cancel any pending debounced persist BEFORE clearing storage: a write
    //    scheduled just before logout (holding the prior user's conversations)
    //    could otherwise fire DURING the async clear below and re-write the keys
    //    we're clearing. Cancelling first closes that window — no writer runs
    //    between here and the clear, so nothing re-schedules it (#143). The store
    //    reset in step 4 then schedules a fresh empty-state persist.
    debouncedPersist.cancel();
    try {
      await PersistenceManager.clearAllPersistenceData({ preservePinnedCases: true });
    } catch (error) {
      log.error('Failed to clear persistence data on logout', error);
    }

    // 3. Reset the in-memory optimistic singletons. These are module-level and
    //    outlive the session (the side panel is not reloaded on logout), so the
    //    previous user's id-mappings and pending operations would otherwise leak
    //    into the next session's optimistic state.
    idMappingManager.clear();
    pendingOpsManager.clear();

    // 4. Reset local store states
    useAppStore.setState({
      conversationTitles: {},
      titleSources: {},
      conversations: {},
      pendingOperations: {},
      optimisticCases: [],
      caseEvidence: {},
      hasUnsavedNewChat: true,
      activeCaseId: null,
      activeCase: null
    });
  };

  const handleNewChatFromNav = () => {
    log.debug('Setting up new chat from nav');
    useAppStore.setState({
      activeTab: 'copilot',
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: true
    });
  };

  const handleDocumentView = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsDocumentModalOpen(true);
    } catch (error) {
      log.error('Failed to load document', { documentId, error });
      showError(error, { operation: 'kb_document_view', metadata: { documentId } });
    }
  };

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
      <div className="flex h-full bg-fm-canvas text-fm-text-primary text-sm font-fm-sans relative overflow-hidden">
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
            onOpenDashboard={async () => {
              const baseUrl = (await getDashboardUrl()).replace(/\/+$/, '');
              if (!baseUrl) return;
              const targetUrl = activeCaseId
                ? `${baseUrl}/cases/${activeCaseId}`
                : `${baseUrl}/cases`;
              try {
                const tabs = await browser.tabs.query({ url: `${baseUrl}/*` });
                if (tabs.length > 0 && tabs[0].id != null) {
                  const currentUrl = tabs[0].url ?? '';
                  const updateOpts: { active: boolean; url?: string } = {
                    active: true,
                  };
                  if (!currentUrl.startsWith(targetUrl)) {
                    updateOpts.url = targetUrl;
                  }
                  await browser.tabs.update(tabs[0].id, updateOpts);
                } else {
                  await browser.tabs.create({ url: targetUrl });
                }
              } catch {
                window.open(targetUrl, '_blank');
              }
            }}
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
                      onClick={() => { setActiveCaseId(null); setActiveCaseObj(null); }}
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
              failedOperations={getFailedOperationsForUser()}
              onQuerySubmit={handleQuerySubmit}
              onTurnSubmit={handleTurnSubmit}
              onDocumentView={handleDocumentView}
              onNewChat={handleNewChatFromNav}
              onRetryFailedOperation={handleUserRetry}
              onDismissFailedOperation={handleDismissFailedOperation}
              getErrorMessageForOperation={getErrorMessageForOperation}
              setActiveCase={setActiveCaseObj}
            />
          </ErrorBoundary>
        </div>
      </div>

      <ErrorBoundary
        fallback={null}
        onError={(error) => log.error('Modal boundary caught error', { error })}
      >
        <ToastContainer
          activeErrors={getErrorsByType('toast')}
          onDismiss={dismissError}
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

      </ErrorBoundary>
    </ErrorBoundary>
  );
}
