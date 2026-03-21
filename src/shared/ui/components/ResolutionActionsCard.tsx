import React, { useState, useCallback, useEffect } from 'react';
import { CheckCircleIcon, LockClosedIcon, formatDuration } from './case-header/shared';
import { createLogger } from '../../../lib/utils/logger';
import type { UserCase } from '../../../types/case';
import type { CaseUIResponse } from '../../../types/case';

const log = createLogger('ResolutionActionsCard');

interface ResolutionActionsCardProps {
  activeCase: UserCase;
  caseData: CaseUIResponse | null;
  onGenerateReport: (reportType: 'incident_report' | 'post_mortem') => Promise<void>;
  dashboardUrl: string;
}

type ButtonState = 'idle' | 'generating' | 'done' | 'view';

const CLOSURE_REASON_LABELS: Record<string, string> = {
  abandoned: 'Abandoned',
  escalated: 'Escalated',
  mitigation_sufficient: 'Mitigated',
  inquiry_only: 'Inquiry Only',
  other: 'Closed',
};

const DocumentIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

interface ReportButtonProps {
  label: string;
  reportType: 'incident_report' | 'post_mortem';
  caseId: string;
  dashboardUrl: string;
  onGenerate: (reportType: 'incident_report' | 'post_mortem') => Promise<void>;
}

