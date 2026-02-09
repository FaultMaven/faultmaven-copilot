/**
 * HeaderSummary Component
 *
 * Collapsed header view showing case title, status, and expand/collapse button
 */

import React from 'react';
import type { CaseUIResponse } from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';

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

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    console.log('[HeaderSummary] handleStatusChange fired', {
      currentStatus: caseData.status,
      newStatus: e.target.value,
      hasCallback: !!onStatusChangeRequest
    });

    e.stopPropagation(); // Prevent header toggle
    const newStatus = e.target.value as UserCaseStatus;

    if (newStatus !== caseData.status && onStatusChangeRequest) {
      console.log('[HeaderSummary] Calling onStatusChangeRequest', { newStatus });
      onStatusChangeRequest(newStatus);
      // Reset select to current status (will update after confirmation)
      e.target.value = caseData.status;
    } else {
      console.log('[HeaderSummary] NOT calling callback', {
        sameStatus: newStatus === caseData.status,
        noCallback: !onStatusChangeRequest
      });
    }
  };

  return (
    <div className="p-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={onToggle}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Title and Turn */}
          <h2 className="font-semibold text-gray-900 text-base mb-1">
            <span className="text-lg">📋</span> {caseData.title}{getTurnInfo()}
          </h2>

          {/* Status Line */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {canChangeStatus ? (
              <select
                value={caseData.status}
                onChange={handleStatusChange}
                onClick={(e) => e.stopPropagation()}
                className="border-none bg-transparent cursor-pointer text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1"
              >
                <option value={caseData.status}>
                  {getStatusIcon(caseData.status)} {getStatusLabel(caseData.status)}
                </option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>
                    {getStatusIcon(status)} {getStatusLabel(status)}
                  </option>
                ))}
              </select>
            ) : (
              <span>
                {getStatusIcon(caseData.status)} {getStatusLabel(caseData.status)}
              </span>
            )}
            <span>·</span>
            <span>Updated {formatTimeAgo(caseData.updated_at)}</span>
          </div>
        </div>

        {/* Expand/Collapse Button */}
        <button
          className="ml-4 px-3 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? '[▲ Collapse]' : '[▼ Expand]'}
        </button>
      </div>
    </div>
  );
};
