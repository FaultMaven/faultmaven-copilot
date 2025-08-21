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
import { KnowledgeDocument, getKnowledgeDocument } from "../../lib/api";
import DocumentDetailsModal from "./components/DocumentDetailsModal";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasUnsavedNewChat, setHasUnsavedNewChat] = useState(false);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const [refreshSessions, setRefreshSessions] = useState(0);
  
  // Document viewing state
  const [viewingDocument, setViewingDocument] = useState<KnowledgeDocument | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);

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
      if (window.innerWidth < 600) {
        setSidebarCollapsed(true);
      }
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
  
  // Handle document viewing from sources
  const handleDocumentView = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsDocumentModalOpen(true);
      
      // Switch to Knowledge Base tab to provide context
      setActiveTab('kb');
    } catch (error) {
      console.error('[SidePanelApp] Failed to load document:', error);
      // Show error toast or notification here if needed
    }
  };

  const toggleConversationsList = () => {
    setShowConversationsList(!showConversationsList);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + B to toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      // Ctrl/Cmd + Shift + N for new chat
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        if (!hasUnsavedNewChat) {
          handleNewSession('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedNewChat]);

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






  // Render the collapsible sidebar
  const renderSidebar = () => {
    if (activeTab !== 'copilot') return null;

    return (
      <div className={`flex-shrink-0 bg-white border-r border-gray-200 transition-all duration-300 ${
        sidebarCollapsed ? 'w-16' : 'w-80 max-w-80'
      }`}>
        {sidebarCollapsed ? (
          // Collapsed sidebar - icons only
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
              <div className="flex items-center justify-center">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Main actions */}
            <div className="flex-1 p-3 space-y-3">
              <button
                onClick={() => handleNewSession('')}
                disabled={hasUnsavedNewChat}
                className="w-full h-10 flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                title="New Chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>

              <button
                onClick={toggleSidebar}
                className="w-full h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Expand Sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* User section */}
            <div className="flex-shrink-0 p-3 border-t border-gray-200">
              <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          // Expanded sidebar - full content
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h1 className="text-lg font-semibold text-gray-900">FaultMaven</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleSidebar}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Collapse Sidebar"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* New Chat Button */}
            <div className="flex-shrink-0 p-4">
              <button
                onClick={() => handleNewSession('')}
                disabled={hasUnsavedNewChat}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={hasUnsavedNewChat ? "Complete current new chat before starting another" : "Start new conversation"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium">New chat</span>
              </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary
                fallback={
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg m-4">
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
                  collapsed={false}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChatContent = () => {
    if (!sessionId || sessionId === '') {
      
      if (hasUnsavedNewChat) {
        return (
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
              onDocumentView={handleDocumentView}
              isNewUnsavedChat={hasUnsavedNewChat}
              className="h-full"
            />
          </ErrorBoundary>
        );
      }
      
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md p-6">
            {/* FaultMaven Logo */}
            <div className="mb-6">
              <img 
                src="/icon/square-light.svg" 
                alt="FaultMaven Logo" 
                className="w-20 h-20 mx-auto mb-4"
              />
            </div>
          </div>
        </div>
      );
    }

    return (
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
          onDocumentView={handleDocumentView}
          isNewUnsavedChat={hasUnsavedNewChat}
          className="h-full"
        />
      </ErrorBoundary>
    );
  };

  const renderMainContent = () => {
    return (
      <div className="flex w-full h-full">
        {/* Collapsible Sidebar */}
        {renderSidebar()}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 max-w-none">
          {/* Tab Navigation */}
          <div className="flex bg-white border-b border-gray-200 flex-shrink-0">
            <button
              onClick={() => setActiveTab('copilot')}
              className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'copilot'
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Copilot
            </button>
            <button
              onClick={() => setActiveTab('kb')}
              className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'kb'
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Knowledge Base
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Copilot Tab - Always rendered but hidden when not active */}
            <div className={`h-full ${activeTab === 'copilot' ? 'block' : 'hidden'}`}>
              {renderChatContent()}
            </div>
            
            {/* Knowledge Base Tab - Always rendered but hidden when not active */}
            <div className={`h-full ${activeTab === 'kb' ? 'block' : 'hidden'}`}>
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
                <KnowledgeBaseView className="h-full" />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50 text-gray-800 text-sm font-sans">
        {renderMainContent()}
      </div>
      
      {/* Document Details Modal */}
      <DocumentDetailsModal
        document={viewingDocument}
        isOpen={isDocumentModalOpen}
        onClose={() => {
          setIsDocumentModalOpen(false);
          setViewingDocument(null);
        }}
        onEdit={(doc) => {
          // TODO: Implement edit functionality if needed
          console.log('Edit document:', doc);
          setIsDocumentModalOpen(false);
          setViewingDocument(null);
        }}
      />
    </ErrorBoundary>
  );
}