const ReportButton: React.FC<ReportButtonProps> = ({
  label,
  reportType,
  caseId,
  dashboardUrl,
  onGenerate,
}) => {
  const [state, setState] = useState<ButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (state === 'generating') return;

    if (state === 'view') {
      window.open(`${dashboardUrl}/cases/${caseId}?tab=report`, '_blank');
      return;
    }

    setState('generating');
    setError(null);

    try {
      await onGenerate(reportType);
      setState('done');
    } catch (err) {
      log.error('Report generation failed', { reportType, error: err });
      setError(err instanceof Error ? err.message : 'Generation failed');
      setState('idle');
    }
  }, [state, dashboardUrl, caseId, onGenerate, reportType]);

  // Transition from done -> view after 2 seconds
  useEffect(() => {
    if (state !== 'done') return;
    const timer = setTimeout(() => setState('view'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'view') {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 text-fm-xs font-medium text-fm-accent hover:underline transition-colors cursor-pointer"
      >
        View in Dashboard
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col">
      <button
        onClick={handleClick}
        disabled={state === 'generating'}
        className={`inline-flex items-center gap-1.5 bg-fm-surface border border-fm-border rounded-fm-btn px-3 py-1.5 text-fm-xs font-medium transition-colors ${
          state === 'generating'
            ? 'opacity-60 cursor-not-allowed animate-pulse text-fm-text-primary'
            : state === 'done'
              ? 'text-fm-success border-fm-success/30'
              : 'text-fm-text-primary hover:bg-fm-elevated cursor-pointer'
        }`}
      >
        {state === 'done' ? (
          <>
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Generated
          </>
        ) : (
          <>
            <DocumentIcon />
            {state === 'generating' ? 'Generating...' : label}
          </>
        )}
      </button>
      {error && (
        <span className="text-fm-xs text-fm-critical mt-1">{error}</span>
      )}
    </div>
  );
};

const ResolutionActionsCardComponent: React.FC<ResolutionActionsCardProps> = ({
  activeCase,
  caseData,
  onGenerateReport,
  dashboardUrl,
}) => {
  const isResolved = activeCase.status === 'resolved';
  const isClosed = activeCase.status === 'closed';

  if (!isResolved && !isClosed) return null;

  // Extract data from caseData when available
  const resolvedData = caseData && caseData.status === 'resolved' ? caseData : null;
  const rootCauseDescription = resolvedData?.root_cause?.description ?? null;
  const totalDurationMinutes = resolvedData?.resolution_summary?.total_duration_minutes ?? null;
  const milestonesCompleted = resolvedData?.resolution_summary?.milestones_completed ?? null;
  const hypothesesTested = resolvedData?.resolution_summary?.hypotheses_tested ?? null;
  const evidenceCollected = resolvedData?.resolution_summary?.evidence_collected ?? null;
  const currentTurn = resolvedData?.current_turn ?? (caseData as any)?.current_turn ?? null;

  // Duration from activeCase timestamps as fallback
  const fallbackDurationMinutes = (() => {
    if (totalDurationMinutes !== null) return null;
    const start = activeCase.created_at;
    const end = activeCase.resolved_at || activeCase.closed_at;
    if (!start || !end) return null;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(1, Math.round(diff / 60000));
  })();

  const durationMinutes = totalDurationMinutes ?? fallbackDurationMinutes;

  const closureReason = activeCase.closure_reason;
  const closureLabel = closureReason
    ? CLOSURE_REASON_LABELS[closureReason] ?? closureReason
    : null;

  const showKnowledgeNudge =
    isResolved || (isClosed && closureReason === 'mitigation_sufficient');

  if (isResolved) {
    // Build summary line parts
    const summaryParts: string[] = [];
    if (durationMinutes !== null) summaryParts.push(formatDuration(durationMinutes));
    if (currentTurn !== null) summaryParts.push(`${currentTurn} turns`);
    if (evidenceCollected !== null) summaryParts.push(`${evidenceCollected} evidence items`);

    return (
      <div className="bg-fm-success/5 border border-fm-success/20 rounded-fm-card p-4 mx-4 mb-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <CheckCircleIcon className="w-4.5 h-4.5 text-fm-success" />
          <span className="text-fm-body font-semibold text-fm-text-primary">Case Resolved</span>
        </div>

        {/* Root cause */}
        {rootCauseDescription && (
          <p className="text-fm-text-tertiary text-fm-xs mb-1 line-clamp-2">
            <span className="font-medium text-fm-text-secondary">Root cause:</span>{' '}
            {rootCauseDescription}
          </p>
        )}

        {/* Summary stats */}
        {summaryParts.length > 0 && (
          <p className="text-fm-text-tertiary text-fm-xs mb-3">
            Duration: {summaryParts.join(' \u00B7 ')}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <ReportButton
            label="Incident Report"
            reportType="incident_report"
            caseId={activeCase.case_id}
            dashboardUrl={dashboardUrl}
            onGenerate={onGenerateReport}
          />
          <ReportButton
            label="Post-Mortem"
            reportType="post_mortem"
            caseId={activeCase.case_id}
            dashboardUrl={dashboardUrl}
            onGenerate={onGenerateReport}
          />
        </div>

        {/* Knowledge nudge */}
        {showKnowledgeNudge && (
          <p className="text-fm-text-tertiary text-fm-xs mt-3">
            This resolution could benefit future cases.{' '}
            Extract as knowledge article{' '}
            <a
              href={`${dashboardUrl}/cases/${activeCase.case_id}?tab=knowledge`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-accent hover:underline cursor-pointer"
            >
              Dashboard
            </a>
          </p>
        )}
      </div>
    );
  }

  // CLOSED case
  const closedSummaryParts: string[] = [];
  if (hypothesesTested !== null) {
    closedSummaryParts.push(`${hypothesesTested} hypotheses explored`);
  }

  const closedDurationParts: string[] = [];
  if (durationMinutes !== null) closedDurationParts.push(formatDuration(durationMinutes));
  if (currentTurn !== null) closedDurationParts.push(`${currentTurn} turns`);

  return (
    <div className="bg-fm-surface border border-fm-border rounded-fm-card p-4 mx-4 mb-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <LockClosedIcon className="w-4.5 h-4.5 text-fm-text-tertiary" />
        <span className="text-fm-body font-semibold text-fm-text-primary">
          Case Closed{closureLabel ? ` \u00B7 ${closureLabel}` : ''}
        </span>
      </div>

      {/* Summary */}
      <p className="text-fm-text-tertiary text-fm-xs mb-1">
        Findings archived.{closedSummaryParts.length > 0 ? ` ${closedSummaryParts.join('. ')}.` : ''}
      </p>

      {closedDurationParts.length > 0 && (
        <p className="text-fm-text-tertiary text-fm-xs mb-3">
          Duration: {closedDurationParts.join(' \u00B7 ')}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <ReportButton
          label="Investigation Notes"
          reportType="incident_report"
          caseId={activeCase.case_id}
          dashboardUrl={dashboardUrl}
          onGenerate={onGenerateReport}
        />
      </div>

      {/* Knowledge nudge for mitigation_sufficient */}
      {showKnowledgeNudge && (
        <p className="text-fm-text-tertiary text-fm-xs mt-3">
          This resolution could benefit future cases.{' '}
          Extract as knowledge article{' '}
          <a
            href={`${dashboardUrl}/cases/${activeCase.case_id}?tab=knowledge`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fm-accent hover:underline cursor-pointer"
          >
            Dashboard
          </a>
        </p>
      )}
    </div>
  );
};

export const ResolutionActionsCard = React.memo(ResolutionActionsCardComponent);
export default ResolutionActionsCard;
