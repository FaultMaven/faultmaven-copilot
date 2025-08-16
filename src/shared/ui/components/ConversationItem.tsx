import React, { useState, useEffect } from 'react';
import { Session } from '../../../lib/api';

interface ConversationItemProps {
  session: Session;
  title?: string;
  isActive: boolean;
  messageCount?: number;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function ConversationItem({ 
  session, 
  title, 
  isActive, 
  messageCount = 0,
  onSelect, 
  onDelete 
}: ConversationItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every minute to refresh relative timestamps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [session.session_id]);
  const handleSelect = () => {
    onSelect(session.session_id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(session.session_id);
    }
  };

  const formatTime = (dateString: string) => {
    try {
      // Backend now sends spec-compliant UTC timestamps
      const date = new Date(dateString);
      const now = new Date();
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
      className={`group relative p-3 border rounded-lg cursor-pointer transition-all duration-200 hover:shadow-sm ${
        isActive 
          ? 'bg-blue-50 border-blue-200 shadow-sm' 
          : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
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
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-medium truncate ${
            isActive ? 'text-blue-900' : 'text-gray-900'
          }`}>
            {displayTitle}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs ${statusColor}`}>
              ●
            </span>
            <span className="text-xs text-gray-500">
              {formatTime(lastActivity)}
            </span>
            {messageCount > 0 && (
              <span className="text-xs text-gray-400">
                • {messageCount} msg{messageCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        
        {onDelete && (
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-500 rounded"
            aria-label={`Delete conversation: ${displayTitle}`}
            title="Delete conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
      
      {isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-r-full" />
      )}
    </div>
  );
}