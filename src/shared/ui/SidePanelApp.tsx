// src/shared/ui/SidePanelApp.tsx
import React, { useState, useEffect } from "react";
import { browser } from "wxt/browser";
import { 
  heartbeatSession, 
  createSession,
  listSessions
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
  const [hasUnsavedNewChat, setHasUnsavedNewChat] = useState(false);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [refreshSessions, setRefreshSessions] = useState(0);

  useEffect(() => {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    
    const initializeSession = async () => {
      try {
        // Only load existing sessions, do NOT create new ones automatically
        // Sessions should only be created when user submits first query/data
        
        try {
          const sessionList = await listSessions({ limit: 1, offset: 0 });
          
          if (Array.isArray(sessionList) && sessionList.length > 0) {
            // Rule (4): Auto-load most recent chat if available
            const mostRecentSession = sessionList[0];
            setSessionId(mostRecentSession.session_id);
            setHasUnsavedNewChat(false);
            
            // Store in browser storage
            await browser.storage.local.set({ sessionId: mostRecentSession.session_id });
            console.log("[SidePanelApp] Auto-loaded most recent session:", mostRecentSession.session_id);
            
            // Start heartbeat for the loaded session
            if (mostRecentSession.session_id) {
              heartbeatInterval = setInterval(() => {
                heartbeatSession(mostRecentSession.session_id).catch(err => {
                  console.warn("[SidePanelApp] Heartbeat failed:", err);
                });
              }, 300000); // 5 minutes (300000ms)
            }
          } else {
            // No sessions available - show blank chat window ready for input
            // DO NOT create session automatically - session created only when user submits first query/data
            console.log("[SidePanelApp] No existing sessions found, showing blank chat window");
            setSessionId(null); // No active session yet
            setHasUnsavedNewChat(true); // Ready for new chat input
          }
        } catch (sessionLoadError) {
          console.warn("[SidePanelApp] Failed to load existing sessions:", sessionLoadError);
          // Even if we can't load sessions, show blank chat window ready for input
          // Session will be created when user submits first query/data
          setSessionId(null);
          setHasUnsavedNewChat(true);
        }
        
        setServerError(null);
      } catch (err) {
        console.error("[SidePanelApp] Session initialization error:", err);
        setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
        // When server is unreachable, still prepare for new chat input instead of showing welcome message
        setSessionId(null);
        setHasUnsavedNewChat(true);
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
      // Rule (3): Selecting a chat loads that conversation
      setSessionId(selectedSessionId);
      setHasUnsavedNewChat(false); // Clear new chat status when selecting existing chat
      
      // Update storage to remember the last active session
      browser.storage.local.set({ sessionId: selectedSessionId }).catch(err => {
        console.warn('[SidePanelApp] Failed to save session to storage:', err);
      });
      
      console.log("[SidePanelApp] Selected existing session:", selectedSessionId);
    }
  };

  const handleNewSession = (newChatId: string) => {
    if (typeof newChatId === 'string') {
      if (newChatId === '') {
        // User clicked "New Chat" - clear active session and prepare for new input
        // No chat window shown until user submits first query/data
        setSessionId(null);
        setHasUnsavedNewChat(true); // Mark that we're ready for a new chat
        console.log("[SidePanelApp] Prepared for new chat (no session or window yet)");
      } else {
        // Actual session ID provided (existing session selected)
        setSessionId(newChatId);
        setHasUnsavedNewChat(false);
        
        // Store real session IDs in browser storage
        browser.storage.local.set({ sessionId: newChatId }).catch(err => {
          console.warn('[SidePanelApp] Failed to save session to storage:', err);
        });
        
        console.log("[SidePanelApp] Selected existing session:", newChatId);
      }
    }
  };

  const handleChatSaved = () => {
    // Called when the first query or data is submitted in a new chat
    setHasUnsavedNewChat(false);
    console.log("[SidePanelApp] New chat saved after first interaction");
  };

  const handleSessionCreated = (newSessionId: string) => {
    // Called when ChatWindow creates a new session on first interaction
    setSessionId(newSessionId);
    setHasUnsavedNewChat(false); // Session is now created and saved
    
    // Update storage with real session ID
    browser.storage.local.set({ sessionId: newSessionId }).catch(err => {
      console.warn('[SidePanelApp] Failed to save new session to storage:', err);
    });
    
    // Trigger refresh of sessions list so new session appears in left panel
    setRefreshSessions(prev => prev + 1);
    
    console.log("[SidePanelApp] Session created by ChatWindow:", newSessionId);
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
      // Test connection by trying to list sessions instead of creating one
      const sessionList = await listSessions({ limit: 1, offset: 0 });
      
      if (Array.isArray(sessionList)) {
        // Connection successful - do not auto-create session
        console.log("[SidePanelApp] Connection retry successful");
        if (sessionList.length > 0) {
          setSessionId(sessionList[0].session_id);
          setHasUnsavedNewChat(false);
          await browser.storage.local.set({ sessionId: sessionList[0].session_id });
        } else {
          setSessionId(null); // No sessions available, show blank chat window
          setHasUnsavedNewChat(true); // Ready for new chat input
        }
      } else {
        setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
      }
    } catch (err) {
      console.error("[SidePanelApp] Retry connection error:", err);
      setServerError("Unable to connect to FaultMaven server. Please check your connection and try again.");
    }
  };






  const renderCopilotTab = () => {
    if (!sessionId || sessionId === '') {
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
      
      // If user clicked "New Chat" and we're ready for input, show ChatWindow
      // Otherwise show empty state
      if (hasUnsavedNewChat) {
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
                  activeSessionId={sessionId || undefined}
                  onSessionSelect={handleSessionSelect}
                  onNewSession={handleNewSession}
                  conversationTitles={conversationTitles}
                  hasUnsavedNewChat={hasUnsavedNewChat}
                  refreshTrigger={refreshSessions}
                  className="h-full"
                />
              </ErrorBoundary>
            </div>

            {/* Chat Window - Right Pane (for new chat input) */}
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
                  onChatSaved={handleChatSaved}
                  onSessionCreated={handleSessionCreated}
                  isNewUnsavedChat={hasUnsavedNewChat}
                  className="h-full"
                />
              </ErrorBoundary>
            </div>
          </div>
        );
      }
      
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md p-6">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to troubleshoot?</h3>
            <p className="text-gray-600 mb-4">Select an existing chat from the left panel or click "New Chat" to start fresh.</p>
            <p className="text-sm text-gray-500">
              You can type your question directly in any chat, and all your conversations will be saved automatically.
            </p>
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
              activeSessionId={sessionId || undefined}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              conversationTitles={conversationTitles}
              hasUnsavedNewChat={hasUnsavedNewChat}
              refreshTrigger={refreshSessions}
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
              onChatSaved={handleChatSaved}
              onSessionCreated={handleSessionCreated}
              isNewUnsavedChat={hasUnsavedNewChat}
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
