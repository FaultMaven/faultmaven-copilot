/**
 * ClosedDetails Component
 *
 * Expanded header content for CLOSED disposition.
 * Compact rows: Reason, Problem, Root Cause (if exists), Duration (if exists).
 */

import React from 'react';
import type { CaseUIResponse_Resolved } from '../../../../types/case';
import { CLOSURE_DISPLAY_INFO } from '../../../../lib/api/services/case-service';
import { DetailRow, formatDuration } from './shared';

interface ClosedDetailsProps {
  data: CaseUIResponse_Resolved;
  caseId: string;
  closureReason: string | null;
  expandedSection: string | null;
  onToggleSection: (section: string) => void;
}

export const ClosedDetails: React.FC<ClosedDetailsProps> = ({
  data,
  closureReason,
}) => {
  const reasonInfo = closureReason ? CLOSURE_DISPLAY_INFO[closureReason] : null;

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {/* Reason */}
      <DetailRow label="Reason">
        {reasonInfo
          ? `${reasonInfo.label} — ${reasonInfo.description}`
          : 'Closed'
        }
      </DetailRow>

      {/* Problem */}
      <DetailRow label="Problem">
        {data.title}
      </DetailRow>

      {/* Root Cause — only if exists */}
      {data.root_cause?.description && (
        <DetailRow label="Root Cause">
          {data.root_cause.description}
        </DetailRow>
      )}

      {/* Duration — only if investigation happened */}
      {data.resolution_summary?.total_duration_minutes > 0 && (
        <DetailRow label="Duration">
          {formatDuration(data.resolution_summary.total_duration_minutes)} · {data.resolution_summary.milestones_completed} milestones
        </DetailRow>
      )}
    </div>
  );
};
