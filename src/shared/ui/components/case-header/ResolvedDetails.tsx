/**
 * ResolvedDetails Component
 *
 * Expanded header content for RESOLVED disposition.
 * Compact rows: Problem, Root Cause (confirmed), Solution, Duration, Reports (drill-down).
 */

import React from 'react';
import type { CaseUIResponse_Resolved } from '../../../../types/case';
import { DetailRow, CheckCircleIcon, formatDuration, formatTimeAgo } from './shared';

interface ResolvedDetailsProps {
  data: CaseUIResponse_Resolved;
  caseId: string;
  expandedSection: string | null;
  onToggleSection: (section: string) => void;
}

export const ResolvedDetails: React.FC<ResolvedDetailsProps> = ({
  data,
  expandedSection,
  onToggleSection,
}) => {
  const reportsExpanded = expandedSection === 'reports';

  const formatReportName = (reportType: string): string => {
    return reportType
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {/* Problem */}
      <DetailRow label="Problem">
        {data.title}
      </DetailRow>

      {/* Root Cause — confirmed */}
      <DetailRow label="Root Cause">
        <span className="inline-flex items-center gap-1">
          <span className="truncate">{data.root_cause.description}</span>
          <CheckCircleIcon className="w-3.5 h-3.5 text-fm-success flex-shrink-0" />
        </span>
      </DetailRow>

      {/* Solution */}
      <DetailRow label="Solution">
        {data.solution_applied.description}
      </DetailRow>

      {/* Duration */}
      <DetailRow label="Duration">
        {formatDuration(data.resolution_summary.total_duration_minutes)} · {data.resolution_summary.milestones_completed} milestones
      </DetailRow>

      {/* Reports — expandable */}
      {data.reports_available && data.reports_available.length > 0 && (
        <>
          <DetailRow
            label="Reports"
            expandable
            expanded={reportsExpanded}
            onToggle={() => onToggleSection('reports')}
          >
            {data.reports_available.map(r => formatReportName(r.report_type)).join(', ')}
          </DetailRow>

          {reportsExpanded && (
            <div className="pl-[84px] pb-0.5">
              <div className="space-y-1.5">
                {data.reports_available.map((report, idx) => {
                  const isLast = idx === data.reports_available!.length - 1;
                  return (
                    <div key={report.report_type} className="flex items-start gap-2 text-fm-xs">
                      <span className="text-fm-text-tertiary">{isLast ? '└' : '├'}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-fm-text-primary font-medium">{formatReportName(report.report_type)}</span>
                        <span className="text-fm-text-tertiary ml-2">{formatTimeAgo(data.resolved_at)}</span>
                        <button className="text-fm-accent hover:text-fm-accent/80 ml-2 text-fm-xs">
                          View
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
