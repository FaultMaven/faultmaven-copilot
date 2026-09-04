// src/shared/ui/CopilotPanel.tsx
/**
 * The Copilot panel: everything a signed-in user sees, and nothing about how
 * they came to be signed in.
 *
 * This was `SidePanelApp`, which owned the first-run screen and the sign-in
 * screen as well. Those are not shared: each host reaches them by its own route
 * — the extension through its options page and OAuth flow, the Dashboard
 * through the session it already holds — so they now live in the host's own
 * entry point, above this boundary.
 *
 * What that buys is not tidiness. `host` carries a non-nullable `HostSession`,
 * so there is no value this component can be called with that lacks a signed-in
 * user, and therefore no state in which it could render a sign-in screen. The
 * invariant is carried by the type rather than by a branch someone maintains.
 */
import React, { useEffect, useRef } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorHandlerProvider, useErrorHandler, useError } from "../../lib/errors";
import { ToastContainer } from "./components/Toast";
import { ErrorModal } from "./components/ErrorModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import { PersistenceManager } from "../../lib/utils/persistence-manager";
import { CaseSnapshot, isCaseTransition } from "../../lib/state/case-reconcile";
import { applyCaseTitleChange } from "../../lib/state/case-title-change";
import { idMappingManager, pendingOpsManager } from "../../lib/optimistic";
import { bumpEpoch } from "../../lib/state/session-epoch";
import { ROLES } from "../../lib/utils/roles";
import { createLogger } from "../../lib/utils/logger";
import { getKnowledgeDocument, updateCaseTitle } from "../../lib/api";
import { useAppStore, debouncedPersist } from "../../lib/state/store";
import { queryClient } from "../../lib/api/query-client";
import { HostAdapterProvider, useHost } from "../host";
import type { WiredHost } from "../host";

const log = createLogger('SidePanelApp');

// Layouts
import { CollapsibleNavigation, ContentArea } from "./layouts";

// Hooks
import { useSessionManagement } from "./hooks/useSessionManagement";
import { useCaseManagement } from "./hooks/useCaseManagement";
import { useDataRecovery } from "./hooks/useDataRecovery";
import { usePendingOperations } from "./hooks/usePendingOperations";
import { useMessageSubmission } from "./hooks/useMessageSubmission";
import { useDataUpload } from "./hooks/useDataUpload";

/**
 * What the panel should be showing when it appears.
 *
 * A host knows why it mounted the panel — the user pressed "investigate", or
 * opened a case's detail page — and that intent has to arrive as an ARGUMENT.
 * Without it a host can only express itself by writing the store's storage keys
 * behind the panel's back and hoping the hydrate picks them up, which couples
 * the host to a key name, an encoding and a race.
 *
 * `new` lands on the composer with an investigation open, not on the
 * "Start a new case" screen — one click short of where the host meant to put
 * the user. `existing` opens a named case. Omitted, the panel restores whatever
 * was open last, which is what a side panel that survives its host should do.
 */
export type InitialCase =
  | { kind: 'new' }
  | {
      kind: 'existing';
      caseId: string;
      /**
       * Show the case, do not let this user add to it.
       *
       * A teammate opening someone else's case gets the transcript and no
       * composer or upload. Without it the panel offered both, and a turn sent
       * into a case the user does not own is a write they cannot make — the
       * failure arrives from the server, after they have typed it.
       *
       * WHO may write is the host's question: it knows the case's owner and the
       * viewer. The panel only renders the answer.
       */
      readOnly?: boolean;
    };

/**
 * How much of the panel the host wants.
 *
 * `full` is the whole shell: the case-list sidebar, the account row, the
 * navigation. `embedded` is the conversation alone, for a host that already
 * provides those — a Dashboard page has its own case list and its own account
 * menu, and rendering a second set inside its layout is not a smaller version
 * of the panel, it is a duplicate of the page around it.
 *
 * It is a CHOICE about layout, not a capability: both hosts CAN render either.
 * That is why it is a prop rather than something inferred from `host.kind` — an
 * inference would make the extension unable to embed the panel and the
 * Dashboard unable to show the full shell, neither of which is true.
 */
export type PanelChrome = 'full' | 'embedded';

