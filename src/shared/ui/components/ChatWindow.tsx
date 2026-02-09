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
import type { CaseUIResponse } from "../../../types/case";

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

interface UserCase {
  case_id: string;
  title: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
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
  onGenerateReports
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
    if (!activeCase) return;

    const currentStatus = fullCaseData?.status || activeCase.status;
    const message = getStatusChangeMessage(currentStatus, newStatus);

    if (!message) {
      log.error('Invalid status transition:', { currentStatus, newStatus });
      return;
    }

    log.info('Status change request:', { from: currentStatus, to: newStatus, message });

    // Send with structured intent for reliable backend routing
    const intent: QueryIntent = {
      type: IntentType.StatusTransition,
      from_status: currentStatus,
      to_status: newStatus,
      user_confirmed: true
    };

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

  const handleViewAnalysis = (item: UploadedData) => {
    setViewingEvidence(item);
  };

  const canInteract = Boolean(activeCase) || Boolean(isNewUnsavedChat);

  // Fetch full case data
  useEffect(() => {
    if (activeCase?.case_id && sessionId) {
      setCaseLoading(true);
      setCaseError(null);

      const loadCaseData = async () => {
        try {
          const data = await caseApi.getCaseUI(activeCase.case_id, sessionId);
          setFullCaseData(data);
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
  }, [activeCase?.case_id, sessionId, conversation.length]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  return (
    <div className={`flex flex-col h-full space-y-1 overflow-y-auto ${className}`}>
      {/* Case Header */}
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

      {/* Report Generation Button */}
      {activeCase && activeCase.status === 'resolved' && onGenerateReports && (
        <div className="px-2 py-2 bg-green-50 border border-green-200 rounded-lg mx-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900">✅ Case Resolved</p>
              <p className="text-xs text-green-700">Generate documentation reports for this case</p>
            </div>
            <button
              onClick={onGenerateReports}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              📄 Generate Reports
            </button>
          </div>
        </div>
      )}

      {/* Conversation History */}
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-grow overflow-y-auto bg-white border border-gray-300 rounded-lg p-2 min-h-0">
        {Array.isArray(conversation) && conversation.map((item) => (
          <React.Fragment key={item.id}>
            {item.question && (
              <div className="flex justify-end mb-1" data-turn={item.turn_number}>
                <div className={`w-full mx-1 px-2 py-1 text-sm text-gray-900 rounded relative transition-colors duration-500 ${
                  item.optimistic ? 'bg-blue-50 border border-blue-200' : 'bg-gray-100'
                }`}>
                  <p className="break-words m-0">{item.question}</p>
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-2">
                    <span>{formatTimestampWithTurn(item.timestamp, item.turn_number)}</span>
                    {item.failed && (
                      <span className="text-red-600 flex items-center gap-1" title="Failed to process">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {(item.response || (item.optimistic && item.loading)) && (
              <div className="flex justify-end mb-2">
                <div className={`w-full mx-1 ${item.error || item.failed ? "text-red-700" : "text-gray-800"}`}>
                  <div className={`px-2 py-1 text-sm border-t border-b rounded ${
                    item.failed ? 'border-red-200 bg-red-50/30' :
                    item.optimistic ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'
                  }`}>
                    {/* Error banner for failed messages */}
                    {item.failed && item.errorMessage && (
                      <div className="mb-2 p-2 bg-red-100 border border-red-300 rounded text-xs">
                        <div className="flex items-start gap-2">
                          <svg className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          <div className="flex-1">
                            <p className="text-red-800 font-medium">Message could not be sent</p>
                            <p className="text-red-700 mt-0.5">{item.errorMessage}</p>
                          </div>
                        </div>
                        {item.onRetry && (
                          <button
                            onClick={() => item.onRetry?.(item.id)}
                            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors font-medium"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}

                    <InlineSourcesRenderer
                      content={item.response || ''}
                      sources={item.sources}
                      evidenceRequests={item.evidenceRequests}
                      onDocumentView={onDocumentView}
                      onConfirmationYes={handleConfirmationYes}
                      onConfirmationNo={handleConfirmationNo}
                      className="break-words"
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

                    {/* Investigation Plan - Reconnected Feature */}
                    {item.plan && (
                      <div className="mt-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded text-xs">
                        <div className="font-semibold text-indigo-800 dark:text-indigo-200 mb-2 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          📋 Investigation Plan - Step {item.plan.step_number}
                        </div>
                        <div className="space-y-2">
                          <div className="p-2 bg-white dark:bg-gray-800 rounded border border-indigo-100 dark:border-indigo-900">
                            <div className="font-medium text-indigo-900 dark:text-indigo-100 mb-1">
                              {item.plan.action}
                            </div>
                            <div className="text-gray-700 dark:text-gray-300 text-[11px] mb-2">
                              {item.plan.description}
                            </div>
                            {item.plan.estimated_time && (
                              <div className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                </svg>
                                <span>Estimated time: {item.plan.estimated_time}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Suggested Actions - Reconnected Feature */}
                    {item.suggestedActions && item.suggestedActions.length > 0 && (
                      <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs">
                        <div className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                          </svg>
                          ⚡ Quick Actions
                        </div>
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
                              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                action.type === 'question_template'
                                  ? 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-800 dark:text-blue-200'
                                  : action.type === 'command'
                                  ? 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200'
                                  : action.type === 'upload_data'
                                  ? 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-900 dark:hover:bg-purple-800 text-purple-800 dark:text-purple-200'
                                  : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
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
                          // Note: Clipboard success toast is handled locally in SuggestedCommands now or needs to be handled by parent
                        }}
                      />
                    )}

                    {item.commandValidation && (
                      <CommandValidationDisplay validation={item.commandValidation} />
                    )}

                    {/* Next Action Hint - Reconnected Feature */}
                    {item.nextActionHint && (
                      <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-800 dark:text-blue-200">
                        <div className="flex items-start gap-2">
                          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <div>
                            <div className="font-semibold mb-1">💡 Next Action</div>
                            <div>{item.nextActionHint}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* New Hypotheses - Reconnected Feature */}
                    {item.newHypotheses && item.newHypotheses.length > 0 && (
                      <div className="mt-2 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-xs">
                        <div className="font-semibold text-purple-800 dark:text-purple-200 mb-2 flex items-center gap-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                          </svg>
                          🧪 New Hypotheses Generated
                        </div>
                        <div className="space-y-2">
                          {item.newHypotheses.map((hypothesis, idx) => (
                            <div key={idx} className="p-2 bg-white dark:bg-gray-800 rounded border border-purple-100 dark:border-purple-900">
                              <div className="font-medium text-purple-900 dark:text-purple-100 mb-1">
                                {hypothesis.statement}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-gray-600 dark:text-gray-400 mb-1">
                                <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 rounded">
                                  {hypothesis.category}
                                </span>
                                <span>Likelihood: {(hypothesis.likelihood * 100).toFixed(0)}%</span>
                                <span className={`px-1.5 py-0.5 rounded ${
                                  hypothesis.status === 'validated' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                                  hypothesis.status === 'refuted' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                                  hypothesis.status === 'testing' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                                }`}>
                                  {hypothesis.status}
                                </span>
                              </div>
                              {hypothesis.testing_strategy && (
                                <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-1">
                                  <span className="font-medium">Testing:</span> {hypothesis.testing_strategy}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hypothesis Test Results - Reconnected Feature */}
                    {item.hypothesisTested && item.testResult && (
                      <div className={`mt-2 p-3 rounded text-xs border ${
                        item.testResult.outcome === 'supports' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' :
                        item.testResult.outcome === 'refutes' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                        'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                      }`}>
                        <div className={`font-semibold mb-2 flex items-center gap-2 ${
                          item.testResult.outcome === 'supports' ? 'text-green-800 dark:text-green-200' :
                          item.testResult.outcome === 'refutes' ? 'text-red-800 dark:text-red-200' :
                          'text-yellow-800 dark:text-yellow-200'
                        }`}>
                          {item.testResult.outcome === 'supports' && (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          )}
                          {item.testResult.outcome === 'refutes' && (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                          )}
                          {item.testResult.outcome === 'inconclusive' && (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          )}
                          <span>
                            {item.testResult.outcome === 'supports' ? '✅ Hypothesis Supported' :
                             item.testResult.outcome === 'refutes' ? '❌ Hypothesis Refuted' :
                             '❓ Inconclusive Test'}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">Tested Hypothesis:</div>
                            <div className="text-gray-700 dark:text-gray-300 italic">{item.hypothesisTested}</div>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">Test: {item.testResult.test_description}</div>
                            <div className="text-gray-700 dark:text-gray-300">{item.testResult.evidence_summary}</div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="font-medium">Confidence Impact:</span>
                            <span className={`px-2 py-0.5 rounded ${
                              item.testResult.confidence_impact > 0 ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                              item.testResult.confidence_impact < 0 ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                              'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                            }`}>
                              {item.testResult.confidence_impact > 0 ? '+' : ''}{(item.testResult.confidence_impact * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{formatTimestampWithTurn(item.timestamp, item.turn_number)}</span>
                        {item.failed && (
                          <span className="text-red-600 flex items-center gap-1" title={item.errorMessage || "Failed to process"}>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            Failed
                          </span>
                        )}
                      </div>
                      {item.requiresAction && (
                        <span className="text-orange-600 text-xs font-medium">⚠️ Action Required</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        {(!Array.isArray(conversation) || conversation.length === 0) && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              Welcome to FaultMaven Copilot!
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Your AI troubleshooting partner.
            </p>
            <p className="text-sm text-gray-500 bg-gray-100 p-3 rounded-md max-w-sm">
              To get started, provide context using the options below or ask a question directly, like <em>"What's the runbook for a database failover?"</em>
            </p>
          </div>
        )}
      </div>

      {/* UnifiedInputBar removed - input now handled by ChatInterface */}

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
