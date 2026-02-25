/**
 * ResolvedDetails Component
 *
 * Expanded header content for RESOLVED phase
 * Shows: Problem, Investigation Summary, Root Cause, Solution, Documentation
 * Design based on: ui-mockups-text-diagrams.md lines 344-385
 */

import React from 'react';
import type { CaseUIResponse_Resolved } from '../../../../types/case';

interface ResolvedDetailsProps {
  data: CaseUIResponse_Resolved;
  caseId: string;
}

export const ResolvedDetails: React.FC<ResolvedDetailsProps> = ({
  data,
}) => {
  // Format date/time
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  // Format duration
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="px-4 pb-4 space-y-3 text-sm">
      {/* Problem Statement */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">Problem:</h4>
        <p className="text-white">{data.title}</p>
      </div>

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Investigation Completed Summary */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">Investigation Completed:</h4>
        <ul className="space-y-1 pl-4">
          <li className="text-white">
            • Duration: {formatDuration(data.resolution_summary.total_duration_minutes)} ({data.resolution_summary.milestones_completed} turns)
          </li>
          <li className="text-white">
            • Started: {formatDate(data.created_at)}
          </li>
          <li className="text-white">
            • Resolved: {formatDate(data.resolved_at)}
          </li>
        </ul>
      </div>

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Root Cause */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">
          ✓ Root Cause:
        </h4>
        <p className="text-white mb-1">{data.root_cause.description}</p>
        <div className="text-xs text-fm-text-tertiary space-x-3">
          <span>Category: {data.root_cause.category}</span>
          <span>Severity: {data.root_cause.severity}</span>
        </div>
      </div>

      {/* Solution Applied */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">✓ Solution Applied:</h4>
        <p className="text-white mb-1">{data.solution_applied.description}</p>
        <div className="text-xs text-fm-text-tertiary">
          Status: {data.verification_status.verified ? 'Successful' : 'Pending verification'}
          {data.solution_applied.applied_at && ` (${formatDate(data.solution_applied.applied_at)})`}
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Documentation Available */}
      {data.reports_available && data.reports_available.length > 0 && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-2">
            📄 Documentation Available ({data.reports_available.length} documents):
          </h4>

          <div className="space-y-3">
            {data.reports_available.map((report) => {
              // Format report names
              const reportName = report.report_type
                .replace(/_/g, ' ')
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

              // Get icon based on type
              const getIcon = () => {
                if (report.report_type.includes('post')) return '📋';
                if (report.report_type.includes('runbook')) return '📖';
                if (report.report_type.includes('timeline')) return '📅';
                return '📄';
              };

              return (
                <div key={report.report_type} className="pl-4">
                  <div className="flex items-start gap-2">
                    <span>{getIcon()}</span>
                    <div className="flex-1">
                      <p className="font-medium text-white">{reportName}</p>
                      <p className="text-xs text-fm-text-tertiary">
                        Generated: {formatDate(data.resolved_at)}
                      </p>
                      <button className="text-xs text-fm-accent hover:text-blue-700 mt-1">
                        [View Document]
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3">
            <button className="text-xs text-fm-accent hover:text-blue-700">
              [Request Additional Documentation]
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
