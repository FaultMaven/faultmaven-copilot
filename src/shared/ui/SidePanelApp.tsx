// src/shared/ui/SidePanelApp.tsx
import React, { useState, useRef, useEffect } from "react";
import { browser } from "wxt/browser";
import { sendMessageToBackground } from "../../lib/utils/messaging";
import { processQuery, uploadData, QueryRequest } from "../../lib/api";
import config from "../../config";
import KnowledgeBaseView from "./KnowledgeBaseView";
import { createSession, sendQuery, uploadData, heartbeatSession } from "../../lib/api";

export default function SidePanelApp() {
  const [activeTab, setActiveTab] = useState<'copilot' | 'kb'>('copilot');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Array<{ question?: string; response?: string; error?: boolean }>>([]);
  const [queryInput, setQueryInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [fileSelected, setFileSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [injectionStatus, setInjectionStatus] = useState({ message: "", type: "" as "success" | "error" | "" });

  const dataSourceRef = useRef<"text" | "file" | "page">("text");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationHistoryRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useState({}); // Helper to re-render on ref change

  useEffect(() => {
    // Try to load existing session from storage
    chrome.storage.local.get(["sessionId"], (result) => {
      if (result.sessionId) {
        console.log("[SidePanelApp] Found existing session:", result.sessionId);
        setSessionId(result.sessionId);
        
        // Start heartbeat for existing session
        setInterval(() => {
          heartbeatSession(result.sessionId).catch(err => 
            console.warn("[SidePanelApp] Heartbeat failed:", err)
          );
        }, 30000);
      } else {
        // Create new session if none exists
        getSessionId();
      }
    });
  }, []);

  const getSessionId = async () => {
    console.log("[SidePanelApp] Creating new session...");
    try {
      const res = await createSession();
      console.log("[SidePanelApp] createSession response:", res);
      setSessionId(res.session_id);
      
      // Store session ID in browser storage for persistence
      chrome.storage.local.set({ sessionId: res.session_id });
      
      // Start heartbeat to keep session alive
      setInterval(() => {
        if (res.session_id) {
          heartbeatSession(res.session_id).catch(err => 
            console.warn("[SidePanelApp] Heartbeat failed:", err)
          );
        }
      }, 30000); // Heartbeat every 30 seconds
      
    } catch (err) {
      console.error("createSession error:", err);
      setInjectionStatus({ message: "⚠️ Failed to create session. Please try again.", type: "error" });
    }
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
      setPageContent(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileSelected(false);
      
      // Clear stored session
      chrome.storage.local.remove("sessionId");
      
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
    setPageContent(null);
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id || !tab?.url?.startsWith("http")) {
        console.warn("[SidePanelApp] Cannot analyze page:", tab?.url);
        setInjectionStatus({ message: "⚠️ Cannot analyze this type of page.", type: "error" });
        return;
      }
      const res: any = await browser.tabs.sendMessage(tab.id!, { action: "getPageContent" });
      console.log("[SidePanelApp] getPageContent response from CS:", res);
      if (res?.status === "success") {
        setInjectionStatus({ message: `✅ Page selected (${res.url})`, type: "success" });
        setPageContent(res.data);
      } else {
        setInjectionStatus({ message: `⚠️ ${res?.message ?? "Error getting content."}`, type: "error" });
      }
    } catch (e: any) {
      console.error("[SidePanelApp] getPageContent catch error:", e);
      if (e.message && (e.message.includes("Could not establish connection") || e.message.includes("No matching message handler"))) {
        setInjectionStatus({ message: "⚠️ Failed to connect to page. Is it example.com? Try refreshing the page/extension.", type: "error" });
      } else {
        setInjectionStatus({ message: `⚠️ ${e.message || "Unknown error analyzing page."}`, type: "error" });
      }
    }
  };

  const addToConversation = (question?: string, response?: string, isError = false) => {
    setConversation(prev => [...prev, { question, response, error: isError }]);
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
<<<<<<< Updated upstream
      console.log("[SidePanelApp] Using API endpoint:", config.apiUrl);
      
      if (!sessionId) {
        throw new Error("No session ID available");
      }

      const response = await sendQuery({
        session_id: sessionId,
        query: query,
        priority: "normal",
        context: {
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          page_content: pageContent || undefined,
          text_data: dataSourceRef.current === "text" ? textInput.trim() : undefined,
        }
      });

      console.log("[SidePanelApp] API response:", response);
      
      // Format response with findings and recommendations if available
      let formattedResponse = response.response;
      if (response.findings && response.findings.length > 0) {
        formattedResponse += "\n\n**Findings:**\n" + response.findings.map(f => `• ${f}`).join('\n');
      }
      if (response.recommendations && response.recommendations.length > 0) {
        formattedResponse += "\n\n**Recommendations:**\n" + response.recommendations.map(r => `• ${r}`).join('\n');
      }
      if (response.confidence_score !== undefined) {
        formattedResponse += `\n\n**Confidence:** ${Math.round(response.confidence_score * 100)}%`;
      }
      
      addToConversation(undefined, formattedResponse);
=======
      
      const request: QueryRequest = {
        session_id: sessionId,
        query: query,
        context: pageContent ? { page_content: pageContent } : undefined,
      };

      const response = await processQuery(request);
      console.log("[SidePanelApp] Query response:", response);
      
      // Format the response for display
      let responseText = `<div class="space-y-3">`;
      
      if (response.root_cause) {
        responseText += `<div><strong>Root Cause:</strong> ${response.root_cause}</div>`;
      }
      
      if (response.findings && response.findings.length > 0) {
        responseText += `<div><strong>Findings:</strong><ul class="list-disc list-inside ml-2">`;
        response.findings.forEach(finding => {
          responseText += `<li><em>${finding.type}:</em> ${finding.message}</li>`;
        });
        responseText += `</ul></div>`;
      }
      
      if (response.recommendations && response.recommendations.length > 0) {
        responseText += `<div><strong>Recommendations:</strong><ul class="list-disc list-inside ml-2">`;
        response.recommendations.forEach(rec => {
          responseText += `<li>${rec}</li>`;
        });
        responseText += `</ul></div>`;
      }
      
      if (response.next_steps && response.next_steps.length > 0) {
        responseText += `<div><strong>Next Steps:</strong><ol class="list-decimal list-inside ml-2">`;
        response.next_steps.forEach(step => {
          responseText += `<li>${step}</li>`;
        });
        responseText += `</ol></div>`;
      }
      
      if (response.confidence_score) {
        responseText += `<div class="text-sm text-gray-600"><strong>Confidence:</strong> ${Math.round(response.confidence_score * 100)}%</div>`;
      }
      
      responseText += `</div>`;
      
      addToConversation(undefined, responseText);
>>>>>>> Stashed changes
    } catch (e: any) {
      console.error("[SidePanelApp] sendToFaultMaven error:", e);
      addToConversation(undefined, `<p><strong>Error:</strong> Failed to process query: ${e.message}</p>`, true);
    } finally {
      setLoading(false);
    }
  };

  const sendDataToFaultMaven = async () => {
    setLoading(true);
    let dataToSend: string | File | null = null;
    if (dataSourceRef.current === "text") dataToSend = textInput.trim();
    else if (dataSourceRef.current === "file" && fileInputRef.current?.files?.[0]) dataToSend = fileInputRef.current.files[0];
    else if (dataSourceRef.current === "page") dataToSend = pageContent;

    if (!dataToSend) {
      addToConversation(undefined, "<p><strong>Error:</strong> No data to submit.</p>", true);
      setLoading(false);
      return;
    }
    addToConversation(`Uploading ${dataSourceRef.current} data...`, undefined);
    try {
      console.log("[SidePanelApp] Uploading data to FaultMaven backend. Type:", dataSourceRef.current, "Session:", sessionId);
      console.log("[SidePanelApp] Using API endpoint:", config.apiUrl);
      
      if (!sessionId) {
        throw new Error("No session ID available");
      }

      const response = await uploadData(sessionId, dataToSend, dataSourceRef.current);

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
      if (dataSourceRef.current === "text") {
        setTextInput("");
      } else if (dataSourceRef.current === "file") {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFileSelected(false);
      } else if (dataSourceRef.current === "page") {
        setPageContent(null);
      }
      
    } catch (e: any) {
      console.error("[SidePanelApp] sendDataToFaultMaven error:", e);
      addToConversation(undefined, `<p><strong>Error:</strong> Failed to upload data: ${e.message}</p>`, true);
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
    dataSourceRef.current = value;
    setInjectionStatus({ message: "", type: "" });
    setTextInput("");
    setFileSelected(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPageContent(null);
    forceUpdate({});
  };

  const isSubmitEnabled =
    !loading &&
    ((dataSourceRef.current === "text" && textInput.trim()) ||
    (dataSourceRef.current === "file" && fileSelected) ||
    (dataSourceRef.current === "page" && !!pageContent?.trim()));

  const renderCopilotTab = () => (
    <div className="flex flex-col h-full space-y-3 overflow-y-auto">
      <div id="conversation-history" ref={conversationHistoryRef} className="flex-grow overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-sm p-3 min-h-0">
        {/* ... conversation mapping logic ... */}
        {conversation.map((item, index) => (
          <React.Fragment key={index}>
            {item.question && (
              <div className="flex justify-end mb-2">
                <div className="max-w-[80%] bg-blue-50 text-blue-800 rounded-lg px-3 py-2 shadow text-sm">
                  <p className="font-semibold mb-0.5">You</p>
                  <p className="break-words">{item.question}</p>
                </div>
              </div>
            )}
            {item.response && (
              <div className="flex justify-start mb-2">
                <div className={`max-w-[80%] rounded-lg px-3 py-2 shadow text-sm ${item.error ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-800"}`}>
                  <p className="font-semibold mb-0.5">AI</p>
                  <div className="prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 whitespace-pre-wrap break-words">
                    {item.response}
                  </div>
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

      {/* "Ask a Question" Section - MODIFIED */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-4 shadow-sm space-y-2">
        {/* Container for Title and New Chat button on the same line */}
        <div className="flex justify-between items-center border-b border-gray-200 pb-1 mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Ask a Question</h3>
          <button
            id="new-chat-button" // Changed ID for clarity
            onClick={clearSession}
            disabled={loading}
            className="py-1 px-2.5 text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-300 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
            // Smaller padding, smaller text, lighter colors for less prominence
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

      {/* "Provide Data" Section */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-gray-200 p-4 shadow-sm space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600 border-b border-gray-200 pb-1 mb-2">Provide Data</h3>
        <div className="flex justify-between items-start">
          <div className="space-y-1 text-xs">
            {["text", "file", "page"].map((value) => (
              <label key={value} className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="data-source"
                  value={value}
                  checked={dataSourceRef.current === value}
                  onChange={handleDataSourceChange}
                  className="accent-blue-500"
                  disabled={loading}
                />
                {value === "text" ? "Type or Paste Logs" : value === "file" ? "Upload a File" : "Analyze Page Content"}
              </label>
            ))}
          </div>
          {/* "Submit Data" button color reverted to green */}
          <button
            id="submit-data"
            onClick={sendDataToFaultMaven}
            disabled={!isSubmitEnabled || loading}
            className="w-36 text-center py-1.5 px-3 text-xs font-medium bg-gray-200 text-gray-800 border border-gray-300 rounded hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Data
          </button>
        </div>

        {dataSourceRef.current === "text" && (
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

        {dataSourceRef.current === "file" && (
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

        {dataSourceRef.current === "page" && (
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
      </div>
      
      {/* Old full-width "New Conversation" button at the bottom is removed */}
    </div>
  );

  return (
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
  );
}
