import React, { useState, useEffect } from 'react';
import { Session, listSessions, deleteSession, createSession } from '../../../lib/api';
import { ConversationItem } from './ConversationItem';
import LoadingSpinner from './LoadingSpinner';

interface ConversationsListProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: (sessionId: string) => void;
  conversationTitles?: Record<string, string>;
  hasUnsavedNewChat?: boolean;
  refreshTrigger?: number;
  className?: string;
  collapsed?: boolean;
}

export function ConversationsList({ 
  activeSessionId, 
  onSessionSelect, 
  onNewSession,
  conversationTitles = {},
  hasUnsavedNewChat = false,
  refreshTrigger = 0,
  className = '',
  collapsed = false
}: ConversationsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});

  // Load cases on component mount
  useEffect(() => {
    loadCases();
  }, []);

  // Reload cases when refreshTrigger changes (e.g., when new session is created)
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadCases();
    }
  }, [refreshTrigger]);

  const loadCases = async () => {
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
      console.error('[ConversationsList] Failed to load cases:', err);
      // Store the full error message for debugging
      const fullError = err instanceof Error ? err.message : String(err);
      console.log('[ConversationsList] Full error details:', fullError);
      setError(`Failed to list cases: ${fullError}`);
      setSessions([]); // Reset to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = async () => {
    // Rule (5): Prevent multiple new chats - if there's already an unsaved new chat, don't create another
    if (hasUnsavedNewChat) {
      console.log('[ConversationsList] Cannot create new chat - unsaved new chat already exists');
      return;
    }
    
    // Prepare for new chat input - clear any active session and show blank chat window
    // Session will be created when user submits first query/data
    console.log('[ConversationsList] Preparing for new chat (showing blank chat window)');
    
    // Clear any active session to show blank chat window ready for new input
    onNewSession('');
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this case? This will permanently remove the conversation history.')) {
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
          // No sessions remain - prepare for new chat
          // Use onNewSession instead of onSessionSelect to properly set hasUnsavedNewChat flag
          onNewSession(''); // Clear active session and prepare for new chat
        }
      }
      
    } catch (err) {
      console.error('[ConversationsList] Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete case');
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

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    // Update the local title cache
    updateSessionTitle(sessionId, newTitle);
    console.log('[ConversationsList] Renamed case:', sessionId, 'to:', newTitle);
    // Note: We could also call a backend API here to persist the rename if needed
  };

  // Group sessions by time periods
  const groupSessionsByTime = (sessions: Session[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const groups = {
      today: [] as Session[],
      sevenDays: [] as Session[],
      thirtyDays: [] as Session[],
      older: [] as Session[]
    };

    sessions.filter(session => session && session.session_id).forEach(session => {
      const sessionDate = new Date(session.last_activity || session.created_at || 0);
      
      if (sessionDate >= today) {
        groups.today.push(session);
      } else if (sessionDate >= sevenDaysAgo) {
        groups.sevenDays.push(session);
      } else if (sessionDate >= thirtyDaysAgo) {
        groups.thirtyDays.push(session);
      } else {
        groups.older.push(session);
      }
    });

    return groups;
  };

  const renderSessionGroup = (title: string, sessions: Session[]) => {
    if (sessions.length === 0) return null;

    return (
      <div key={title} className="space-y-1">
        <h3 className="text-xs font-medium text-gray-500 px-3 py-2 uppercase tracking-wider">
          {title}
        </h3>
        <div className="space-y-1">
          {sessions.map((session) => (
            <ConversationItem
              key={session.session_id}
              session={session}
              title={getSessionTitle(session)}
              isActive={session.session_id === activeSessionId}
              isUnsavedNew={hasUnsavedNewChat && session.session_id === activeSessionId}
              onSelect={onSessionSelect}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
            />
          ))}
        </div>
      </div>
    );
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

  const sessionGroups = groupSessionsByTime(sessions);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Error Display - hide when server is unreachable */}
      {error && !error.includes('Failed to fetch') && (
        <div className="flex-shrink-0 p-3 mx-3 mt-2 bg-red-50 border border-red-200 rounded-lg">
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
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && !error?.includes('Failed to fetch') ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-gray-500 mb-3">No conversations yet</p>
            <p className="text-xs text-gray-400">
              Click "New chat" to start your first conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {renderSessionGroup('Today', sessionGroups.today)}
            {renderSessionGroup('7 Days', sessionGroups.sevenDays)}
            {renderSessionGroup('30 Days', sessionGroups.thirtyDays)}
            {renderSessionGroup('Older', sessionGroups.older)}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConversationsList;