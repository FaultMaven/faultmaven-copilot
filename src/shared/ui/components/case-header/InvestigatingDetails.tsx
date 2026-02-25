/**
 * InvestigatingDetails Component
 *
 * Expanded header content for INVESTIGATING phase
 * Shows: Problem, Progress, Strategy, Timeline, Impact, Working Conclusion with Evidence
 * Design based on: ui-mockups-text-diagrams.md lines 191-235
 */

import React from 'react';
import type { CaseUIResponse_Investigating } from '../../../../types/case';

interface InvestigatingDetailsProps {
  data: CaseUIResponse_Investigating;
  caseId: string;
}

export const InvestigatingDetails: React.FC<InvestigatingDetailsProps> = ({
  data,
}) => {
  // Calculate progress percentage
  const progressPercent = Math.round(
    (data.progress.milestones_completed / data.progress.total_milestones) * 100
  );

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

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
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

      {/* Progress Section */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-fm-text-primary">
            🎯 Investigation Progress: {data.progress.current_stage.replace(/_/g, ' ')} ({data.progress.milestones_completed}/{data.progress.total_milestones})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-fm-elevated rounded-full h-2">
            <div
              className="bg-fm-accent h-2 rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-fm-text-tertiary text-xs">{progressPercent}%</span>
        </div>
      </div>

      {/* Strategy */}
      {data.investigation_strategy?.approach && (
        <div>
          <span className="font-medium text-fm-text-primary">⚡ Strategy: </span>
          <span className="text-white">{data.investigation_strategy.approach}</span>
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Timeline Section */}
      {data.problem_verification?.temporal_state && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">⏱️ Timeline:</h4>
          <ul className="space-y-1 pl-4">
            {data.problem_verification.temporal_state.started_at && (
              <li className="text-white">
                • Started: {formatDate(data.problem_verification.temporal_state.started_at)} ({formatTimeAgo(data.problem_verification.temporal_state.started_at)})
              </li>
            )}
            {data.problem_verification.temporal_state.state && (
              <li className="text-white">
                • Status: {data.problem_verification.temporal_state.state}
                {data.problem_verification.temporal_state.last_occurrence_at && ' since discovery'}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Impact Section */}
      {data.problem_verification && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">📊 Impact:</h4>
          <ul className="space-y-1 pl-4">
            {data.problem_verification.severity && (
              <li className="text-white">
                • Severity: {data.problem_verification.severity.toUpperCase()}
                {data.problem_verification.user_impact && ` - ${data.problem_verification.user_impact}`}
              </li>
            )}
            {data.problem_verification.impact?.affected_services && data.problem_verification.impact.affected_services.length > 0 && (
              <li className="text-white">
                • Affected: {data.problem_verification.impact.affected_services.join(', ')}
              </li>
            )}
            {data.problem_verification.impact?.affected_users && (
              <li className="text-white">
                • Users: {data.problem_verification.impact.affected_users}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Current Understanding / Working Conclusion */}
      {data.working_conclusion && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">
            💡 Current Understanding ({Math.round(data.working_conclusion.confidence * 100)}% confidence):
          </h4>

          {/* Root Cause */}
          <div className="mb-2">
            <p className="font-medium text-white mb-1">
              Root Cause: {data.working_conclusion.summary}
            </p>
          </div>

          {/* Evidence List */}
          {data.latest_evidence && data.latest_evidence.length > 0 && (
            <div>
              <p className="text-fm-text-primary mb-1">Evidence:</p>
              <ul className="space-y-1 pl-4">
                {data.latest_evidence.slice(0, 3).map((ev) => (
                  <li key={ev.evidence_id} className="text-white">
                    • {ev.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Last Updated */}
          {data.working_conclusion.last_updated && (
            <div className="mt-2 text-xs text-fm-text-tertiary">
              Last updated: {formatTimeAgo(data.working_conclusion.last_updated)}
            </div>
          )}
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Footer Summary: files · hypotheses · solutions */}
      <div className="text-center text-fm-text-primary">
        📎 {data.latest_evidence?.length || 0} files
        {data.active_hypotheses && data.active_hypotheses.length > 0 && (
          <> · 🔬 {data.active_hypotheses.length} hypotheses</>
        )}
        {/* Note: Solution count not available in schema, would need to add if backend provides */}
      </div>
    </div>
  );
};
