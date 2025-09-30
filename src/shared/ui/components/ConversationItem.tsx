import React, { useState, useEffect, useRef } from 'react';
import { Session } from '../../../lib/api';

interface ConversationItemProps {
  session: Session;
  title?: string;
  isActive: boolean;
  isUnsavedNew?: boolean;
  isPinned?: boolean;
  isPending?: boolean; // For optimistic cases that are syncing
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onRename?: (sessionId: string, newTitle: string) => void;
  onGenerateTitle?: (sessionId: string) => void;
  onPin?: (sessionId: string, pinned: boolean) => void;
}

export function ConversationItem({
  session,
  title,
  isActive,
  isUnsavedNew = false,
  isPinned = false,
  isPending = false,
  onSelect,
  onDelete,
  onRename,
  onGenerateTitle,
  onPin
}: ConversationItemProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isRenaming, setIsRenaming] = useState(false);
  const [editTitle, setEditTitle] = useState(title || '');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Scroll active chat into view when it becomes active
  useEffect(() => {
    if (isActive && itemRef.current) {
      // Use a small delay to ensure DOM is ready and list is rendered
      const timeoutId = setTimeout(() => {
        itemRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest' // Only scroll if the item is not already visible
        });
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [isActive]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);
  const handleSelect = () => {
    onSelect(session.session_id);
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
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleMenuAction = (action: () => void) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsMenuOpen(false);
      action();
    };
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPin) {
      onPin(session.session_id, !isPinned);
    }
    setIsMenuOpen(false);
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
      ref={itemRef}
      onClick={handleSelect}
      className={`group relative mx-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 ${
        isActive
          ? isPending
            ? 'bg-blue-100 text-gray-900 border border-blue-300'
            : 'bg-gray-200 text-gray-900'
          : isPending
            ? 'text-gray-700 bg-blue-50 hover:bg-blue-100 border border-blue-200'
            : 'text-gray-700 hover:bg-gray-100'
      }`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isRenaming) { e.stopPropagation(); return; }
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
              {isPending && !isUnsavedNew && (
                <span className="text-xs text-blue-600 flex items-center gap-1 flex-shrink-0" title="Syncing to server...">
                  <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </span>
              )}
            </div>
          )}
        </div>
        
        {!isUnsavedNew && (
          <div className="relative ml-2 flex-shrink-0" ref={menuRef}>
            {isPinned && (
              <svg className="w-3 h-3 text-blue-600 mr-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
              </svg>
            )}
            <button
              onClick={handleMenuToggle}
              className="p-1 text-gray-400 hover:text-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Menu for ${displayTitle}`}
              title="Actions"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="12" cy="19" r="2"/>
              </svg>
            </button>

            {isMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              {onGenerateTitle && !isUnsavedNew && (
                <button
                  onClick={handleMenuAction(() => onGenerateTitle(session.session_id))}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l2.2 4.46L19 8l-3.6 3.2L16.4 16 12 14l-4.4 2 1-4.8L5 8l4.8-.54L12 3z" />
                  </svg>
                  Generate title
                </button>
              )}
              {onRename && (
                <button
                  onClick={handleMenuAction(() => setIsRenaming(true))}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Rename
                </button>
              )}
              {onPin && (
                <button
                  onClick={handlePin}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
                  </svg>
                  {isPinned ? 'Unpin' : 'Pin'}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={handleMenuAction(() => onDelete(session.session_id))}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}