import React, { useState, useRef, useEffect, memo, useCallback } from "react";
import { browser } from "wxt/browser";
import DOMPurify from 'dompurify';
import { UploadedData, Source } from "../../../lib/api";
import InlineSourcesRenderer from "./InlineSourcesRenderer";

// TypeScript interfaces
interface ConversationItem {
  id: string;
  question?: string;
  response?: string;
  error?: boolean;
  timestamp: string;
  responseType?: string;
  confidenceScore?: number;
  sources?: Source[];
  plan?: {
    step_number: number;
    action: string;
    description: string;
    estimated_time?: string;
  };
  nextActionHint?: string;
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
  submitting: boolean; // For input locking during message submission
  sessionId: string | null;

  // UI state
  isNewUnsavedChat?: boolean;
  className?: string;

  // Action callbacks only (no state management)
  onQuerySubmit: (query: string) => void;
  onDataUpload: (data: string | File, dataSource: "text" | "file" | "page") => Promise<{ success: boolean; message: string }>;
  onDocumentView?: (documentId: string) => void;
}

// PERFORMANCE OPTIMIZATION: Memoized component to prevent unnecessary re-renders
// Only re-renders when conversation, activeCase, loading, or other props actually change
const ChatWindowComponent = function ChatWindow({
  conversation,
  activeCase,
  loading,
  submitting,
  sessionId,
  isNewUnsavedChat = false,
  className = '',
  onQuerySubmit,
  onDataUpload,
  onDocumentView
}: ChatWindowProps) {
  const MAX_QUERY_LENGTH = 4000;

  // UI-only state (no data management)
  const [queryInput, setQueryInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pageContent, setPageContent] = useState<string>("");
  const [fileSelected, setFileSelected] = useState(false);
  const [injectionStatus, setInjectionStatus] = useState<{ message: string; type: 'success' | 'error' | '' }>({ message: "", type: "" });
  const [showDataSection, setShowDataSection] = useState(true);
  const [dataSource, setDataSource] = useState<"text" | "file" | "page">("text");

  // UI refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationHistoryRef = useRef<HTMLDivElement>(null);

  // Enable inputs only when an active case exists or we are in an ephemeral new chat
  const canInteract = Boolean(activeCase) || Boolean(isNewUnsavedChat);

  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  const getPageContent = async () => {
    try {
      setInjectionStatus({ message: "🔄 Analyzing page content...", type: "" });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error("No active tab found");
      const response = await browser.tabs.sendMessage(tab.id, { action: "getPageContent" });
      if (response && response.content) {
        setPageContent(response.content);
        setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
      } else {
        throw new Error("Failed to capture page content");
      }
    } catch (err) {
      console.error("[ChatWindow] getPageContent error:", err);
      setInjectionStatus({ message: "⚠️ Failed to capture page content. Please ensure the page is fully loaded.", type: "error" });
    }
  };

  const handleSubmitQuery = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!canInteract) {
        setInjectionStatus({ message: "Start a new chat to begin.", type: "" });
        return;
      }
      const trimmed = queryInput.trim();
      if (trimmed.length > MAX_QUERY_LENGTH) {
        setInjectionStatus({ message: `❌  Query too long (${trimmed.length}/${MAX_QUERY_LENGTH}). Please shorten it.`, type: "error" });
        return;
      }
      if (trimmed && !loading && !submitting) {
        onQuerySubmit(trimmed);
        setQueryInput("");
      }
    }
  };

  const handleDataSourceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value as "text" | "file" | "page";
    setDataSource(value);
    setInjectionStatus({ message: "", type: "" });
    setTextInput("");
    setFileSelected(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPageContent("");
  };

  const handleDataSubmit = async () => {
    let dataToSend: string | File | null = null;
    if (dataSource === "text") dataToSend = textInput.trim();
    else if (dataSource === "file" && fileInputRef.current?.files?.[0]) dataToSend = fileInputRef.current.files[0];
    else if (dataSource === "page") dataToSend = pageContent;

    if (!dataToSend) {
      setInjectionStatus({ message: "❌  No data to submit", type: "error" });
      return;
    }

    // Show uploading status
    setInjectionStatus({ message: "🔄 Uploading data...", type: "" });

    // Call upload handler and wait for result
    const result = await onDataUpload(dataToSend, dataSource);

    // Show result to user
    setInjectionStatus({
      message: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
      type: result.success ? "success" : "error"
    });

    // Clear inputs only on success
    if (result.success) {
      if (dataSource === "text") setTextInput("");
      else if (dataSource === "file") {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFileSelected(false);
      }
      else if (dataSource === "page") setPageContent("");
    }
  };

  const isSubmitEnabled =
    !loading &&
    ((dataSource === "text" && textInput.trim()) ||
    (dataSource === "file" && fileSelected) ||
    (dataSource === "page" && !!pageContent.trim()));

  return (
    <div className={`flex flex-col h-full space-y-1 overflow-y-auto ${className}`}>
      {/* Conversation History */}
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-grow overflow-y-auto bg-white border border-gray-300 rounded-lg p-2 min-h-0">
        {Array.isArray(conversation) && conversation.map((item) => (
          <React.Fragment key={item.id}>
            {item.question && (
              <div className="flex justify-end mb-1">
                <div className={`w-full mx-1 px-2 py-1 text-sm text-gray-900 rounded relative ${
                  item.optimistic ? 'bg-blue-50 border border-blue-200' : 'bg-gray-100'
                }`}>
                  <p className="break-words m-0">{item.question}</p>
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-2">
                    <span>{item.timestamp}</span>
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
                      onDocumentView={onDocumentView}
                      className="break-words"
                    />
                    <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{item.timestamp}</span>
                        {item.optimistic && item.loading && !item.failed && (
                          <span className="text-blue-600 flex items-center gap-1" title="Processing...">
                            <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Thinking...
                          </span>
                        )}
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

      {!canInteract && (
        <div className="flex-shrink-0 text-center p-1 text-xs text-gray-600 my-1">
          <span className="text-gray-600">Start a new chat to begin.</span>
        </div>
      )}

      {/* Ask a Question Section */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-2 shadow-sm space-y-1">
        <div className="flex justify-between items-center border-b border-gray-200 pb-1 mb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Ask a Question</h3>
        </div>
        <textarea
          id="query-input"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={handleSubmitQuery}
          placeholder="Type your question here and press Enter..."
          rows={3}
          className="block w-full p-2 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          disabled={loading || submitting || !canInteract}
          maxLength={MAX_QUERY_LENGTH}
          ref={queryInputRef}
        />
      </div>

      {/* Provide Data Section */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-2 shadow-sm space-y-2">
        <div className="flex justify-between items-center border-b border-gray-200 pb-1 mb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Provide Data</h3>
          <button
            type="button"
            onClick={() => setShowDataSection(!showDataSection)}
            aria-label={showDataSection ? 'Collapse data section' : 'Expand data section'}
            className="h-6 w-6 text-xs flex items-center justify-center rounded border border-gray-300 bg-gray-100 hover:bg-gray-200"
            title={showDataSection ? 'Collapse' : 'Expand'}
          >
            {showDataSection ? '▼' : '▲'}
          </button>
        </div>

        {showDataSection && (
          <>
            <div className="flex justify-between items-start">
              <div className="space-y-1 text-xs">
                {["text", "file", "page"].map((value) => (
                  <label key={value} className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="data-source"
                      value={value}
                      checked={dataSource === value}
                      onChange={handleDataSourceChange}
                      className="accent-blue-500"
                      disabled={loading || submitting || !canInteract}
                    />
                    {value === "text" ? "Type or Paste Logs" : value === "file" ? "Upload a File" : "Analyze Page Content"}
                  </label>
                ))}
              </div>
              <button
                id="submit-data"
                onClick={handleDataSubmit}
                disabled={!isSubmitEnabled || loading || !canInteract}
                className="w-36 text-center py-1.5 px-3 text-xs font-medium bg-gray-200 text-gray-800 border border-gray-300 rounded hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Data
              </button>
            </div>

            {dataSource === "text" && (
              <textarea
                id="data-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste logs, metrics, or monitoring data here..."
                rows={3}
                className="block w-full p-2 mt-2 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={loading || submitting || !canInteract}
              />
            )}

            {dataSource === "file" && (
              <input
                type="file"
                id="file-input"
                ref={fileInputRef}
                accept=".txt,.log,.json,.csv"
                title="Supported formats: .txt, .log, .json, .csv"
                onChange={(e) => setFileSelected(!!e.target.files?.length)}
                className="block w-full mt-2 text-xs border rounded p-1.5 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                disabled={loading || submitting || !canInteract}
              />
            )}

            {dataSource === "page" && (
              <div className="mt-2 space-y-2">
                <button
                  id="analyze-page-button"
                  onClick={getPageContent}
                  disabled={loading || submitting || !canInteract}
                  className="w-auto py-1.5 px-4 text-xs font-medium bg-gray-200 text-gray-700 border border-gray-300 rounded hover:bg-gray-300 transition-colors whitespace-nowrap"
                >
                  Analyze Current Page
                </button>
                {injectionStatus.message && (
                  <div id="injection-status" className={`px-2 py-1 rounded text-xs ${
                    injectionStatus.type === "error"
                      ? "text-red-700 bg-red-100"
                      : injectionStatus.type === "success"
                      ? "text-green-700 bg-green-100"
                      : "text-gray-600"
                  }`}>
                    {injectionStatus.message}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Export memoized component with custom comparison
// Re-renders only when these props change significantly
export const ChatWindow = memo(ChatWindowComponent, (prevProps, nextProps) => {
  // Custom comparison to avoid unnecessary re-renders
  return (
    prevProps.conversation === nextProps.conversation &&
    prevProps.activeCase?.case_id === nextProps.activeCase?.case_id &&
    prevProps.loading === nextProps.loading &&
    prevProps.submitting === nextProps.submitting &&
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.isNewUnsavedChat === nextProps.isNewUnsavedChat
  );
});

// Default export for backward compatibility
export default ChatWindow;