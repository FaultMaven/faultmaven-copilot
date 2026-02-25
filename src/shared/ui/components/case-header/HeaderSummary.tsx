/**
 * HeaderSummary Component
 *
 * Collapsed header view showing case title, status, and expand/collapse button
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CaseUIResponse } from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('HeaderSummary');

interface HeaderSummaryProps {
  caseData: CaseUIResponse;
  expanded: boolean;
  onToggle: () => void;
  onStatusChangeRequest?: (newStatus: UserCaseStatus) => void;
}

export const HeaderSummary: React.FC<HeaderSummaryProps> = ({
  caseData,
  expanded,
  onToggle,
  onStatusChangeRequest,
}) => {
  const formatTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'inquiry':
        return '💬';
      case 'investigating':
        return '🔍';
      case 'resolved':
        return '✅';
      default:
        return '📋';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  // Get files count based on phase
  const getFilesCount = () => {
    if (caseData.status === 'inquiry') {
      return 'uploaded_files_count' in caseData ? caseData.uploaded_files_count : 0;
    } else if (caseData.status === 'investigating') {
      return caseData.latest_evidence?.length || 0;
    } else if (caseData.status === 'resolved') {
      return caseData.resolution_summary.evidence_collected;
    }
    return 0;
  };

  // Get turn/message count information
  // All phases now have current_turn from API (backend fixed)
  const getTurnInfo = () => {
    if ('current_turn' in caseData && caseData.current_turn > 0) {
      return ` · Turn ${caseData.current_turn}`;
    }
    return '';
  };

  const filesCount = getFilesCount();

  // Get available status transitions (forward only)
  // Use server-provided valid_next_states if available, otherwise fall back to client-side logic
  const getAvailableStatusTransitions = (currentStatus: string): UserCaseStatus[] => {
    // Use server-provided transitions if available
    if ('valid_next_states' in caseData && caseData.valid_next_states) {
      return caseData.valid_next_states as UserCaseStatus[];
    }

    // Fallback to client-side logic (for backward compatibility during rollout)
    if (currentStatus === 'resolved' || currentStatus === 'closed') {
      return []; // Terminal states - no transitions
    }
    if (currentStatus === 'inquiry') {
      return ['investigating' as UserCaseStatus, 'closed' as UserCaseStatus];
    }
    if (currentStatus === 'investigating') {
      return ['resolved' as UserCaseStatus, 'closed' as UserCaseStatus];
    }
    return [];
  };

  const statusOptions = getAvailableStatusTransitions(caseData.status);
  const canChangeStatus = statusOptions.length > 0 && onStatusChangeRequest;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleStatusSelect = (newStatus: UserCaseStatus) => {
    log.debug('handleStatusSelect fired', {
      currentStatus: caseData.status,
      newStatus,
      hasCallback: !!onStatusChangeRequest
    });

    setDropdownOpen(false);
    if (newStatus !== caseData.status && onStatusChangeRequest) {
      onStatusChangeRequest(newStatus);
    }
  };

  return (
    <div className="p-4 cursor-pointer hover:bg-fm-elevated/40 transition-colors" onClick={onToggle}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Title and Turn */}
          <h2 className="font-semibold text-white text-base mb-1">
            <span className="text-lg">📋</span> {caseData.title}{getTurnInfo()}
          </h2>

          {/* Status Line */}
          <div className="flex items-center gap-2 text-xs text-fm-text-tertiary mt-0.5">
            {canChangeStatus ? (
              <div className="relative inline-flex items-center" ref={dropdownRef}>
                {/* Trigger button styled as pill */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropdownOpen(!dropdownOpen);
                  }}
                  className="cursor-pointer font-medium border border-fm-accent-border bg-fm-accent-soft text-fm-accent rounded-full focus:outline-none focus:ring-1 focus:ring-fm-accent pl-2.5 pr-6 py-0.5"
                >
                  {getStatusIcon(caseData.status)} {getStatusLabel(caseData.status)}
                </button>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-fm-accent/60 text-[10px]">▾</span>

                {/* Custom dropdown menu */}
                {dropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 min-w-[140px] bg-fm-elevated border border-fm-border rounded-lg shadow-lg z-50 py-1">
                    {statusOptions.map(status => (
                      <button
                        key={status}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStatusSelect(status);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-fm-text-primary hover:bg-fm-accent-soft hover:text-fm-accent transition-colors"
                      >
                        {getStatusIcon(status)} {getStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="font-medium border border-fm-accent-border bg-fm-accent-soft text-fm-accent rounded-full px-2.5 py-0.5">
                {getStatusIcon(caseData.status)} {getStatusLabel(caseData.status)}
              </span>
            )}
            <span className="px-1 text-fm-text-tertiary">·</span>
            <span>Updated {formatTimeAgo(caseData.updated_at)}</span>
          </div>
        </div>

        {/* Expand/Collapse Toggle */}
        <button
          className="ml-3 p-1.5 text-fm-text-tertiary hover:text-fm-text-primary hover:bg-fm-elevated rounded-lg transition-colors flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={expanded ? 'Collapse details' : 'Expand details'}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
};
