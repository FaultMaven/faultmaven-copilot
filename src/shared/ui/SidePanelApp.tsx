// src/shared/ui/SidePanelApp.tsx
import React, { useState, useEffect } from "react";
import { browser } from "wxt/browser";
import { 
  heartbeatSession, 
  createSession
} from "../../lib/api";
import KnowledgeBaseView from "./KnowledgeBaseView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import ConversationsList from "./components/ConversationsList";
import { ChatWindow } from "./components/ChatWindow";

// TypeScript interfaces for better type safety
interface StorageResult {
  sessionId?: string;
  sessionCreatedAt?: number;
}

export default function SidePanelApp() {
  const [activeTab, setActiveTab] = useState<'copilot' | 'kb'>('copilot');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({});
  const [showConversationsList, setShowConversationsList] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    
    const initializeSession = async () => {
      try {
        const result = await browser.storage.local.get(["sessionId"]) as StorageResult;
        let currentSessionId = result.sessionId;
        
        // Validate the session ID format
        if (currentSessionId && typeof currentSessionId === 'string' && currentSessionId.trim()) {
          console.log("[SidePanelApp] Found existing session:", currentSessionId);
          setSessionId(currentSessionId);
        } else {
          // Create new session if none exists or invalid
          console.log("[SidePanelApp] Creating new session...");
          const session = await createSession();
          
          if (session && session.session_id) {
            currentSessionId = session.session_id;
            setSessionId(currentSessionId);
            setServerError(null); // Clear any previous errors
            
            // Store session ID in browser storage for persistence
            await browser.storage.local.set({ sessionId: currentSessionId });
          } else {
            console.error("[SidePanelApp] Failed to create session - invalid response:", session);
            setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
            return;
          }
        }
        
        // Start single heartbeat interval for the session
        if (currentSessionId && typeof currentSessionId === 'string') {
          heartbeatInterval = setInterval(() => {
            heartbeatSession(currentSessionId).catch(err => {
              console.warn("[SidePanelApp] Heartbeat failed:", err);
              // If heartbeat fails repeatedly, we might need to create a new session
            });
          }, 30000);
        }
      } catch (err) {
        console.error("[SidePanelApp] Session initialization error:", err);
        setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
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

  // Handle responsive design
  useEffect(() => {
    const handleResize = () => {
      setShowConversationsList(window.innerWidth >= 600);
    };
    
    handleResize(); // Set initial state
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSessionSelect = (selectedSessionId: string) => {
    if (selectedSessionId && typeof selectedSessionId === 'string') {
      setSessionId(selectedSessionId);
      // Update storage to remember the last active session
      browser.storage.local.set({ sessionId: selectedSessionId }).catch(err => {
        console.warn('[SidePanelApp] Failed to save session to storage:', err);
      });
    }
  };

  const handleNewSession = (newSessionId: string) => {
    if (newSessionId && typeof newSessionId === 'string') {
      setSessionId(newSessionId);
      // Update storage
      browser.storage.local.set({ sessionId: newSessionId }).catch(err => {
        console.warn('[SidePanelApp] Failed to save new session to storage:', err);
      });
    }
  };

  const handleTitleGenerated = (sessionId: string, title: string) => {
    setConversationTitles(prev => ({ ...prev, [sessionId]: title }));
  };

  const toggleConversationsList = () => {
    setShowConversationsList(!showConversationsList);
  };

  const retryConnection = async () => {
    setServerError(null);
    try {
      console.log("[SidePanelApp] Retrying server connection...");
      const session = await createSession();
      
      if (session && session.session_id) {
        setSessionId(session.session_id);
        await browser.storage.local.set({ sessionId: session.session_id });
      } else {
        setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
      }
    } catch (err) {
      console.error("[SidePanelApp] Retry connection error:", err);
      setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
    }
  };






  const renderCopilotTab = () => {
    if (!sessionId) {
      if (serverError) {
        return (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="mb-4">
                <svg className="w-12 h-12 text-red-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-600 font-medium mb-2">Server Connection Error</p>
                <p className="text-sm text-gray-600 mb-4">{serverError}</p>
                <button 
                  onClick={retryConnection}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          </div>
        );
      }
      
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-gray-600 mb-4">No session selected</p>
            <p className="text-sm text-gray-500">Create a new conversation to get started</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full">
        {/* Mobile hamburger menu button */}
        {!showConversationsList && (
          <button
            onClick={toggleConversationsList}
            className="md:hidden fixed top-4 left-4 z-10 p-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50"
            aria-label="Show conversations list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* Conversations List - Left Pane */}
        <div className={`${
          showConversationsList 
            ? 'w-80 flex-shrink-0' 
            : 'hidden'
        } bg-white border-r border-gray-200`}>
          <ErrorBoundary
            fallback={
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">Error loading conversations</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Retry
                </button>
              </div>
            }
          >
            <ConversationsList
              activeSessionId={sessionId}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              conversationTitles={conversationTitles}
              className="h-full"
            />
          </ErrorBoundary>
        </div>

        {/* Chat Window - Right Pane */}
        <div className="flex-1 min-w-0">
          <ErrorBoundary
            fallback={
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">Error loading chat</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Retry
                </button>
              </div>
            }
          >
            <ChatWindow
              sessionId={sessionId}
              onTitleGenerated={handleTitleGenerated}
              className="h-full"
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  };

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
        <div className="flex-1 overflow-hidden">
          {activeTab === 'copilot' ? (
            renderCopilotTab()
          ) : (
            <div className="p-3 h-full">
              <ErrorBoundary
                fallback={
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">Error loading Knowledge Base</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-2 px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Retry
                    </button>
                  </div>
                }
              >
                <KnowledgeBaseView serverError={serverError} onRetry={retryConnection} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
