import React from 'react';
import {
  CheckCircleIcon,
  LockClosedIcon,
  AssuranceChip,
  hasAssuranceLabel,
  formatDuration,
} from './case-header/shared';
import type { UserCase } from '../../../types/case';
import type { CaseUIResponse } from '../../../types/case';
import { CLOSURE_DISPLAY_INFO } from '../../../lib/api/services/case-service';

interface ResolutionActionsCardProps {
  activeCase: UserCase;
  caseData: CaseUIResponse | null;
}

const ResolutionActionsCardComponent: React.FC<ResolutionActionsCardProps> = ({
  activeCase,
  caseData,
}) => {
  const isResolved = activeCase.state === 'resolved';
  const isClosed = activeCase.state === 'closed';

  if (!isResolved && !isClosed) return null;

  const resolvedData = caseData && caseData.state === 'resolved' ? caseData : null;
  const rootCauseDescription = resolvedData?.root_cause?.description ?? null;
  const causeAssurance = resolvedData?.root_cause?.cause_assurance ?? null;
  const causeOverclaim = resolvedData?.root_cause?.cause_overclaim ?? null;
  const totalDurationMinutes = resolvedData?.resolution_summary?.total_duration_minutes ?? null;
  const currentTurn = resolvedData?.current_turn ?? (caseData as any)?.current_turn ?? null;

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
    ? (CLOSURE_DISPLAY_INFO[closureReason] ?? CLOSURE_DISPLAY_INFO.other).shortLabel
    : null;

  // Build compact stats line
  const statsParts: string[] = [];
  if (durationMinutes !== null) statsParts.push(formatDuration(durationMinutes));
  if (currentTurn !== null) statsParts.push(`${currentTurn} turns`);

  if (isResolved) {
    return (
      <div className="flex items-start gap-2 bg-fm-success/5 border border-fm-success/20 rounded-fm-card px-3 py-2 mx-4 mb-2">
        <CheckCircleIcon className="w-4 h-4 text-fm-success mt-0.5 shrink-0" />
        <div className="min-w-0">
          <span className="text-fm-xs font-semibold text-fm-text-primary">Case Resolved</span>
          {rootCauseDescription && (
            <p className="text-fm-text-tertiary text-fm-xs line-clamp-1 mt-0.5">
              {rootCauseDescription}
            </p>
          )}
          {/* Read-time assurance label (#572/INV-28) beside the cause text.
              Gated on a labeled grade so a confirmed cause (no chip) leaves no
              empty spacer paragraph. */}
          {rootCauseDescription && hasAssuranceLabel(causeAssurance) && (
            <p className="mt-0.5">
              <AssuranceChip grade={causeAssurance} overclaim={causeOverclaim} />
            </p>
          )}
          {statsParts.length > 0 && (
            <p className="text-fm-text-tertiary text-fm-xs mt-0.5">
              {statsParts.join(' \u00B7 ')}
            </p>
          )}
          <p className="text-fm-text-tertiary text-fm-xs mt-0.5">
            Ask questions or request a runbook from this case.
          </p>
        </div>
      </div>
    );
  }

  // CLOSED case
  return (
    <div className="flex items-start gap-2 bg-fm-surface border border-fm-border rounded-fm-card px-3 py-2 mx-4 mb-2">
      <LockClosedIcon className="w-4 h-4 mt-0.5 shrink-0 text-fm-text-tertiary" />
      <div className="min-w-0">
        <span className="text-fm-xs font-semibold text-fm-text-primary">
          Case Closed{closureLabel ? ` \u00B7 ${closureLabel}` : ''}
        </span>
        {statsParts.length > 0 && (
          <p className="text-fm-text-tertiary text-fm-xs mt-0.5">
            {statsParts.join(' \u00B7 ')}
          </p>
        )}
        <p className="text-fm-text-tertiary text-fm-xs mt-0.5">
          Ask questions about this case.
        </p>
      </div>
    </div>
  );
};

export const ResolutionActionsCard = React.memo(ResolutionActionsCardComponent);
export default ResolutionActionsCard;