export interface CopilotPanelProps {
  /**
   * The host this panel runs in. Non-nullable, and its `session` is
   * non-nullable too — see the note at the top of this file.
   */
  host: WiredHost;
  /**
   * What to open on mount. Applied once; the user is in charge afterwards.
   *
   * It WINS over the persisted active case: an explicit intent expressed by the
   * host this mount is more current than what the last one happened to leave
   * behind, and a host that has to fight the restore ends up seeding storage.
   */
  initialCase?: InitialCase;
  /**
   * How much shell to render. Defaults to `full`, which is what the extension's
   * side panel has always shown.
   */
  chrome?: PanelChrome;
}

/**
 * Publishes the host to the subtree, then renders the panel.
 *
 * The provider is mounted HERE rather than in each host's entry point so there
 * is exactly one way the host reaches the shared UI: through this prop. A host
 * that mounted the provider itself could render this panel with one host in
 * context and a different one in the prop.
 */
export default function CopilotPanel({
  host,
  initialCase,
  chrome = 'full',
}: CopilotPanelProps) {
  return (
    // The panel's OWN query client, always, and not one the host passes in.
    //
    // Two pieces of this tree reach the cache by different routes: `ChatWindow`
    // calls `useQueryClient()` and reads whatever provider is above it, while
    // `useMessageSubmission` and `useDataUpload` import the module singleton
    // directly and invalidate on that. A host mounting its own client made
    // those two different objects, so every invalidation the hooks fired landed
    // in a cache nothing was reading — the case header simply went stale, with
    // nothing thrown. Owning the provider is what makes the two the same object
    // by construction.
    //
    // Nesting is harmless where a host has a client of its own: the innermost
    // provider wins for this subtree, and the host's own queries keep theirs.
    <QueryClientProvider client={queryClient}>
      <HostAdapterProvider value={host}>
        <ErrorHandlerProvider>
          <CopilotPanelContent
            session={host.session}
            initialCase={initialCase}
            chrome={chrome}
          />
        </ErrorHandlerProvider>
      </HostAdapterProvider>
    </QueryClientProvider>
  );
}

