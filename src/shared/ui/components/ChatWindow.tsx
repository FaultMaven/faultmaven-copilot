import React, { useState, useRef, useEffect, memo, useCallback } from "react";
import {
  UploadedData,
  Source,
  SuggestedAction,
  EvidenceRequest,
  InvestigationMode,
  CaseStatus,
  InvestigationProgress,
  CommandSuggestion,
  CommandValidation,
  ScopeAssessment,
  UserCaseStatus,
  getStatusChangeMessage,
  Hypothesis,
  TestResult,
  QueryIntent,
  IntentType
} from "../../../lib/api";
import InlineSourcesRenderer from "./InlineSourcesRenderer";
import { InvestigationProgressIndicator } from "./InvestigationProgressIndicator";
import { HypothesisTracker } from "./HypothesisTracker";
import { EvidenceProgressBar } from "./EvidenceProgressBar";
import { AnomalyAlert } from "./AnomalyAlert";
import { SuggestedCommands } from "./SuggestedCommands";
import { ClarifyingQuestions } from "./ClarifyingQuestions";
import { CommandValidationDisplay } from "./CommandValidationDisplay";
import { ProblemDetectedAlert } from "./ProblemDetectedAlert";
import { ScopeAssessmentDisplay } from "./ScopeAssessmentDisplay";
import { EvidencePanel } from "./EvidencePanel";
import { EvidenceAnalysisModal } from "./EvidenceAnalysisModal";
import { EnhancedCaseHeader } from "./case-header/EnhancedCaseHeader";
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
  caseStatus?: CaseStatus;

  // v3.0.0 fields (RE-ENABLED in v3.2.0)
  suggestedActions?: SuggestedAction[] | null;

  // v3.2.0 OODA Response Format fields
  clarifyingQuestions?: string[];
  suggestedCommands?: CommandSuggestion[];
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

  // OODA Framework v3.2.0
  investigationProgress?: InvestigationProgress | null;

  // Phase 3 Week 7: Evidence Management
  evidence?: UploadedData[];

  // Action callbacks
  onQuerySubmit: (query: string, intent?: QueryIntent) => void;
  // onDataUpload removed - handled by parent/UnifiedInputBar
  onDocumentView?: (documentId: string) => void;
  onGenerateReports?: () => void;  // FR-CM-006: Trigger report generation for resolved cases
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
  investigationProgress,
  evidence = [],
  onQuerySubmit,
  onDocumentView,
  onGenerateReports,
  setActiveCase
}: ChatWindowProps) {
  // Phase 3 Week 7: Evidence panel state
  const [evidencePanelExpanded, setEvidencePanelExpanded] = useState(true);
  const [viewingEvidence, setViewingEvidence] = useState<UploadedData | null>(null);

  // Phase 5: Enhanced Case Header state
  const [fullCaseData, setFullCaseData] = useState<CaseUIResponse | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);

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
  const handleStatusChangeRequest = useCallback((newStatus: UserCaseStatus) => {
    log.debug('handleStatusChangeRequest called', {
      newStatus,
      hasActiveCase: !!activeCase,
      activeCaseStatus: activeCase?.status
    });

    if (!activeCase) {
      log.debug('No active case, returning');
      return;
    }

    // Use activeCase.status (updated from backend via view_state.active_case)
    const currentStatus = activeCase.status;
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
      from_status: currentStatus,
      to_status: newStatus,
      user_confirmed: true
    };

    log.debug('Calling onQuerySubmit', { message, intent });
    onQuerySubmit(message, intent);
  }, [activeCase, onQuerySubmit]);

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

  const handleViewAnalysis = (item: UploadedData) => {
    setViewingEvidence(item);
  };

  const canInteract = Boolean(activeCase) || Boolean(isNewUnsavedChat);

  // Fetch full case data - triggered only when case or session changes, not on every message
  useEffect(() => {
    if (activeCase?.case_id && sessionId) {
      setCaseLoading(true);
      setCaseError(null);

      const loadCaseData = async () => {
        try {
          const data = await caseApi.getCaseUI(activeCase.case_id, sessionId);
          setFullCaseData(data);

          // Update activeCase status if it differs from backend
          // This fixes the bug where activeCase defaults to 'inquiry' in SidePanelApp
          if (data.status !== activeCase.status && setActiveCase) {
            log.info('Syncing activeCase status with backend', {
              oldStatus: activeCase.status,
              newStatus: data.status
            });
            setActiveCase(prev => prev ? { ...prev, status: data.status } : null);
          }
        } catch (err) {
          log.error('Failed to load case data:', err);
          setCaseError(err instanceof Error ? err.message : 'Failed to load case data');
        } finally {
          setCaseLoading(false);
        }
      };

      loadCaseData();
    } else {
      setFullCaseData(null);
      setCaseError(null);
    }
  }, [activeCase?.case_id, sessionId]);

  // Refresh full case data when status changes (triggered by backend view_state.active_case update)
  useEffect(() => {
    if (!activeCase || !fullCaseData || !sessionId) return;
    if (fullCaseData.status === activeCase.status) return;

    log.info('Status changed - refreshing case data', {
      from: fullCaseData.status,
      to: activeCase.status
    });

    caseApi.getCaseUI(activeCase.case_id, sessionId)
      .then(data => setFullCaseData(data))
      .catch(err => log.error('Failed to refresh case data:', err));
  }, [activeCase?.status, fullCaseData?.status, activeCase?.case_id, sessionId]);

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
          loading={caseLoading}
          error={caseError}
          initialExpanded={false}
          onStatusChangeRequest={handleStatusChangeRequest}
          onScrollToTurn={scrollToTurn}
        />
      )}

      {/* OODA Investigation Progress */}
      {investigationProgress && (
        <div className="ooda-investigation-panel px-2 py-1">
          <InvestigationProgressIndicator progress={investigationProgress} />
          <HypothesisTracker hypotheses={investigationProgress.hypotheses} />
          <EvidenceProgressBar
            collected={investigationProgress.evidence_collected}
            requested={investigationProgress.evidence_requested}
          />
          {investigationProgress.anomaly_frame && (
            <AnomalyAlert anomaly={investigationProgress.anomaly_frame} />
          )}
        </div>
      )}

      {/* Evidence Panel */}
      {activeCase?.status === 'investigating' && evidence && evidence.length > 0 && (
        <EvidencePanel
          evidence={evidence}
          isExpanded={evidencePanelExpanded}
          onToggleExpand={() => setEvidencePanelExpanded(!evidencePanelExpanded)}
          onViewAnalysis={handleViewAnalysis}
        />
      )}

      {/* Report Generation Button — dark themed */}
      {activeCase && activeCase.status === 'resolved' && onGenerateReports && (
        <div className="px-4 py-2 bg-fm-success-bg border border-fm-success-border rounded-md mx-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-fm-success">Case Resolved</p>
              <p className="text-xs text-fm-text-tertiary">Generate documentation reports for this case</p>
            </div>
            <button
              onClick={onGenerateReports}
              className="px-3 py-1.5 bg-fm-success text-fm-base text-xs font-semibold rounded-md hover:opacity-90 transition-colors"
            >
              Generate Reports
            </button>
          </div>
        </div>
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
                  <img src="/icon/square-dark.svg" alt="FM" className="w-4 h-4 rounded" />
                  <span className="text-meta font-semibold text-fm-text-primary">FaultMaven</span>
                  <span className="text-micro text-fm-text-tertiary">{formatTimestampWithTurn(item.timestamp, item.turn_number)}</span>
                </div>

                {/* Content elevated */}
                <div className={`mt-2 ${item.error || item.failed ? 'text-fm-critical' : ''}`}>
                  <div className="bg-fm-surface rounded-fm-card px-5 py-[18px] border border-fm-border-subtle shadow-fm-card text-fm-text-secondary mt-1">
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

                    {/* Suggested Actions */}
                    {item.suggestedActions && item.suggestedActions.length > 0 && (
                      <div className="mt-3 p-3 bg-fm-elevated border border-fm-warning-border rounded-lg">
                        <div className="text-finding-title text-fm-warning mb-2">⚡ Quick Actions</div>
                        <div className="flex flex-wrap gap-2">
                          {item.suggestedActions.map((action, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                if (action.type === 'question_template' && canInteract && !loading) {
                                  onQuerySubmit(action.payload);
                                } else if (action.type === 'command') {
                                  navigator.clipboard.writeText(action.payload);
                                }
                              }}
                              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${action.type === 'question_template'
                                ? 'bg-fm-accent-soft text-fm-accent hover:opacity-80'
                                : action.type === 'command'
                                  ? 'bg-fm-success-bg text-fm-success hover:opacity-80'
                                  : action.type === 'upload_data'
                                    ? 'bg-fm-accent-soft text-fm-accent hover:opacity-80'
                                    : 'bg-fm-elevated text-fm-text-primary hover:opacity-80'
                                }`}
                              disabled={!canInteract || loading}
                            >
                              <span className="flex items-center gap-1">
                                {action.icon && <span>{action.icon}</span>}
                                {action.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.clarifyingQuestions && item.clarifyingQuestions.length > 0 && (
                      <ClarifyingQuestions
                        questions={item.clarifyingQuestions}
                        onQuestionClick={(question) => {
                          if (canInteract && !loading) {
                            onQuerySubmit(question);
                          }
                        }}
                      />
                    )}

                    {item.suggestedCommands && item.suggestedCommands.length > 0 && (
                      <SuggestedCommands
                        commands={item.suggestedCommands}
                        onCommandClick={(command) => {
                          navigator.clipboard.writeText(command);
                        }}
                      />
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
                                <span className={`px-1.5 py-0.5 rounded ${hypothesis.status === 'validated' ? 'bg-fm-success-bg text-fm-success' :
                                  hypothesis.status === 'refuted' ? 'bg-fm-critical-bg text-fm-critical' :
                                    hypothesis.status === 'testing' ? 'bg-fm-warning-bg text-fm-warning' :
                                      'bg-fm-surface text-fm-text-tertiary'
                                  }`}>
                                  {hypothesis.status}
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
            <img src="/icon/square-dark.svg" alt="FaultMaven" className="w-10 h-10 rounded-lg opacity-50 mb-4" />
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

      <EvidenceAnalysisModal
        evidence={viewingEvidence}
        isOpen={viewingEvidence !== null}
        onClose={() => setViewingEvidence(null)}
      />

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
