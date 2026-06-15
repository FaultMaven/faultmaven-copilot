// src/shared/ui/SidePanelApp.tsx
import React, { useState, useEffect, useRef } from "react";
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
import { getKnowledgeDocument, createCase, CreateCaseRequest, updateCaseTitle, getCaseConversation, getUserCases } from "../../lib/api";
import { caseCacheManager } from "../../lib/cache/case-cache";
import { isOptimisticId, isRealId } from "../../lib/utils/data-integrity";
import { OptimisticConversationItem, OptimisticUserCase, PendingOperation, idMappingManager } from "../../lib/optimistic";

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
import type { UserCase } from "../../types/case";

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
  const [activeCase, setActiveCase] = useState<UserCase | null>(null);
  const [caseEvidence, setCaseEvidence] = useState<Record<string, any[]>>({}); // Should be UploadedData[]

  // State-transition reconciliation. When the active case's state changes
  // mid-session (INQUIRY → INVESTIGATING → RESOLVED/CLOSED), two displays go
  // stale: the case list grouping (active vs completed, served from a cached
  // getUserCases list) and — on terminal transitions — the terminal metadata
  // on activeCase (closure_reason / closed_at / resolved_at live on the case
  // row; TurnResponse carries only case_state). Refresh both from the
  // authoritative list. Keyed per case so switching cases never counts as a
  // transition.
  const lastCaseStateRef = useRef<{ id: string; state: string } | null>(null);
  useEffect(() => {
    if (!activeCase) return;
    const prevPair = lastCaseStateRef.current;
    lastCaseStateRef.current = { id: activeCase.case_id, state: activeCase.state };
    if (!prevPair || prevPair.id !== activeCase.case_id) return; // case switch
    if (prevPair.state === activeCase.state) return; // no transition
    const transitionedCaseId = activeCase.case_id;
    const isTerminal = activeCase.state === 'resolved' || activeCase.state === 'closed';
    (async () => {
      try {
        await caseCacheManager.invalidateCache();
        if (isTerminal) {
          const cases = await getUserCases({ limit: 100, offset: 0 });
          const fresh = cases.find(c => c.case_id === transitionedCaseId);
          if (fresh) {
            setActiveCase(prev =>
              prev && prev.case_id === fresh.case_id ? { ...prev, ...fresh } : prev
            );
          }
        }
        setRefreshSessions(prev => prev + 1);
      } catch (error) {
        // Non-critical — the next list reload will reconcile.
        log.debug('Post-transition case refresh failed', error);
      }
    })();
  }, [activeCase?.case_id, activeCase?.state]);

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

        // Update title sources — only carry over if user explicitly set the title.
        // Don't set 'backend' for the default auto-format title (Case-MMDD-N),
        // as that would block smart title auto-generation at turn threshold.
        setTitleSources(prev => {
          const optimisticSource = prev[optimisticId];
          if (!optimisticSource) return prev;

          const updated = { ...prev };
          delete updated[optimisticId];
          if (optimisticSource === 'user') {
            updated[realCaseId] = optimisticSource;
          }
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
    }
  });

  // --- Data Upload (unified turn submission with query + attachments) ---
  const { handleTurnSubmit, uploading: isUploading } = useDataUpload({
    sessionId,
    activeCaseId: activeCaseId || undefined,
    conversations,
    titleSources,
    setActiveCaseId,
    setHasUnsavedNewChat,
    setActiveCase,
    setConversations,
    setConversationTitles,
    setTitleSources,
    setCaseEvidence,
    setRefreshSessions,
    showError
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

    // 2. Clear persistent storage immediately (keep pin preferences across re-login)
    await PersistenceManager.clearAllPersistenceData({ preservePinnedCases: true });

    // 3. Reset local UI state.
    //    pinnedCases is intentionally NOT reset: useBatchedPersistence flushes the
    //    local Set to storage on the unmount triggered by the post-login reload, so
    //    resetting here would overwrite the value preserved in step 2. The Set is
    //    invisible during AuthScreen and rehydrated by useDataRecovery on next mount.
    setConversationTitles({});
    setTitleSources({});
    setConversations({});
    setPendingOperations({});
    setOptimisticCases([]);
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

  const handleCaseSelect = (caseId: string) => {
    // Set selection state immediately. The chat input stays live
    // during the conversation fetch — the data-layer fix
    // (smart-insertion of the delta in the .then handler below)
    // keeps the conversation array correct even if the user submits
    // before the history lands.
    setActiveCaseId(caseId);
    setHasUnsavedNewChat(false);
    setActiveTab('copilot');

    const optimisticCase = optimisticCases.find(c => c.case_id === caseId);
    if (optimisticCase) {
      setActiveCase({
        case_id: optimisticCase.case_id,
        title: optimisticCase.title || conversationTitles[caseId] || 'New Case',
        state: (optimisticCase.state || 'inquiry') as UserCase['state'],
        created_at: optimisticCase.created_at || new Date().toISOString(),
        updated_at: optimisticCase.updated_at || new Date().toISOString(),
        owner_id: optimisticCase.owner_id || '',
        organization_id: '',
        closure_reason: null,
        closed_at: null,
        message_count: conversations[caseId]?.length || 0
      });
    } else {
      // Derive status from local messages; ChatWindow loads authoritative case data.
      const caseMessages = conversations[caseId] || [];
      const lastStatusMessage = [...caseMessages].reverse().find(m => m.case_state);
      setActiveCase({
        case_id: caseId,
        title: conversationTitles[caseId] || 'Loading...',
        state: (lastStatusMessage?.case_state || 'inquiry') as UserCase['state'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner_id: '',
        organization_id: '',
        closure_reason: null,
        closed_at: null,
        message_count: caseMessages.length || 0
      });
    }

    // Resolve optimistic IDs before fetching.
    const resolvedCaseId = isOptimisticId(caseId)
      ? idMappingManager.getRealId(caseId) || caseId
      : caseId;

    // Unreconciled optimistic cases exist only in local state — nothing to fetch yet.
    if (isOptimisticId(resolvedCaseId)) {
      log.debug('Optimistic case not yet reconciled, using local data', { caseId });
      return;
    }

    // Delta-fetch: send the current local message count as the offset so the backend
    // returns only messages we don't have yet. For append-only conversations this is
    // always correct:
    //   offset=0  → first open, fetches full history
    //   offset=N  → subsequent opens, fetches only turns added after the last fetch
    //   offset=total_count → nothing new, backend returns an empty list, state unchanged
    const offset = conversations[caseId]?.length ?? 0;

    getCaseConversation(resolvedCaseId, { offset })
      .then(data => {
        const incoming: OptimisticConversationItem[] = (data.messages || []).map((msg: any) => ({
          id: msg.message_id,
          timestamp: msg.created_at,
          turn_number: msg.turn_number,
          optimistic: false,
          originalId: msg.message_id,
          question: msg.role === 'user' ? msg.content : undefined,
          response: (msg.role === 'agent' || msg.role === 'assistant') ? msg.content : undefined,
          case_state: msg.case_state,
          closure_reason: msg.closure_reason ?? null,
          closed_at: msg.closed_at ?? null
        }));
        if (incoming.length > 0) {
          setConversations(prev => {
            const existing = prev[caseId] || [];
            // Smart insertion: keep any trailing optimistic messages
            // (added by an in-flight submission that beat this fetch)
            // AFTER the incoming historical batch. The optimistic
            // submit path always appends to the end of the array, so
            // the optimistic block is contiguous and at the tail —
            // walk back from the end while we see optimistic=true to
            // find the split point.
            //
            // Why this matters: when the user opens a cold-cache case
            // and submits before the history arrives, a naive append
            // (``[...prev, ...incoming]``) would put the user's just-
            // typed message ABOVE the case's own history — visually
            // jumbled. Splicing the delta in BEFORE the optimistic
            // tail keeps the chronological feel correct: history
            // above, the user's pending message at the bottom.
            //
            // Server-assigned turn_number on the optimistic message is
            // reconciled later when the submit response lands, so the
            // brief turn_number mismatch is invisible to the user.
            let splitAt = existing.length;
            for (let i = existing.length - 1; i >= 0; i--) {
              if (existing[i].optimistic) {
                splitAt = i;
              } else {
                break;
              }
            }
            const committed = existing.slice(0, splitAt);
            const trailingOptimistic = existing.slice(splitAt);
            return {
              ...prev,
              [caseId]: [...committed, ...incoming, ...trailingOptimistic],
            };
          });
          log.info('Conversation delta applied', { caseId, added: incoming.length, offset });
        }
      })
      .catch(err => log.error('Failed to fetch conversation delta', { caseId, offset, err }));
  };

  // Modals state
  const [viewingDocument, setViewingDocument] = useState<any | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
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
      {/* ADR 003: Dark Theme root layout */}
      <div className="flex h-full bg-fm-canvas text-fm-text-primary text-sm font-fm-sans relative overflow-hidden">
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
            onOpenDashboard={async () => {
              const baseUrl = capabilities?.dashboardUrl;
              if (!baseUrl) return;
              // Route to the active case's detail page when there's an
              // active case in the side panel; otherwise fall back to
              // the case list. Better than re-activating whatever the
              // dashboard tab last showed — preserves cross-surface
              // context (user clicks "Open Dashboard" while looking at
              // a case here → dashboard opens that same case there).
              const targetUrl = activeCaseId
                ? `${baseUrl}/cases/${activeCaseId}`
                : `${baseUrl}/cases`;
              try {
                const tabs = await browser.tabs.query({ url: `${baseUrl}/*` });
                if (tabs.length > 0 && tabs[0].id != null) {
                  // Reuse the existing tab. If it's already on the
                  // target page (or a sub-route — e.g. ``?tab=report``
                  // deep-link, ``#hash``), skip the URL update so we
                  // don't lose the user's in-tab navigation state or
                  // cause a flash-of-reload.
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
              failedOperations={getFailedOperationsForUser()}
              onQuerySubmit={handleQuerySubmit}
              onTurnSubmit={handleTurnSubmit}
              onDocumentView={handleDocumentView}
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

      </ErrorBoundary>
    </ErrorBoundary>
  );
}
