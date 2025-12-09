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
  getStatusChangeMessage
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
  onQuerySubmit: (query: string) => void;
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
    onQuerySubmit(message);
  }, [activeCase, fullCaseData, onQuerySubmit]);

  const handleConfirmationYes = useCallback(() => {
    log.info('User confirmed with Yes');
    onQuerySubmit('Yes');
  }, [onQuerySubmit]);

  const handleConfirmationNo = useCallback(() => {
    log.info('User declined with No');
    onQuerySubmit('No');
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
  }, [activeCase?.case_id, conversation.length]);

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
