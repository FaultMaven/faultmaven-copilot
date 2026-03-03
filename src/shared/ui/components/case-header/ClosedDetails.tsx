/**
 * ClosedDetails Component
 *
 * Expanded header content for CLOSED disposition cases.
 * Displays closure-reason-specific layout with banner, context, and summary.
 *
 * Aligned with: investigation-lifecycle-logic.md closure reasons
 */

import React from 'react';
import type { CaseUIResponse_Resolved } from '../../../../types/case';
import { CLOSURE_DISPLAY_INFO } from '../../../../lib/api/services/case-service';

interface ClosedDetailsProps {
  data: CaseUIResponse_Resolved;
  caseId: string;
  closureReason: string | null;
}

export const ClosedDetails: React.FC<ClosedDetailsProps> = ({
  data,
  closureReason,
}) => {
  const reasonInfo = closureReason ? CLOSURE_DISPLAY_INFO[closureReason] : null;

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="px-4 pb-4 space-y-3 text-sm">
      {/* Closure Banner */}
      {reasonInfo ? (
        <div className={`rounded-md px-3 py-2 ${reasonInfo.bannerClass}`}>
          <div className="font-medium">🔒 Closed — {reasonInfo.label}</div>
          <div className="text-xs mt-0.5 opacity-80">{reasonInfo.description}</div>
        </div>
      ) : (
        <div className="rounded-md px-3 py-2 bg-fm-surface border border-fm-border text-fm-text-tertiary">
          <div className="font-medium">🔒 Closed</div>
        </div>
      )}

      {/* Problem Statement */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">Problem:</h4>
        <p className="text-white">{data.title}</p>
      </div>

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Reason-specific content */}
      {closureReason === 'mitigation_sufficient' && data.solution_applied?.description && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">⚡ Mitigation Applied:</h4>
          <p className="text-white">{data.solution_applied.description}</p>
        </div>
      )}

      {closureReason === 'abandoned' && data.root_cause?.description && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">💡 Last Working Theory:</h4>
          <p className="text-white">{data.root_cause.description}</p>
        </div>
      )}

      {closureReason === 'escalated' && (
        <div>
          <p className="text-fm-text-primary italic">Case escalated to another team or external support.</p>
        </div>
      )}

      {closureReason === 'inquiry_only' && (
        <div>
          <p className="text-fm-text-primary italic">Q&A session completed, no investigation was needed.</p>
        </div>
      )}

      {/* Investigation Summary (if investigation happened) */}
      {data.resolution_summary && (
        <>
          <div className="border-t border-fm-border"></div>
          <div>
            <h4 className="font-medium text-fm-text-primary mb-1">Investigation Summary:</h4>
            <ul className="space-y-1 pl-4 text-white">
              {data.resolution_summary.total_duration_minutes > 0 && (
                <li>• Duration: {formatDuration(data.resolution_summary.total_duration_minutes)}</li>
              )}
              {data.resolution_summary.milestones_completed > 0 && (
                <li>• Milestones: {data.resolution_summary.milestones_completed}</li>
              )}
              {data.resolution_summary.evidence_collected > 0 && (
                <li>• Evidence collected: {data.resolution_summary.evidence_collected}</li>
              )}
              {data.resolution_summary.hypotheses_tested > 0 && (
                <li>• Hypotheses tested: {data.resolution_summary.hypotheses_tested}</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};
