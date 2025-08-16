import React, { useState, useRef, useEffect } from "react";
import { browser } from "wxt/browser";
import DOMPurify from 'dompurify';
import { 
  processQuery, 
  uploadData, 
  QueryRequest, 
  heartbeatSession, 
  AgentResponse,
  ResponseType,
  UploadedData,
  getSessionData,
  generateConversationTitle
} from "../../../lib/api";
import { formatResponseForDisplay, requiresUserAction } from "../../../lib/utils/response-handlers";
import config from "../../../config";
import LoadingSpinner from "./LoadingSpinner";

// TypeScript interfaces
interface ConversationItem {
  question?: string;
  response?: string;
  error?: boolean;
  timestamp: string;
  responseType?: ResponseType;
  confidenceScore?: number;
  sources?: Array<{
    type: string;
    content: string;
    confidence?: number;
  }>;
  plan?: {
    step_number: number;
    action: string;
    description: string;
    estimated_time?: string;
  };
  nextActionHint?: string;
  requiresAction?: boolean;
}

interface ChatWindowProps {
  sessionId: string;
  onTitleGenerated?: (sessionId: string, title: string) => void;
  className?: string;
}

export function ChatWindow({ sessionId, onTitleGenerated, className = '' }: ChatWindowProps) {
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [conversationCache, setConversationCache] = useState<Record<string, ConversationItem[]>>({});
  const [queryInput, setQueryInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pageContent, setPageContent] = useState<string>("");
  const [fileSelected, setFileSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [injectionStatus, setInjectionStatus] = useState<{ message: string; type: 'success' | 'error' | '' }>({ message: "", type: "" });
  const [showDataSection, setShowDataSection] = useState(true);
  const [dataSource, setDataSource] = useState<"text" | "file" | "page">("text");
  const [sessionData, setSessionData] = useState<UploadedData[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [messageCountCache, setMessageCountCache] = useState<Record<string, number>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationHistoryRef = useRef<HTMLDivElement>(null);

  // Load session data when sessionId changes
  useEffect(() => {
    if (sessionId) {
      // Cache current conversation before switching
      if (conversation.length > 0) {
        const currentSessionId = Object.keys(conversationCache).find(id => 
          conversationCache[id] === conversation
        );
        if (currentSessionId && currentSessionId !== sessionId) {
          setConversationCache(prev => ({ ...prev, [currentSessionId]: conversation }));
          setMessageCountCache(prev => ({ ...prev, [currentSessionId]: messageCount }));
        }
      }
      
      // Load cached conversation for the new session or start fresh
      const cachedConversation = conversationCache[sessionId] || [];
      const cachedMessageCount = messageCountCache[sessionId] || 0;
      
      setConversation(cachedConversation);
      setMessageCount(cachedMessageCount);
      
      // Load session data
      loadSessionData(sessionId);
      
      // Reset form state
      setQueryInput("");
      setTextInput("");
      setPageContent("");
      setFileSelected(false);
      setDataSource("text");
      setShowDataSection(true);
      setInjectionStatus({ message: "", type: "" });
    }
  }, [sessionId]);

  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  // Generate title after 2nd or 3rd turn
  useEffect(() => {
    if (messageCount >= 2 && messageCount <= 3 && onTitleGenerated) {
      generateTitle();
    }
  }, [messageCount, sessionId, onTitleGenerated]);

  const loadSessionData = async (sessionId: string) => {
    try {
      const data = await getSessionData(sessionId, 50, 0);
      // Ensure data is an array
      setSessionData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("[ChatWindow] Failed to load session data:", err);
      setSessionData([]); // Reset to empty array on error
    }
  };

  const generateTitle = async () => {
    try {
      const { title } = await generateConversationTitle(sessionId);
      if (onTitleGenerated) {
        onTitleGenerated(sessionId, title);
      }
    } catch (err) {
      console.warn("[ChatWindow] Failed to generate title:", err);
    }
  };

  const addTimestamp = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const addToConversation = (question?: string, response?: string, error: boolean = false, responseData?: AgentResponse) => {
    let requiresAction = false;
    
    // Safe check for action requirement
    if (responseData) {
      try {
        requiresAction = requiresUserAction(responseData);
      } catch (err) {
        console.warn('[ChatWindow] Error checking action requirement:', err);
        requiresAction = false;
      }
    }
    
    const newItem: ConversationItem = {
      question,
      response,
      error,
      timestamp: addTimestamp(),
      responseType: responseData?.response_type,
      confidenceScore: responseData?.confidence_score,
      sources: responseData?.sources,
      plan: responseData?.plan,
      nextActionHint: responseData?.next_action_hint,
      requiresAction
    };
    
    const updatedConversation = [...conversation, newItem];
    const updatedMessageCount = messageCount + 1;
    
    setConversation(updatedConversation);
    setMessageCount(updatedMessageCount);
    
    // Update cache for current session
    if (sessionId) {
      setConversationCache(prev => ({ ...prev, [sessionId]: updatedConversation }));
      setMessageCountCache(prev => ({ ...prev, [sessionId]: updatedMessageCount }));
    }
  };

  const getPageContent = async () => {
    try {
      setInjectionStatus({ message: "🔄 Analyzing page content...", type: "" });
      
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error("No active tab found");
      }

      const response = await browser.tabs.sendMessage(tab.id, { action: "getPageContent" });
      
      if (response && response.content) {
        setPageContent(response.content);
        setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
      } else {
        throw new Error("Failed to capture page content");
      }
    } catch (err) {
      console.error("[ChatWindow] getPageContent error:", err);
      setInjectionStatus({ 
        message: "⚠️ Failed to capture page content. Please ensure the page is fully loaded.", 
        type: "error" 
      });
    }
  };

  const sendToFaultMaven = async (query: string) => {
    if (!sessionId) {
      addToConversation(undefined, "<p><strong>Error:</strong> No session available. Please refresh the page.</p>", true);
      return;
    }

    setLoading(true);

    try {
      const request: QueryRequest = {
        session_id: sessionId,
        query,
        priority: "normal",
        context: {
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          uploaded_data_ids: Array.isArray(sessionData) ? sessionData.map(d => d.data_id) : []
        }
      };

      const response: AgentResponse = await processQuery(request);
      
      // Backend now sends spec-compliant plain text content
      const responseContent = response.content || '';
      
      // Debug logging to help identify backend issues
      console.log('[ChatWindow] Query sent:', query);
      console.log('[ChatWindow] Response received:', {
        response_type: response.response_type,
        content_length: responseContent.length,
        content_preview: responseContent.substring(0, 100) + (responseContent.length > 100 ? '...' : ''),
        full_response: response
      });
      
      // Add both question and response in a single conversation item
      addToConversation(query, responseContent, false, response);
      
      // Update session data if new data was uploaded
      if (response.response_type === ResponseType.NEEDS_MORE_DATA) {
        await loadSessionData(sessionId);
      }
      
    } catch (e: unknown) {
      console.error("[ChatWindow] sendToFaultMaven error:", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      addToConversation(undefined, `<p><strong>Error:</strong> Failed to process query: ${errorMessage}</p>`, true);
    } finally {
      setLoading(false);
    }
  };

  const sendDataToFaultMaven = async () => {
    setLoading(true);
    let dataToSend: string | File | null = null;
    if (dataSource === "text") dataToSend = textInput.trim();
    else if (dataSource === "file" && fileInputRef.current?.files?.[0]) dataToSend = fileInputRef.current.files[0];
    else if (dataSource === "page") dataToSend = pageContent;

    if (!dataToSend) {
      addToConversation(undefined, "<p><strong>Error:</strong> No data to submit.</p>", true);
      setLoading(false);
      return;
    }

    addToConversation(`Uploading ${dataSource} data...`, undefined);
    try {
      const response: UploadedData = await uploadData(sessionId, dataToSend, dataSource);
      
      // Format response with enhanced insights
      let formattedResponse = `✅ Data uploaded successfully (ID: ${response.data_id})`;
      
      if (response.data_type && response.data_type !== 'unknown') {
        formattedResponse += `\n\n**Data Type:** ${response.data_type.replace('_', ' ').toUpperCase()}`;
      }
      
      if (response.file_name) {
        formattedResponse += `\n\n**File:** ${response.file_name}`;
      }
      
      if (response.file_size) {
        formattedResponse += `\n\n**Size:** ${(response.file_size / 1024).toFixed(2)} KB`;
      }
      
      if (response.insights) {
        formattedResponse += `\n\n**Initial Insights:**\n${JSON.stringify(response.insights, null, 2)}`;
      }
      
      addToConversation(undefined, formattedResponse);
      
      // Update session data
      await loadSessionData(sessionId);
      
      // Clear the input after successful upload
      if (dataSource === "text") {
        setTextInput("");
      } else if (dataSource === "file") {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFileSelected(false);
      } else if (dataSource === "page") {
        setPageContent("");
      }
      
    } catch (e: unknown) {
      console.error("[ChatWindow] sendDataToFaultMaven error:", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      addToConversation(undefined, `<p><strong>Error:</strong> Failed to upload data: ${errorMessage}</p>`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitQuery = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (queryInput.trim() && !loading) {
        sendToFaultMaven(queryInput.trim());
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

  const isSubmitEnabled =
    !loading &&
    ((dataSource === "text" && textInput.trim()) ||
    (dataSource === "file" && fileSelected) ||
    (dataSource === "page" && !!pageContent.trim()));

  return (
    <div className={`flex flex-col h-full space-y-1 overflow-y-auto ${className}`}>
      {/* Conversation History */}
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-grow overflow-y-auto bg-white border border-gray-300 rounded-lg p-2 min-h-0">
        {Array.isArray(conversation) && conversation.map((item, index) => (
          <React.Fragment key={index}>
            {item.question && (
              <div className="flex justify-end mb-1">
                <div className="w-full mx-1 px-2 py-1 text-sm text-gray-900 bg-gray-100 rounded">
                  <p className="break-words m-0">{item.question}</p>
                  <div className="text-[10px] text-gray-400 mt-1">{item.timestamp}</div>
                </div>
              </div>
            )}
            {item.response && (
              <div className="flex justify-end mb-1">
                <div className={`w-full mx-1 px-2 py-1 text-sm ${item.error ? "text-red-700" : "text-gray-800"} border-t border-b border-gray-200 rounded`}> 
                  <pre className="break-words mb-1 whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                    {item.response || ''}
                  </pre>
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center justify-between">
                    <span>{item.timestamp}</span>
                    {item.requiresAction && (
                      <span className="text-orange-600 text-xs font-medium">⚠️ Action Required</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        {(!Array.isArray(conversation) || conversation.length === 0) && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <h2 className="text-base font-semibold text-gray-800 mb-2">Welcome to FaultMaven Copilot!</h2>
            <p className="text-sm text-gray-600 mb-4">Your AI troubleshooting partner.</p>
            <p className="text-sm text-gray-500 bg-gray-100 p-3 rounded-md max-w-sm">
              To get started, provide context using the options below or ask a question directly, like <em>"What's the runbook for a database failover?"</em>
            </p>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex-shrink-0 text-center p-1 text-xs text-gray-600 my-1">
          <LoadingSpinner size="sm" />
          <span className="ml-2">Thinking...</span>
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
          disabled={loading}
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
                      disabled={loading}
                    />
                    {value === "text" ? "Type or Paste Logs" : value === "file" ? "Upload a File" : "Analyze Page Content"}
                  </label>
                ))}
              </div>
              <button
                id="submit-data"
                onClick={sendDataToFaultMaven}
                disabled={!isSubmitEnabled || loading}
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
                disabled={loading}
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
                disabled={loading}
              />
            )}

            {dataSource === "page" && (
              <div className="mt-2 space-y-2">
                <button
                  id="analyze-page-button"
                  onClick={getPageContent}
                  disabled={loading}
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
      
      {/* Session Data Summary */}
      {sessionData.length > 0 && (
        <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-2 shadow-sm">
          <div className="flex justify-between items-center border-b border-gray-200 pb-1 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Session Data</h3>
            <span className="text-xs text-gray-500">{sessionData.length} items</span>
          </div>
          <div className="space-y-1 max-h-20 overflow-y-auto">
            {Array.isArray(sessionData) && sessionData.slice(0, 3).map((item, index) => (
              <div key={index} className="text-xs text-gray-600 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                <span className="truncate">{item.file_name || item.data_type}</span>
                <span className="text-gray-400">({item.data_type})</span>
              </div>
            ))}
            {Array.isArray(sessionData) && sessionData.length > 3 && (
              <div className="text-xs text-gray-400 italic">
                +{sessionData.length - 3} more items
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}