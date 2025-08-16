import React, { useState, useEffect } from 'react';
import { Session, listSessions, deleteSession, createSession } from '../../../lib/api';
import { ConversationItem } from './ConversationItem';
import LoadingSpinner from './LoadingSpinner';

interface ConversationsListProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: (sessionId: string) => void;
  conversationTitles?: Record<string, string>;
  className?: string;
}

export function ConversationsList({ 
  activeSessionId, 
  onSessionSelect, 
  onNewSession,
  conversationTitles = {},
  className = '' 
}: ConversationsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});

  // Load sessions on component mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const sessionList = await listSessions({ limit: 50, offset: 0 });
      
      // Debug: Log the actual response from backend
      console.log('[ConversationsList] Backend response:', sessionList);
      
      // Ensure sessionList is an array
      if (!Array.isArray(sessionList)) {
        console.warn('[ConversationsList] Expected array but got:', typeof sessionList, sessionList);
        setSessions([]);
        return;
      }
      
      // Sort sessions by last activity or created date with safety checks
      const sortedSessions = sessionList.sort((a, b) => {
        if (!a || !b) return 0;
        const dateA = new Date(a.last_activity || a.created_at || 0);
        const dateB = new Date(b.last_activity || b.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });
      
      setSessions(sortedSessions);
    } catch (err) {
      console.error('[ConversationsList] Failed to load sessions:', err);
      // Store the full error message for debugging
      const fullError = err instanceof Error ? err.message : String(err);
      console.log('[ConversationsList] Full error details:', fullError);
      setError(`Failed to list chats: ${fullError}`);
      setSessions([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    try {
      setCreatingNew(true);
      const newSession = await createSession();
      
      // Add to sessions list at the top
      setSessions(prev => [newSession, ...prev]);
      
      // Notify parent about new session
      onNewSession(newSession.session_id);
      
    } catch (err) {
      console.error('[ConversationsList] Failed to create new session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create new chat');
    } finally {
      setCreatingNew(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this chat?')) {
      return;
    }
    
    try {
      await deleteSession(sessionId);
      
      // Remove from sessions list with safety check
      setSessions(prev => Array.isArray(prev) ? prev.filter(s => s && s.session_id !== sessionId) : []);
      
      // Remove cached title
      setSessionTitles(prev => {
        const { [sessionId]: _, ...rest } = prev;
        return rest;
      });
      
      // If this was the active session, notify parent
      if (sessionId === activeSessionId) {
        const remainingSessions = sessions.filter(s => s.session_id !== sessionId);
        if (remainingSessions.length > 0) {
          onSessionSelect(remainingSessions[0].session_id);
        } else {
          // Create a new session if no sessions remain
          handleNewChat();
        }
      }
      
    } catch (err) {
      console.error('[ConversationsList] Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete chat');
    }
  };

  const getSessionTitle = (session: Session): string => {
    // Return title from props if available
    if (conversationTitles[session.session_id]) {
      return conversationTitles[session.session_id];
    }
    
    // Return cached title if available
    if (sessionTitles[session.session_id]) {
      return sessionTitles[session.session_id];
    }
    
    // Default title fallback
    return `Chat ${session.session_id.slice(-8)}`;
  };

  const updateSessionTitle = (sessionId: string, title: string) => {
    setSessionTitles(prev => ({ ...prev, [sessionId]: title }));
  };

  if (loading && sessions.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-white border-r border-gray-200 ${className}`}>
      {/* Header with New Chat Button */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <button
          onClick={handleNewChat}
          disabled={creatingNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Start new conversation"
        >
          {creatingNew ? (
            <>
              <LoadingSpinner size="sm" color="white" />
              <span className="text-sm font-medium">Creating...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium">New Chat</span>
            </>
          )}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex-shrink-0 p-3 mx-4 mt-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sessions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-3">No chats yet</p>
            <p className="text-xs text-gray-400">
              Click "New Chat" to start your first troubleshooting chat
            </p>
          </div>
        ) : (
          sessions.filter(session => session && session.session_id).map((session) => (
            <ConversationItem
              key={session.session_id}
              session={session}
              title={getSessionTitle(session)}
              isActive={session.session_id === activeSessionId}
              onSelect={onSessionSelect}
              onDelete={handleDeleteSession}
            />
          ))
        )}
      </div>

      {/* Refresh Button */}
      <div className="flex-shrink-0 p-3 border-t border-gray-200">
        <button
          onClick={loadSessions}
          disabled={loading}
          className="w-full py-2 px-3 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
          aria-label="Refresh chat list"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

export default ConversationsList;