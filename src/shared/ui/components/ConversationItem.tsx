import React, { useState, useEffect } from 'react';
import { Session } from '../../../lib/api';

interface ConversationItemProps {
  session: Session;
  title?: string;
  isActive: boolean;
  messageCount?: number;
  isUnsavedNew?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onRename?: (sessionId: string, newTitle: string) => void;
}

export function ConversationItem({ 
  session, 
  title, 
  isActive, 
  messageCount = 0,
  isUnsavedNew = false,
  onSelect, 
  onDelete,
  onRename 
}: ConversationItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isRenaming, setIsRenaming] = useState(false);
  const [editTitle, setEditTitle] = useState(title || '');

  // Update current time every minute to refresh relative timestamps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []); // No dependencies - interval should run continuously

  // Sync editTitle with title prop
  useEffect(() => {
    setEditTitle(title || `Chat ${session.session_id.slice(-8)}`);
  }, [title, session.session_id]);
  const handleSelect = () => {
    onSelect(session.session_id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(session.session_id);
    }
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRenaming(true);
  };

  const handleSaveRename = () => {
    if (onRename && editTitle.trim() && editTitle.trim() !== title) {
      onRename(session.session_id, editTitle.trim());
    }
    setIsRenaming(false);
  };

  const handleCancelRename = () => {
    setEditTitle(title || `Chat ${session.session_id.slice(-8)}`);
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  };

  const formatTime = (dateString: string) => {
    try {
      // TEMPORARY FIX: Backend is not following OpenAPI spec for timestamp format
      // OpenAPI spec requires: "2025-01-15T10:00:00Z" (with Z suffix)
      // Backend returns: "2025-08-16T23:09:37.106812" (without Z suffix)
      // TODO: Fix backend to return proper ISO 8601 UTC format with Z suffix
      const isoString = dateString.includes('Z') ? dateString : dateString + 'Z';
      const date = new Date(isoString);
      const now = new Date(currentTime);
      const diffMs = now.getTime() - date.getTime();
      
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMs <= 0) return 'Just now';
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (error) {
      console.error('[ConversationItem] Error formatting time:', error, 'for dateString:', dateString);
      return 'Unknown';
    }
  };

  const displayTitle = title || `Chat ${session.session_id.slice(-8)}`;
  const lastActivity = session.last_activity || session.created_at;
  const statusColor = session.status === 'active' ? 'text-green-600' : 
                     session.status === 'idle' ? 'text-yellow-600' : 'text-gray-400';

  return (
    <div
      onClick={handleSelect}
      className={`group relative mx-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
        isActive 
          ? 'bg-gray-200 text-gray-900' 
          : 'text-gray-700 hover:bg-gray-100'
      }`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      }}
      aria-label={`Select conversation: ${displayTitle}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveRename}
              className="text-sm w-full min-w-0 bg-white border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              maxLength={50}
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative min-w-0 flex-1">
                <h3 className="text-sm font-normal truncate" title={displayTitle}>
                  {displayTitle}
                </h3>
                {displayTitle.length > 25 && (
                  <div className={`absolute top-0 right-0 w-4 h-full bg-gradient-to-l pointer-events-none ${
                    isActive 
                      ? 'from-gray-200 via-gray-200/80 to-transparent' 
                      : 'from-white via-white/80 to-transparent group-hover:from-gray-100 group-hover:via-gray-100/80'
                  }`}></div>
                )}
              </div>
              {isUnsavedNew && (
                <span className="text-xs text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                  New
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0">
          {onRename && (
            <button
              onClick={handleRename}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
              aria-label={`Rename conversation: ${displayTitle}`}
              title="Rename conversation"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1 text-gray-400 hover:text-red-500 rounded"
              aria-label={`Delete conversation: ${displayTitle}`}
              title="Delete conversation"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}