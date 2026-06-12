import React, { useState, useRef, useEffect, memo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Source,
  SuggestedAction,
  EvidenceRequest,
  InvestigationMode,
  CaseState,
  CommandValidation,
  ScopeAssessment,
  UserCaseState,
  getStatusChangeMessage,
  Hypothesis,
  TestResult,
  QueryIntent,
  IntentType,
  AttachmentResult,
  formatFileSize,
} from "../../../lib/api";
import InlineSourcesRenderer from "./InlineSourcesRenderer";
import { SuggestionCard } from "./SuggestionCard";
import { CommandValidationDisplay } from "./CommandValidationDisplay";
import { ProblemDetectedAlert } from "./ProblemDetectedAlert";
import { ScopeAssessmentDisplay } from "./ScopeAssessmentDisplay";
// EvidencePanel and EvidenceAnalysisModal removed — the case header's
// "Evidence" and "Files" sections now provide this functionality in a
// compact, integrated format.  See case-header/CaseDetails.tsx.
import { EnhancedCaseHeader } from "./case-header/EnhancedCaseHeader";
import { ResolutionActionsCard } from "./ResolutionActionsCard";
import { caseApi } from "../../../lib/api/case-service";
import { createLogger } from "../../../lib/utils/logger";
import type { CaseUIResponse, UserCase } from "../../../types/case";

const log = createLogger('ChatWindow');

// TypeScript interfaces
interface ConversationItem {
  id: string;
  question?: string;
  response?: string;
  error?: boolean;
  timestamp: string;
  turn_number?: number; // Turn number for navigation
  responseType?: string;
  confidenceScore?: number | null;
  sources?: Source[];

  // v3.1.0 Evidence-centric fields
  evidenceRequests?: EvidenceRequest[];
  investigationMode?: InvestigationMode;
  caseStatus?: CaseState;

  suggestedActions?: SuggestedAction[] | null;
  commandValidation?: CommandValidation | null;
  problemDetected?: boolean;
  problemSummary?: string | null;
  severity?: 'low' | 'medium' | 'high' | 'critical' | null;
  scopeAssessment?: ScopeAssessment | null;

  plan?: {
    step_number: number;
    action: string;
    description: string;
    estimated_time?: string;
  } | null;
  nextActionHint?: string | null;
  requiresAction?: boolean;

  // Hypothesis tracking fields (reconnected features)
  newHypotheses?: Hypothesis[];
  hypothesisTested?: string | null;
  testResult?: TestResult | null;

  // File attachments processed in this turn
  attachments?: AttachmentResult[];

  // Optimistic update metadata
  optimistic?: boolean;
  loading?: boolean;
  failed?: boolean;
  pendingOperationId?: string;
  // Error handling
  errorMessage?: string;
  onRetry?: (itemId: string) => void | Promise<void>;
}

interface ChatWindowProps {
  // State passed down as props (Single Source of Truth)
  conversation: ConversationItem[];
  activeCase: UserCase | null;
  loading: boolean;
  // submitting: boolean; // Removed: Input locking handled by parent/UnifiedInputBar
  sessionId: string | null;

  // UI state
  isNewUnsavedChat?: boolean;
  className?: string;

  // Action callbacks
  onQuerySubmit: (query: string, intent?: QueryIntent) => void;
  onDocumentView?: (documentId: string) => void;
  setActiveCase?: (updater: (prev: UserCase | null) => UserCase | null) => void;  // Status sync with backend
}

// PERFORMANCE OPTIMIZATION: Memoized component to prevent unnecessary re-renders
const ChatWindowComponent = function ChatWindow({
  conversation,
  activeCase,
  loading,
  sessionId,
  isNewUnsavedChat = false,
  className = '',
  onQuerySubmit,
  onDocumentView,
  setActiveCase
}: ChatWindowProps) {
  // Evidence panel state removed — case header handles evidence display.

  // Phase 5: Enhanced Case Header state — cached per (caseId, sessionId).
  // Switching back to a recently-viewed case serves from cache (staleTime 5m
  // via global QueryClient defaults); concurrent fetches are deduplicated and
  // in-flight requests are aborted when the queryKey changes.
  const queryClient = useQueryClient();
  const caseUIQuery = useQuery<CaseUIResponse>({
    queryKey: ['caseUI', activeCase?.case_id, sessionId],
    queryFn: ({ signal }) =>
      caseApi.getCaseUI(activeCase!.case_id, sessionId!, signal),
    enabled: Boolean(activeCase?.case_id && sessionId),
  });
  const fullCaseData = caseUIQuery.data ?? null;
  // isLoading (= isPending && isFetching) is true only on the initial fetch
  // with no cached data. Using isFetching here would briefly flash the header
  // skeleton over already-displayed data during background refetches.
  const caseLoading = caseUIQuery.isLoading;
  const caseError = caseUIQuery.error
    ? (caseUIQuery.error instanceof Error
        ? caseUIQuery.error.message
        : 'Failed to load case data')
    : null;

  // Determine the last assistant turn (only its suggestions are interactive)
  const lastAssistantItemId = Array.isArray(conversation)
    ? [...conversation].reverse().find(item => item.response)?.id ?? null
    : null;

  // UI refs
  const conversationHistoryRef = useRef<HTMLDivElement>(null);

  /**
   * Format timestamp for display with turn number
   */
  const formatTimestampWithTurn = useCallback((timestamp: string, turnNumber?: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const dateStr = isToday
      ? 'Today'
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const turnPrefix = turnNumber ? `Turn ${turnNumber} · ` : '';
    return `${turnPrefix}${dateStr}, ${timeStr}`;
  }, []);

  /**
   * Scroll to a specific turn in the conversation
   */
  const scrollToTurn = useCallback((turnNumber: number) => {
    const element = document.querySelector(`[data-turn="${turnNumber}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('bg-yellow-100');
      setTimeout(() => element.classList.remove('bg-yellow-100'), 2000);
    }
  }, []);

  /**
   * Handle status change request from CaseHeader dropdown
   */
  const handleStatusChangeRequest = useCallback((newStatus: UserCaseState) => {
    log.debug('handleStatusChangeRequest called', {
      newStatus,
      hasActiveCase: !!activeCase,
      activeCaseState: activeCase?.state
    });

    if (!activeCase) {
      log.debug('No active case, returning');
      return;
    }

    // Prefer fullCaseData.state (backend-confirmed) over activeCase.state.
    // activeCase.state can still hold the stale default 'inquiry' while
    // fullCaseData has already been updated from getCaseUI() — the two states
    // are updated independently (one in the parent, one locally) and a narrow
    // race window exists between them. The header that renders the dropdown
    // already requires fullCaseData to be non-null, so this is always safe.
    const currentStatus = (fullCaseData?.state ?? activeCase.state) as UserCaseState;
    const message = getStatusChangeMessage(currentStatus, newStatus);

    log.debug('getStatusChangeMessage result', {
      currentStatus,
      newStatus,
      message,
      transitionKey: `${currentStatus}_to_${newStatus}`
    });

    if (!message) {
      log.error('Invalid status transition', { currentStatus, newStatus });
      return;
    }

    log.info('Status change request', { from: currentStatus, to: newStatus });

    // Send with structured intent for reliable backend routing
    const intent: QueryIntent = {
      type: IntentType.StatusTransition,
      from_state: currentStatus,
      to_state: newStatus,
      user_confirmed: true
    };

    log.debug('Calling onQuerySubmit', { message, intent });
    onQuerySubmit(message, intent);
  }, [activeCase, fullCaseData, onQuerySubmit]);

  const handleConfirmationYes = useCallback(() => {
    log.info('User confirmed with Yes');
    const intent: QueryIntent = {
      type: IntentType.Confirmation,
      confirmation_value: true
    };
    onQuerySubmit('Yes', intent);
  }, [onQuerySubmit]);

  const handleConfirmationNo = useCallback(() => {
    log.info('User declined with No');
    const intent: QueryIntent = {
      type: IntentType.Confirmation,
      confirmation_value: false
    };
    onQuerySubmit('No', intent);
  }, [onQuerySubmit]);

  // handleViewAnalysis removed — case header handles evidence display.

  const canInteract = Boolean(activeCase) || Boolean(isNewUnsavedChat);

  // Sync activeCase.state from the backend exactly once per case-switch.
  // activeCase defaults to 'inquiry' in SidePanelApp before the first fetch
  // lands, so without this the dropdown can show a stale state. The ref
  // guard ensures the cache only "wins" on initial load — afterwards the
  // parent is the source of truth (see the invalidation effect below).
  const syncedSnapshotKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fullCaseData || !activeCase || !setActiveCase) return;
    const key = `${activeCase.case_id}:${sessionId ?? ''}`;
    if (syncedSnapshotKeyRef.current === key) return;
    syncedSnapshotKeyRef.current = key;
    if (fullCaseData.state === activeCase.state) return;
    log.info('Syncing activeCase status with backend', {
      oldStatus: activeCase.state,
      newStatus: fullCaseData.state,
    });
    setActiveCase(prev => prev ? { ...prev, state: fullCaseData.state as UserCase['state'] } : null);
  }, [fullCaseData, activeCase, sessionId, setActiveCase]);

  // Invalidate the cached snapshot when activeCase.state moves ahead of it —
  // the parent learned about a transition before the snapshot did (usually
  // via view_state.active_case on a query response). Gated on the initial
  // sync having already run so we don't fight it on first load.
  //
  // The lastHandledDivergenceRef bounds the worst case: if the backend
  // persistently returns stale status (refetch lands without the transition
  // having been persisted yet), we only invalidate once per unique
  // (cache-status, parent-status) shape rather than spamming round-trips.
  // Reset when statuses converge so a *new* transition triggers again.
  const lastHandledDivergenceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCase?.case_id || !sessionId || !fullCaseData) return;
    if (fullCaseData.state === activeCase.state) {
      lastHandledDivergenceRef.current = null;
      return;
    }
    const key = `${activeCase.case_id}:${sessionId}`;
    if (syncedSnapshotKeyRef.current !== key) return;
    // Include the case key so a different case with the same divergence
    // shape doesn't accidentally inherit a prior case's "already handled" mark.
    const divergenceKey = `${key}|${fullCaseData.state}->${activeCase.state}`;
    if (lastHandledDivergenceRef.current === divergenceKey) return;
    lastHandledDivergenceRef.current = divergenceKey;
    log.info('Status diverged from cache — invalidating snapshot', {
      from: fullCaseData.state,
      to: activeCase.state,
    });
    queryClient.invalidateQueries({
      queryKey: ['caseUI', activeCase.case_id, sessionId],
    });
  }, [activeCase?.state, fullCaseData?.state, activeCase?.case_id, sessionId, queryClient]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  return (
    <div className={`flex flex-col h-full min-h-0 bg-fm-canvas ${className}`}>
      {/* Case Header — dark themed */}
      {activeCase && (
        <EnhancedCaseHeader
          caseData={fullCaseData}
          activeCase={activeCase}
          loading={caseLoading}
          error={caseError}
          initialExpanded={false}
          onStatusChangeRequest={handleStatusChangeRequest}
          onScrollToTurn={scrollToTurn}
        />
      )}

      {/* Post-Terminal Actions */}
      {activeCase && (activeCase.state === 'resolved' || activeCase.state === 'closed') && (
        <ResolutionActionsCard
          activeCase={activeCase}
          caseData={fullCaseData}
        />
      )}

      {/* Conversation History — dark themed */}
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-fm-content mx-auto w-full">
        <div className="h-4" />
        {Array.isArray(conversation) && conversation.map((item) => (
          <React.Fragment key={item.id}>
            {/* User Message — right-aligned bubble */}
            {item.question && (
              <div className="flex justify-end px-4 py-2" data-turn={item.turn_number}>
                <div
                  className={`max-w-[85%] bg-fm-elevated border text-fm-text-primary px-3.5 py-2.5 ${item.failed ? 'border-fm-critical-border' : 'border-fm-border'
                    }`}
                  style={{ borderRadius: '8px 8px 0px 8px' }}
                >
                  <p className="break-words m-0 text-body">{item.question}</p>
                  {/* Attachment indicator — one chip per attachment with source-aware icon */}
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1.5 border-t border-fm-border/50">
                      {item.attachments.map((att, idx) => {
                        const st = (att as any).source_type as string | undefined;
                        let icon: React.ReactNode;
                        if (st === 'page_capture' || att.filename?.startsWith('page-capture-')) {
                          icon = (
                            <svg className="w-3.5 h-3.5 text-fm-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253" />
                            </svg>
                          );
                        } else if (st === 'text_paste' || att.filename?.startsWith('pasted-content-')) {
                          icon = (
                            <svg className="w-3.5 h-3.5 text-fm-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                            </svg>
                          );
                        } else {
                          icon = (
                            <svg className="w-3.5 h-3.5 text-fm-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                            </svg>
                          );
                        }
                        return (
                          <span key={att.evidence_id || idx} className="inline-flex items-center gap-1 text-fm-xs text-fm-text-tertiary">
                            {icon}
                            <span>{att.filename}{att.file_size > 0 ? ` (${formatFileSize(att.file_size)})` : ''}</span>
                            {idx < item.attachments!.length - 1 ? <span>,</span> : null}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 mt-1">
                    {item.failed && (
                      <span className="text-micro text-fm-critical font-medium">Failed</span>
                    )}
                    {/* Removed "Sending..." — redundant with response loading indicator */}
                    <span className="text-micro text-fm-text-tertiary">{formatTimestampWithTurn(item.timestamp, item.turn_number)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Message — left-aligned with FM avatar */}
            {(item.response || (item.optimistic && item.loading)) && (
              <div className="px-4 py-2.5">
                {/* Avatar row */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <img src="/icon/square-transparent.svg" alt="FM" className="w-4 h-4 rounded" />
                  <span className="text-meta font-semibold text-fm-text-primary">FaultMaven</span>
                  <span className="text-micro text-fm-text-tertiary">{formatTimestampWithTurn(item.timestamp, item.turn_number)}</span>
                </div>

                {/* Content elevated */}
                <div className={`mt-2 ${item.error || item.failed ? 'text-fm-critical' : ''}`}>
                  <div className="relative group bg-fm-surface rounded-fm-card px-5 py-[18px] border border-fm-border-subtle shadow-fm-card text-fm-text-secondary mt-1">
                    {/* Copy button — appears on hover */}
                    {item.response && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.response || '');
                          const btn = document.getElementById(`copy-${item.id}`);
                          if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = ''; }, 1500); }
                        }}
                        id={`copy-${item.id}`}
                        title="Copy response"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-fm-elevated text-fm-text-tertiary hover:text-fm-text-secondary"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    )}
                    {/* Error banner */}
                    {item.failed && item.errorMessage && (
                      <div className="mb-2 p-2.5 bg-fm-critical-bg border border-fm-critical-border rounded-md text-xs">
                        <p className="text-fm-critical font-medium">Message could not be sent</p>
                        <p className="text-fm-text-tertiary mt-0.5">{item.errorMessage}</p>
                        {item.onRetry && (
                          <button
                            onClick={() => item.onRetry?.(item.id)}
                            className="mt-2 px-3 py-1 text-xs bg-fm-critical text-fm-base rounded hover:opacity-90 transition-colors font-medium"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}

                    {/* Loading indicator */}
                    {item.optimistic && item.loading && !item.response && (
                      <div className="inline-flex items-center gap-2 px-3 py-1 bg-fm-accent-soft rounded border border-fm-accent-border text-fm-accent">
                        <div className="flex gap-[3px]">
                          {[0, 1, 2].map(i => (
                            <div
                              key={i}
                              className="w-1 h-1 rounded-full bg-fm-accent animate-pulse-dot"
                              style={{ animationDelay: `${i * 0.2}s` }}
                            />
                          ))}
                        </div>
                        <span className="font-mono font-medium text-[11.5px]">Thinking...</span>
                      </div>
                    )}

                    <InlineSourcesRenderer
                      content={item.response || ''}
                      sources={item.sources}
                      evidenceRequests={item.evidenceRequests}
                      onDocumentView={onDocumentView}
                      onConfirmationYes={handleConfirmationYes}
                      onConfirmationNo={handleConfirmationNo}
                      className="break-words text-body"
                    />

                    {/* OODA v3.2.0 Response Format Components */}
                    {item.problemDetected && item.problemSummary && item.severity && (
                      <ProblemDetectedAlert
                        problemSummary={item.problemSummary}
                        severity={item.severity}
                      />
                    )}

                    {item.scopeAssessment && (
                      <ScopeAssessmentDisplay assessment={item.scopeAssessment} />
                    )}

                    {/* Investigation Plan */}
                    {item.plan && (
                      <div className="mt-3 p-3 bg-fm-elevated border border-fm-accent-border rounded-lg">
                        <div className="text-finding-title text-fm-accent mb-2 flex items-center gap-2">
                          📋 Investigation Plan - Step {item.plan.step_number}
                        </div>
                        <div className="p-2.5 bg-fm-canvas rounded-md border border-fm-border">
                          <div className="text-body font-medium text-fm-text-primary mb-1">{item.plan.action}</div>
                          <div className="text-body text-fm-text-tertiary">{item.plan.description}</div>
                          {item.plan.estimated_time && (
                            <div className="text-micro text-fm-text-secondary mt-1.5">Estimated: {item.plan.estimated_time}</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Suggestions */}
                    {item.suggestedActions && item.suggestedActions.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-fm-border/30 space-y-px">
                        {item.suggestedActions.map((action, idx) => (
                          <SuggestionCard
                            key={idx}
                            action={action}
                            isCurrentTurn={item.id === lastAssistantItemId}
                            disabled={!canInteract}
                            onClickableSuggestion={(payload, type, intent) => {
                              // RUN copies inside the card; only DECIDE submits.
                              if (type === 'DECIDE') {
                                onQuerySubmit(payload, intent);
                              }
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {item.commandValidation && (
                      <CommandValidationDisplay validation={item.commandValidation} />
                    )}

                    {/* Next Action Hint */}
                    {item.nextActionHint && (
                      <div className="mt-3 p-2.5 bg-fm-elevated border border-fm-accent-border rounded-lg">
                        <div className="text-meta font-semibold text-fm-accent mb-1">💡 Next Action</div>
                        <div className="text-body text-fm-text-primary">{item.nextActionHint}</div>
                      </div>
                    )}

                    {/* New Hypotheses */}
                    {item.newHypotheses && item.newHypotheses.length > 0 && (
                      <div className="mt-3 p-3 bg-fm-elevated border border-fm-accent-border rounded-lg">
                        <div className="text-finding-title text-fm-accent mb-2">🧪 New Hypotheses Generated</div>
                        <div className="space-y-2">
                          {item.newHypotheses.map((hypothesis, idx) => (
                            <div key={idx} className="p-2.5 bg-fm-canvas rounded-md border border-fm-border">
                              <div className="text-body font-medium text-fm-text-primary mb-1">{hypothesis.statement}</div>
                              <div className="flex items-center gap-2 text-micro text-fm-text-tertiary mb-1">
                                <span className="px-1.5 py-0.5 bg-fm-accent-soft rounded font-mono">{hypothesis.category}</span>
                                <span>Likelihood: {(hypothesis.likelihood * 100).toFixed(0)}%</span>
                                <span className={`px-1.5 py-0.5 rounded ${hypothesis.state === 'validated' ? 'bg-fm-success-bg text-fm-success' :
                                  hypothesis.state === 'refuted' ? 'bg-fm-critical-bg text-fm-critical' :
                                    hypothesis.state === 'testing' ? 'bg-fm-warning-bg text-fm-warning' :
                                      'bg-fm-surface text-fm-text-tertiary'
                                  }`}>
                                  {hypothesis.state}
                                </span>
                              </div>
                              {hypothesis.testing_strategy && (
                                <div className="text-micro text-fm-text-secondary mt-1">
                                  <span className="font-medium">Testing:</span> {hypothesis.testing_strategy}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hypothesis Test Results */}
                    {item.hypothesisTested && item.testResult && (
                      <div className={`mt-3 p-3 rounded-lg border ${item.testResult.outcome === 'supports' ? 'bg-fm-elevated border-fm-success-border' :
                        item.testResult.outcome === 'refutes' ? 'bg-fm-elevated border-fm-critical-border' :
                          'bg-fm-elevated border-fm-warning-border'
                        }`}>
                        <div className={`text-finding-title mb-2 ${item.testResult.outcome === 'supports' ? 'text-fm-success' :
                          item.testResult.outcome === 'refutes' ? 'text-fm-critical' :
                            'text-fm-warning'
                          }`}>
                          {item.testResult.outcome === 'supports' ? '✅ Hypothesis Supported' :
                            item.testResult.outcome === 'refutes' ? '❌ Hypothesis Refuted' :
                              '❓ Inconclusive Test'}
                        </div>
                        <div className="space-y-2">
                          <div className="p-2 bg-fm-canvas rounded-md border border-fm-border">
                            <div className="text-meta font-medium text-fm-text-tertiary mb-0.5">Tested Hypothesis</div>
                            <div className="text-body text-fm-text-primary italic">{item.hypothesisTested}</div>
                          </div>
                          <div className="p-2 bg-fm-canvas rounded-md border border-fm-border">
                            <div className="text-meta font-medium text-fm-text-tertiary mb-0.5">Test: {item.testResult.test_description}</div>
                            <div className="text-body text-fm-text-primary">{item.testResult.evidence_summary}</div>
                          </div>
                          <div className="flex items-center gap-2 text-micro">
                            <span className="font-medium text-fm-text-tertiary">Confidence Impact:</span>
                            <span className={`px-2 py-0.5 rounded font-mono font-medium ${item.testResult.confidence_impact > 0 ? 'bg-fm-success-bg text-fm-success' :
                              item.testResult.confidence_impact < 0 ? 'bg-fm-critical-bg text-fm-critical' :
                                'bg-fm-surface text-fm-text-tertiary'
                              }`}>
                              {item.testResult.confidence_impact > 0 ? '+' : ''}{(item.testResult.confidence_impact * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action required indicator */}
                    {item.requiresAction && (
                      <div className="mt-1 text-fm-warning text-xs font-medium">⚠️ Action Required</div>
                    )}

                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        {(!Array.isArray(conversation) || conversation.length === 0) && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <img src="/icon/square-transparent.svg" alt="FaultMaven" className="w-10 h-10 rounded-lg opacity-50 mb-4" />
            <h2 className="text-base font-semibold text-fm-text-primary mb-2">
              Welcome to FaultMaven Copilot
            </h2>
            <p className="text-sm text-fm-text-tertiary mb-4">
              Your AI troubleshooting partner.
            </p>
            <p className="text-sm text-fm-text-secondary bg-fm-elevated p-3 rounded-md max-w-sm">
              Provide context using the options below or ask a question directly, like <em className="text-fm-text-tertiary">"What's the runbook for a database failover?"</em>
            </p>
          </div>
        )}
        <div className="h-6" />
        </div>{/* max-w-fm-content */}
      </div>

    </div>
  );
};

export const ChatWindow = memo(ChatWindowComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation === nextProps.conversation &&
    prevProps.activeCase?.case_id === nextProps.activeCase?.case_id &&
    prevProps.loading === nextProps.loading &&
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.isNewUnsavedChat === nextProps.isNewUnsavedChat
  );
});

export default ChatWindow;
