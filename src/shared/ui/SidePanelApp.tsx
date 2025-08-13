// src/shared/ui/SidePanelApp.tsx
import React, { useState, useRef, useEffect } from "react";
import { browser } from "wxt/browser";
import DOMPurify from 'dompurify';
// import { sendMessageToBackground } from "../../lib/utils/messaging"; // unused
import { processQuery, uploadData, QueryRequest, heartbeatSession } from "../../lib/api";
import config from "../../config";
import KnowledgeBaseView from "./KnowledgeBaseView";
import { createSession } from "../../lib/api";
import { formatResponse } from "../../lib/utils/formatter";
import { ErrorBoundary } from "./components/ErrorBoundary";

// TypeScript interfaces for better type safety
interface StorageResult {
  sessionId?: string;
  sessionCreatedAt?: number;
}

interface MessageResponse {
  status: 'success' | 'error';
  data?: string;
  url?: string;
  message?: string;
}

interface ConversationItem {
  question?: string;
  response?: string;
  error?: boolean;
  timestamp: string;
}

export default function SidePanelApp() {
  const [activeTab, setActiveTab] = useState<'copilot' | 'kb'>('copilot');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pageContent, setPageContent] = useState<string>("");
  const [fileSelected, setFileSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [injectionStatus, setInjectionStatus] = useState<{ message: string; type: 'success' | 'error' | '' }>({ message: "", type: "" });
  const [showDataSection, setShowDataSection] = useState(true);
  const [dataSource, setDataSource] = useState<"text" | "file" | "page">("text");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    
    const initializeSession = async () => {
      try {
        const result = await browser.storage.local.get(["sessionId"]) as StorageResult;
        let currentSessionId = result.sessionId;
        
        if (currentSessionId) {
          console.log("[SidePanelApp] Found existing session:", currentSessionId);
          setSessionId(currentSessionId);
        } else {
          // Create new session if none exists
          console.log("[SidePanelApp] Creating new session...");
          const session = await createSession();
          currentSessionId = session.session_id;
          setSessionId(currentSessionId);
          
          // Store session ID in browser storage for persistence
          await browser.storage.local.set({ sessionId: currentSessionId });
        }
        
        // Start single heartbeat interval for the session
        if (currentSessionId) {
          heartbeatInterval = setInterval(() => {
            heartbeatSession(currentSessionId).catch(err => 
              console.warn("[SidePanelApp] Heartbeat failed:", err)
            );
          }, 30000);
        }
      } catch (err) {
        console.error("[SidePanelApp] Session initialization error:", err);
        setInjectionStatus({ message: "⚠️ Failed to initialize session. Please try again.", type: "error" });
      }
    };
    
    initializeSession();
    
    // Cleanup interval on unmount
    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    };
  }, []);

  const addTimestamp = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const getSessionId = async () => {
    // This function is now handled by the useEffect hook
    // to prevent duplicate session creation
    console.log("[SidePanelApp] getSessionId called - session managed by useEffect");
  };

  const clearSession = async () => {
    const isConfirmed = window.confirm(
      'Are you sure you want to clear this session and start a new investigation?'
    );
    
    if (!isConfirmed) {
      return;
    }
    
    console.log("[SidePanelApp] Clearing session and starting new...");
    try {
      // Clear local state
      setSessionId(null);
      setConversation([]);
      setQueryInput("");
      setTextInput("");
      setPageContent("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileSelected(false);
      
      // Clear stored session
      browser.storage.local.remove("sessionId");
      
      // Create new session
      await getSessionId();
      setInjectionStatus({ message: "✅ New session created", type: "success" });
    } catch (err) {
      console.error("[SidePanelApp] clearSession error:", err);
      setInjectionStatus({ message: "⚠️ Failed to start new conversation.", type: "error" });
    }
  };

  const getPageContent = async () => {
    console.log("[SidePanelApp] getPageContent called");
    setInjectionStatus({ message: "Analyzing page...", type: "success" });
    setPageContent("");
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id || !tab?.url?.startsWith("http")) {
        console.warn("[SidePanelApp] Cannot analyze page:", tab?.url);
        setInjectionStatus({ message: "⚠️ Cannot analyze this type of page.", type: "error" });
        return;
      }
      const res = await browser.tabs.sendMessage(tab.id!, { action: "getPageContent" }) as MessageResponse;
      console.log("[SidePanelApp] getPageContent response from CS:", res);
      if (res?.status === "success") {
        setInjectionStatus({ message: `✅ Page selected (${res.url})`, type: "success" });
        setPageContent(res.data || "");
      } else {
        setInjectionStatus({ message: `⚠️ ${res?.message ?? "Error getting content."}`, type: "error" });
      }
    } catch (e: unknown) {
      console.error("[SidePanelApp] getPageContent catch error:", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage && (errorMessage.includes("Could not establish connection") || errorMessage.includes("No matching message handler"))) {
        setInjectionStatus({ message: "⚠️ Failed to connect to page. Is it example.com? Try refreshing the page/extension.", type: "error" });
      } else {
        setInjectionStatus({ message: `⚠️ ${errorMessage || "Unknown error analyzing page."}`, type: "error" });
      }
    }
  };

  const addToConversation = (question?: string, response?: string, isError = false) => {
    setConversation(prev => [...prev, { question, response, error: isError, timestamp: addTimestamp() }]);
    setTimeout(() => {
      if (conversationHistoryRef.current) {
        conversationHistoryRef.current.scrollTo({ top: conversationHistoryRef.current.scrollHeight, behavior: "smooth" });
      }
    }, 100);
  };

  const sendToFaultMaven = async (query: string) => {
    if (!sessionId) {
      addToConversation(undefined, `<p><strong>Error:</strong> No session ID available. Please try refreshing the extension.</p>`, true);
      return;
    }

    setLoading(true);
    addToConversation(query, undefined);
    try {
      console.log("[SidePanelApp] Sending query to FaultMaven backend:", query, "Session:", sessionId);
      console.log("[SidePanelApp] Using API endpoint:", config.apiUrl);
      
      if (!sessionId) {
        throw new Error("No session ID available");
      }

      const request: QueryRequest = {
        session_id: sessionId,
        query: query,
        priority: "normal",
        context: {
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          page_content: pageContent || undefined,
          text_data: dataSource === "text" ? textInput.trim() : undefined,
        }
      };

      const response = await processQuery(request);
      console.log("[SidePanelApp] API response:", response);
      
      // Display the main response naturally
      let formattedResponse = response.response || "";
      
      // Check if main response is minimal and we have richer content in findings
      const hasMinimalResponse = !formattedResponse || formattedResponse.trim().length < 50;
      let primaryContentFound = false;
      
      // Only add additional sections if they provide meaningful extra information
      // that's not already contained in the main response
      const formatAdditionalItem = (item: any): string => {
        if (item == null) return "";
        if (typeof item === 'string') return item;
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        
        // Handle structured items (like finding objects)
        if (typeof item === 'object') {
          // Prioritize detailed content over brief messages
          if (item.details) return item.details;
          if (item.description) return item.description;
          if (item.message) return item.message;
          if (item.title) return item.title;
          if (item.name) return item.name;
          
          // Log unknown structures for debugging
          console.log("Unknown item structure:", item);
          return JSON.stringify(item, null, 2);
        }
        
        return String(item);
      };

      // Only show findings if they exist and contain useful additional information
      if (response.findings && response.findings.length > 0) {
        const meaningfulFindings = response.findings
          .map(formatAdditionalItem)
          .filter(finding => finding.trim().length > 0);
        
        if (meaningfulFindings.length > 0) {
          // If main response is minimal and we have detailed findings, use the detailed content as primary
          if (hasMinimalResponse && meaningfulFindings.some(f => f.length > 100)) {
            // Find the most detailed finding to use as primary content
            const detailedFinding = meaningfulFindings.find(f => f.length > 100);
            if (detailedFinding && !primaryContentFound) {
              formattedResponse = detailedFinding;
              primaryContentFound = true;
              
              // Add remaining findings as additional points if any
              const remainingFindings = meaningfulFindings.filter(f => f !== detailedFinding);
              if (remainingFindings.length > 0) {
                formattedResponse += "\n\n" + remainingFindings.map(f => `• ${f}`).join('\n');
              }
            }
          } else {
            // Normal case: add findings as additional bullet points
            formattedResponse += "\n\n" + meaningfulFindings.map(f => `• ${f}`).join('\n');
          }
        }
      }
      
      // Only show recommendations if they exist and are meaningful
      if (response.recommendations && response.recommendations.length > 0) {
        const meaningfulRecommendations = response.recommendations
          .map(formatAdditionalItem)
          .filter(rec => rec.trim().length > 0);
        
        if (meaningfulRecommendations.length > 0) {
          formattedResponse += "\n\n**Recommended actions:**\n" + meaningfulRecommendations.map(r => `• ${r}`).join('\n');
        }
      }
      
      addToConversation(undefined, formattedResponse);
    } catch (e: unknown) {
      console.error("[SidePanelApp] sendToFaultMaven error:", e);
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
      console.log("[SidePanelApp] Uploading data to FaultMaven backend. Type:", dataSource, "Session:", sessionId);
      console.log("[SidePanelApp] Using API endpoint:", config.apiUrl);
      
      if (!sessionId) {
        throw new Error("No session ID available");
      }

      const response = await uploadData(sessionId, dataToSend, dataSource);

      console.log("[SidePanelApp] Upload response:", response);
      
      // Format response with insights if available
      let formattedResponse = `✅ Data uploaded successfully (ID: ${response.data_id})`;
      if (response.insights) {
        formattedResponse += `\n\n**Initial Insights:**\n${response.insights}`;
      }
      if (response.filename) {
        formattedResponse += `\n\n**File:** ${response.filename}`;
      }
      
      addToConversation(undefined, formattedResponse);
      
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
      console.error("[SidePanelApp] sendDataToFaultMaven error:", e);
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
    // No need for force update with proper state management
  };

  const isSubmitEnabled =
    !loading &&
    ((dataSource === "text" && textInput.trim()) ||
    (dataSource === "file" && fileSelected) ||
    (dataSource === "page" && !!pageContent.trim()));

  const renderCopilotTab = () => (
    <div className="flex flex-col h-full space-y-1 overflow-y-auto">
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-grow overflow-y-auto bg-white border border-gray-300 rounded-lg p-2 min-h-0">
        {conversation.map((item, index) => (
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
                  <div
                    className="prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 break-words mb-1"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatResponse(item.response || '')) }}
                  />
                  <div className="text-[10px] text-gray-400 mt-1">{item.timestamp}</div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        {!conversation.length && !loading && (
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
          Thinking...
        </div>
      )}

      {/* "Ask a Question" Section - text button retained */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-2 shadow-sm space-y-1">
        <div className="flex justify-between items-center border-b border-gray-200 pb-1 mb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Ask a Question</h3>
          <button
            id="new-chat-button"
            onClick={clearSession}
            disabled={loading}
            className="py-0.5 px-2 text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-300 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            New Chat
          </button>
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

      {/* "Provide Data" Section with collapse/expand arrow */}
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
      
      {/* Old full-width "New Conversation" button at the bottom is removed */}
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-gray-50 text-gray-800 text-sm font-sans">
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-white">
          <button 
            onClick={() => setActiveTab('copilot')} 
            className={`flex-1 py-1 px-4 text-sm transition-colors border-b-2 ${
              activeTab === 'copilot' 
                ? 'text-blue-600 border-blue-500 font-semibold' 
                : 'text-gray-500 border-transparent font-medium hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Copilot
          </button>
          <button 
            onClick={() => setActiveTab('kb')} 
            className={`flex-1 py-1 px-4 text-sm transition-colors border-b-2 ${
              activeTab === 'kb' 
                ? 'text-blue-600 border-blue-500 font-semibold' 
                : 'text-gray-500 border-transparent font-medium hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Knowledge Base
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 p-3 overflow-hidden">
          {activeTab === 'copilot' ? renderCopilotTab() : <KnowledgeBaseView />}
        </div>
      </div>
    </ErrorBoundary>
  );
}