// Main app content with error handler integration
function CopilotPanelContent({
  session,
  initialCase,
  chrome,
}: {
  session: WiredHost['session'];
  initialCase?: InitialCase;
  chrome: PanelChrome;
}) {
  const { navigation } = useHost();
  const { getErrorsByType, dismissError } = useErrorHandler();
  const { showError } = useError();

  // --- Zustand Store Selectors ---
  const activeTab = useAppStore((state) => state.activeTab);
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
  const pinnedCases = useAppStore((state) => state.pinnedCases);
  const activeCase = useAppStore((state) => state.activeCase);

  const setActiveTab = useAppStore((state) => state.setActiveTab);
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

  // --- Identity & Session ---
  //
  // Who is signed in comes from the host, not from an auth stack this panel
  // runs: `session` is non-nullable, so there is nobody to ask for and nothing
  // to gate on. The account row reads `session.user` too — the second copy the
  // store used to hold is gone, so there is no pair that could disagree.
  const isAdmin = session.user.roles.includes(ROLES.ADMIN);
  // The panel only ever mounts once its host says the environment is ready, so
  // the session initialises unconditionally here.
  const { sessionId, clearSession } = useSessionManagement(true);

  // --- Case Management ---
  const {
    currentCaseId: activeCaseId,
    setActiveCase: setActiveCaseId
  } = useCaseManagement();

  // The identity can change under an open panel: a sign-out in another tab or
  // context, or a different account signing in on a shared profile. The host is
  // the only thing that can observe that — it owns the credential — so it
  // reports it and the store reacts. Signing out FENCES the session before the
  // panel unmounts, so an in-flight writer's queued continuation is discarded
  // rather than repopulating state the sign-out just cleared.
  const applyHostAuthState = useAppStore((state) => state.applyHostAuthState);
  useEffect(
    () => session.subscribeAuthState(applyHostAuthState),
    [session, applyHostAuthState],
  );

  // --- What the host asked to open ---
  //
  // Declared BEFORE the recovery hook so it runs first: effects fire in
  // declaration order, and this one is synchronous while recovery's restore
  // sits behind two storage reads. By the time the restore is reached the store
  // already carries the host's intent, and the restore stands down.
  //
  // Once. `initialCase` is what the host meant AT MOUNT; re-applying it on a
  // re-render would drag the user back out of whatever they opened next.
  const appliedInitialCase = useRef(false);
  useEffect(() => {
    if (appliedInitialCase.current || !initialCase) return;
    appliedInitialCase.current = true;

    if (initialCase.kind === 'new') {
      // The same state "+ New Case" produces, which is the point: a host asking
      // for a new investigation gets the composer the button gets, not a
      // near-miss of it.
      useAppStore.setState({
        activeTab: 'copilot',
        activeCaseId: null,
        activeCase: null,
        hasUnsavedNewChat: true,
      });
      log.info('Host opened the panel on a new investigation');
    } else {
      useAppStore.getState().handleCaseSelect(initialCase.caseId);
      log.info('Host opened the panel on a case', { caseId: initialCase.caseId });
    }
  }, [initialCase]);

  // A host may open a case this user can read and not write. The flag holds
  // for the life of the mount: the panel does not re-decide it, because the
  // question — is this viewer the owner — is the host's.
  const readOnly = initialCase?.kind === 'existing' && initialCase.readOnly === true;

  // --- Data Recovery ---
  //
  // Hydration only. Whether anything was LOST — an extension reload, an update —
  // is the host's question, answered before this panel mounts.
  useDataRecovery();

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

  // Reconcile case state TRANSITIONS only (same case observed changing
  // state). Keying this on raw activeCase state made every case select run
  // reconcileActiveCaseState — which invalidates the sidebar list cache and
  // bumps the refresh trigger — costing a full network list fetch per click.
  // A case switch now just resets the baseline; genuine transitions (turn
  // responses, the /ui sync discovering an out-of-band change, terminal
  // hydration on reopen) still reconcile. See isCaseTransition for the
  // accepted reopen false positive.
  const prevCaseSnapshotRef = useRef<CaseSnapshot>({ id: null, state: null });
  useEffect(() => {
    const next: CaseSnapshot = {
      id: activeCase?.case_id ?? null,
      state: activeCase?.state ?? null
    };
    const prev = prevCaseSnapshotRef.current;
    prevCaseSnapshotRef.current = next;
    if (isCaseTransition(prev, next)) {
      reconcileActiveCaseState();
    }
  }, [activeCase?.case_id, activeCase?.state, reconcileActiveCaseState]);

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
      // The credential half belongs to the host: it owns the token chain, the
      // storage key and the rotation lock. This panel owns only the state below.
      await session.signOut?.();
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

  if (initializingCapabilities) {
    return (
      <ErrorBoundary>
        <LoadingScreen message="Connecting to FaultMaven..." />
      </ErrorBoundary>
    );
  }

  if (capabilitiesError) {
    return (
      <ErrorBoundary>
        <ErrorScreen
          message={`Failed to connect to backend: ${capabilitiesError}`}
          // No settings surface in this host means no button, not a button that
          // does nothing. ErrorScreen already omits the action when it is
          // undefined, so the affordance disappears with the capability.
          action={navigation.settings
            ? { label: "Open Settings", onClick: navigation.settings }
            : undefined}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full bg-fm-canvas text-fm-text-primary text-sm font-fm-sans relative overflow-hidden">
        {/* The sidebar carries the case list AND the account row, so `embedded`
            omits the whole component rather than emptying it: a host that
            embeds the panel has its own case list and its own account menu,
            and a second set inside its layout duplicates the page around it. */}
        {chrome === 'full' && (
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
              currentUser={session.user}
              isCollapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              activeTab={activeTab}
              activeCaseId={activeCaseId || undefined}
              sessionId={sessionId || undefined}
              hasUnsavedNewChat={hasUnsavedNewChat}
              isAdmin={isAdmin}
              conversationTitles={conversationTitles}
              pinnedCases={pinnedCases}
              refreshTrigger={refreshSessions}
              dashboardUrl={capabilities?.dashboardUrl}
              onTabChange={setActiveTab}
              // A path, not a URL: where the Dashboard lives is the host's
              // business (a configured endpoint in the extension, the current
              // origin on the web), and how it is reached — focus an existing tab,
              // open a new one, push a route — is too.
              onOpenDashboard={() =>
                navigation.dashboard(activeCaseId ? `/cases/${activeCaseId}` : '/cases')
              }
              onCaseSelect={handleCaseSelect}
              onNewChat={handleNewChatFromNav}
              onLogout={handleLogout}
              onCaseTitleChange={(caseId: string, newTitle: string, source: 'user' | 'backend') =>
                applyCaseTitleChange(caseId, newTitle, source, {
                  readStore: () => useAppStore.getState(),
                  setConversationTitles,
                  setTitleSources,
                  persistTitle: updateCaseTitle,
                  onPersistError: (error) => showError({
                    title: 'Failed to update title',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    type: 'error'
                  }),
                  log
                })
              }
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
        )}

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
              readOnly={readOnly}
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
