/**
 * CaseDetails Component — unified expanded view across all case phases.
 *
 * Replaces the prior 4-way split (InquiryDetails / InvestigatingDetails /
 * ResolvedDetails / ClosedDetails). Renders the same row set conditionally;
 * rows are hidden when their data is empty or detectably-placeholder.
 *
 * Row order (consistent across every phase):
 *   1. Problem            — proposed (inquiry) or confirmed (post-inquiry)
 *   2. Progress           — milestone map (Option C: dots + inline labels) — investigating only
 *   3. Working Theory /   — phase-adaptive label
 *      Root Cause
 *   4. Solution           — resolved only
 *   5. Closure            — closed only, hidden when fallback "other"
 *   6. Needs              — conditional (when progress_transparency.active)
 *   7. Artifacts strip    — "N evidence · M hypotheses · K files · D duration"
 *   8. Files              — drill-down, lazy-fetched
 *   9. Reports            — drill-down, terminal cases only
 *
 * The "Progress" row uses Option C: dots + inline labels in one row (wraps
 * when needed). The 6 indicators complete opportunistically per the investigation
 * engine, so the layout is informational, not sequential.
 */

import React, { useState, useEffect } from 'react';
import type {
  CaseUIResponse,
  UploadedFileMetadata,
  UploadedFileDetailsResponse,
  UserCase,
} from '../../../../types/case';
import {
  isCaseInquiry,
  isCaseInvestigating,
  isCaseResolved,
  isCaseClosed,
} from '../../../../types/case';
import { CLOSURE_DISPLAY_INFO } from '../../../../lib/api/services/case-service';
import { filesApi } from '../../../../lib/api/files-service';
import { EvidenceDetailsModal } from './EvidenceDetailsModal';
import {
  DetailRow,
  FilledCircleIcon,
  EmptyCircleIcon,
  CheckCircleIcon,
  formatDuration,
  formatFileSize,
} from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('CaseDetails');

// ==================== Constants ====================

/** The 6 opportunistic progress indicators (no fixed order — completed when data is available). */
const PROGRESS_MILESTONES: { key: string; label: string }[] = [
  { key: 'symptom_verified', label: 'Symptoms' },
  { key: 'scope_assessed', label: 'Scope' },
  { key: 'timeline_established', label: 'Timeline' },
  { key: 'changes_identified', label: 'Changes' },
  { key: 'root_cause_identified', label: 'Root Cause' },
  { key: 'solution_proposed', label: 'Solution' },
];

/**
 * Strings the backend sometimes leaks into description fields when the LLM
 * defaults to the milestone label instead of writing actual prose. Treated as
 * "no real value" and the row is hidden.
 */
const PLACEHOLDER_VALUES = new Set([
  'root cause identified',
  'root cause',
  'solution proposed',
  'solution',
  'symptoms verified',
  'symptom verified',
  'scope assessed',
  'scope',
  'timeline established',
  'timeline',
  'changes identified',
  'changes',
]);

// ==================== Helpers ====================

/** Returns true when the string is empty, whitespace-only, or a known milestone-label placeholder. */
function isPlaceholderValue(text: string | null | undefined): boolean {
  if (!text) return true;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return PLACEHOLDER_VALUES.has(normalized);
}

/** Infer the agent's high-level approach (mitigation-first vs root-cause-first) from strategy text. */
function getApproachHint(approach: string | null | undefined): string | null {
  const text = approach?.toLowerCase() ?? '';
  if (/mitigat|quick fix|workaround|speed|urgent/.test(text)) return 'mitigation first';
  if (/root cause|analysis|diagnos|systematic/.test(text)) return 'root cause analysis';
  return null;
}

interface UploadedFileWithEvidence extends UploadedFileMetadata {
  evidence_count?: number;
}

// ==================== Sub-components ====================

interface MilestoneMapProps {
  completedIndicators: Set<string>;
  pendingMilestone: string | null;
}

/**
 * Option C milestone visualization — icons + inline labels in one line.
 *
 * No connecting line, no implied progression. Each milestone is rendered as
 * its own pill (icon + label), all visible at once. Wraps onto a second line
 * if the row is too narrow; existing icons (FilledCircleIcon, EmptyCircleIcon)
 * are reused.
 */
const MilestoneMap: React.FC<MilestoneMapProps> = ({ completedIndicators, pendingMilestone }) => (
  <div className="flex items-start gap-2 py-1 text-fm-sm">
    <span className="text-fm-text-tertiary w-[76px] flex-shrink-0 text-fm-sm font-medium">
      Progress
    </span>
    <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {PROGRESS_MILESTONES.map((m) => {
        const done = completedIndicators.has(m.key);
        const isPending = pendingMilestone === m.key;
        const colorClass = done
          ? 'text-fm-success'
          : isPending
            ? 'text-fm-warning'
            : 'text-fm-text-tertiary';
        return (
          <span
            key={m.key}
            className={`inline-flex items-center gap-1 text-fm-xs ${colorClass}`}
            title={done ? `${m.label} ✓` : isPending ? `${m.label} — needs attention` : m.label}
          >
            {done ? (
              <FilledCircleIcon className="w-2 h-2" />
            ) : (
              <EmptyCircleIcon className={`w-2 h-2 ${isPending ? 'animate-pulse' : ''}`} />
            )}
            <span>{m.label}</span>
          </span>
        );
      })}
    </span>
  </div>
);

// ==================== Main Component ====================

interface CaseDetailsProps {
  caseData: CaseUIResponse;
  activeCase: UserCase | null;
  expandedSection: string | null;
  onToggleSection: (section: string) => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const CaseDetails: React.FC<CaseDetailsProps> = ({
  caseData,
  activeCase,
  expandedSection,
  onToggleSection,
  onScrollToTurn,
}) => {
  // ----- Files drill-down state (lazy-fetched) -----
  const [files, setFiles] = useState<UploadedFileWithEvidence[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesFetched, setFilesFetched] = useState(false);
  const [selectedFileForEvidence, setSelectedFileForEvidence] = useState<string | null>(null);
  const [evidenceDetails, setEvidenceDetails] = useState<UploadedFileDetailsResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const filesExpanded = expandedSection === 'files';
  const reportsExpanded = expandedSection === 'reports';

  const caseId = caseData.case_id;

  useEffect(() => {
    if (!filesExpanded || filesFetched) return;
    const fetchFiles = async () => {
      setFilesLoading(true);
      try {
        const fetched = await filesApi.getUploadedFiles(caseId);
        setFiles(fetched);
      } catch (error) {
        log.error('Failed to fetch files', error);
      } finally {
        setFilesLoading(false);
        setFilesFetched(true);
      }
    };
    fetchFiles();
  }, [filesExpanded, caseId, filesFetched]);

  const handleShowEvidence = async (fileId: string) => {
    setSelectedFileForEvidence(fileId);
    setEvidenceLoading(true);
    try {
      const details = await filesApi.getUploadedFileDetails(caseId, fileId);
      setEvidenceDetails(details);
    } catch (error) {
      log.error('Failed to fetch evidence details', error);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handleCloseEvidence = () => {
    setSelectedFileForEvidence(null);
    setEvidenceDetails(null);
  };

  // ----- Row builders (each returns a React node or null) -----

  // 1. Problem
  let problemRow: React.ReactNode = null;
  if (isCaseInquiry(caseData)) {
    const proposed = caseData.inquiry?.proposed_problem_statement?.trim();
    if (proposed) {
      problemRow = (
        <DetailRow label="Problem">
          <span className="italic">&ldquo;{proposed}&rdquo;</span>
        </DetailRow>
      );
    }
  } else {
    const confirmed = activeCase?.description?.trim();
    if (confirmed) {
      problemRow = <DetailRow label="Problem">{confirmed}</DetailRow>;
    }
  }

  // 2. Progress (milestone map) — INVESTIGATING only.
  // Resolved/Closed responses don't expose `completed_indicators`; backend
  // gap noted, artifacts strip below covers retrospective depth instead.
  let progressRow: React.ReactNode = null;
  let needsRow: React.ReactNode = null;
  if (isCaseInvestigating(caseData)) {
    const completedIndicators = new Set(caseData.progress.completed_indicators ?? []);
    const pendingMilestone = caseData.progress_transparency?.active
      ? caseData.progress_transparency.pending_milestone ?? null
      : null;
    progressRow = (
      <MilestoneMap
        completedIndicators={completedIndicators}
        pendingMilestone={pendingMilestone}
      />
    );

    // 6. Needs — paired with Progress when transparency is active
    if (caseData.progress_transparency?.active && caseData.progress_transparency.milestone_description) {
      needsRow = (
        <DetailRow label="Needs">
          <span className="text-fm-warning text-[11px]">
            {caseData.progress_transparency.milestone_description}
          </span>
        </DetailRow>
      );
    }
  }

  // 3. Working Theory / Root Cause
  let understandingRow: React.ReactNode = null;
  if (isCaseInvestigating(caseData)) {
    const wc = caseData.working_conclusion;
    if (wc?.summary && !isPlaceholderValue(wc.summary)) {
      const approach = getApproachHint(caseData.investigation_strategy?.approach);
      const label = approach ? `Working Theory (${approach})` : 'Working Theory';
      const confidence = Math.round((wc.confidence ?? 0) * 100);
      understandingRow = (
        <DetailRow label={label}>
          <span>
            {wc.summary} · {confidence}%
          </span>
        </DetailRow>
      );
    }
  } else if (isCaseResolved(caseData) || isCaseClosed(caseData)) {
    const rcText = caseData.root_cause?.description?.trim();
    if (rcText && !isPlaceholderValue(rcText)) {
      understandingRow = (
        <DetailRow label="Root Cause">
          <span className="inline-flex items-center gap-1">
            <span className="truncate">{rcText}</span>
            {isCaseResolved(caseData) && (
              <CheckCircleIcon className="w-3.5 h-3.5 text-fm-success flex-shrink-0" />
            )}
          </span>
        </DetailRow>
      );
    } else if (rcText && isPlaceholderValue(rcText)) {
      log.warn('Suppressed placeholder Root Cause value', { caseId, value: rcText });
    }
  }

  // 4. Solution — RESOLVED only
  let solutionRow: React.ReactNode = null;
  if (isCaseResolved(caseData)) {
    const solText = caseData.solution_applied?.description?.trim();
    if (solText && !isPlaceholderValue(solText)) {
      solutionRow = <DetailRow label="Solution">{solText}</DetailRow>;
    }
  }

  // 5. Closure — CLOSED only, hidden when reason is missing/unrecognized/fallback "other"
  let closureRow: React.ReactNode = null;
  if (isCaseClosed(caseData)) {
    const reason = activeCase?.closure_reason;
    if (reason && reason !== 'other' && CLOSURE_DISPLAY_INFO[reason]) {
      const info = CLOSURE_DISPLAY_INFO[reason];
      closureRow = (
        <DetailRow label="Closure">
          {info.label} — {info.description}
        </DetailRow>
      );
    } else if (reason === 'other' || (reason && !CLOSURE_DISPLAY_INFO[reason])) {
      log.debug('Suppressed fallback/unrecognized closure_reason', { caseId, reason });
    }
  }

  // File count is on every CaseUIResponse variant — derived once, used by
  // both the artifacts strip (row 7) and the Files drill-down (row 8).
  const headerFileCount = caseData.uploaded_files_count ?? 0;

  // 7. Artifacts strip — counts + duration, phase-aware sources for
  // evidence/hypotheses/duration; file count comes from the shared derivation above.
  let artifactsRow: React.ReactNode = null;
  {
    let evidence = 0;
    let hypotheses = 0;
    let durationMin = 0;

    if (isCaseInvestigating(caseData)) {
      evidence = caseData.progress.total_evidence ?? 0;
      hypotheses = caseData.active_hypotheses?.length ?? 0;
      // duration omitted for active investigations — collapsed-row "time ago" already covers age
    } else if (isCaseResolved(caseData) || isCaseClosed(caseData)) {
      const rs = caseData.resolution_summary;
      evidence = rs?.evidence_collected ?? 0;
      hypotheses = rs?.hypotheses_tested ?? 0;
      durationMin = rs?.total_duration_minutes ?? 0;
    }
    // Inquiry contributes only the file count.

    const parts: string[] = [];
    if (evidence > 0) parts.push(`${evidence} evidence`);
    if (hypotheses > 0) parts.push(`${hypotheses} hypothes${hypotheses === 1 ? 'is' : 'es'}`);
    if (headerFileCount > 0) parts.push(`${headerFileCount} file${headerFileCount === 1 ? '' : 's'}`);
    if (durationMin > 0) parts.push(formatDuration(durationMin));

    if (parts.length > 0) {
      artifactsRow = (
        <DetailRow label="Artifacts">
          <span className="text-fm-text-secondary">{parts.join(' · ')}</span>
        </DetailRow>
      );
    }
  }

  // 8. Files — drill-down (visible if any files reported by header or already fetched).
  const showFilesRow = headerFileCount > 0 || files.length > 0;

  // 9. Reports — RESOLVED/CLOSED only, drill-down when reports_available
  const reportsAvailable =
    (isCaseResolved(caseData) || isCaseClosed(caseData))
      ? caseData.reports_available
      : undefined;
  const showReportsRow = reportsAvailable && reportsAvailable.length > 0;

  // Track which sub-rows we have so the wrapper renders an empty-state when none
  const anyRow =
    problemRow ||
    progressRow ||
    understandingRow ||
    solutionRow ||
    closureRow ||
    needsRow ||
    artifactsRow ||
    showFilesRow ||
    showReportsRow;

  if (!anyRow) {
    return (
      <div className="px-4 pb-2 pt-1.5 text-fm-sm text-fm-text-tertiary italic">
        {isCaseInquiry(caseData) ? 'Inquiry in progress…' : 'No details available yet.'}
      </div>
    );
  }

  const formatReportName = (reportType: string): string =>
    reportType
      .replace(/_/g, ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {problemRow}
      {progressRow}
      {needsRow}
      {understandingRow}
      {solutionRow}
      {closureRow}
      {artifactsRow}

      {/* Files drill-down */}
      {showFilesRow && (
        <>
          <DetailRow
            label="Files"
            expandable
            expanded={filesExpanded}
            onToggle={() => onToggleSection('files')}
          >
            {headerFileCount > 0 ? `${headerFileCount} uploaded` : 'View uploads'}
          </DetailRow>

          {filesExpanded && (
            <div className="pl-[84px] pb-0.5">
              {filesLoading && (
                <p className="text-fm-xs text-fm-text-tertiary italic py-0.5">Loading…</p>
              )}
              {!filesLoading && files.length > 0 && (
                <div className="space-y-0.5">
                  {files.map((file, idx) => (
                    <div
                      key={file.file_id}
                      className="flex items-center gap-1.5 text-fm-xs text-fm-text-primary"
                    >
                      <span className="text-fm-text-tertiary">{idx < files.length - 1 ? '├' : '└'}</span>
                      <span className="truncate">{file.filename}</span>
                      <span className="text-fm-text-tertiary flex-shrink-0">
                        ({formatFileSize(file.size_bytes)})
                      </span>
                      {file.evidence_count !== undefined && file.evidence_count > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShowEvidence(file.file_id);
                          }}
                          className="text-fm-success hover:text-fm-success/80 flex-shrink-0"
                        >
                          {file.evidence_count} evidence
                        </button>
                      )}
                      {onScrollToTurn && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onScrollToTurn(file.uploaded_at_turn);
                          }}
                          className="text-fm-accent hover:text-fm-accent/80 flex-shrink-0"
                          title="Jump to turn"
                        >
                          → T{file.uploaded_at_turn}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!filesLoading && filesFetched && files.length === 0 && (
                <p className="text-fm-xs text-fm-text-tertiary italic py-0.5">No files uploaded</p>
              )}
            </div>
          )}
        </>
      )}

      {/* Reports drill-down */}
      {showReportsRow && reportsAvailable && (
        <>
          <DetailRow
            label="Reports"
            expandable
            expanded={reportsExpanded}
            onToggle={() => onToggleSection('reports')}
          >
            {reportsAvailable.map((r) => formatReportName(r.report_type)).join(', ')}
          </DetailRow>

          {reportsExpanded && (
            <div className="pl-[84px] pb-0.5">
              <div className="space-y-1.5">
                {reportsAvailable.map((report, idx) => {
                  const isLast = idx === reportsAvailable.length - 1;
                  return (
                    <div
                      key={report.report_type}
                      className="flex items-start gap-2 text-fm-xs"
                    >
                      <span className="text-fm-text-tertiary">{isLast ? '└' : '├'}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-fm-text-primary font-medium">
                          {formatReportName(report.report_type)}
                        </span>
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

      <EvidenceDetailsModal
        isOpen={selectedFileForEvidence !== null}
        evidenceDetails={evidenceDetails}
        evidenceLoading={evidenceLoading}
        onClose={handleCloseEvidence}
        onScrollToTurn={onScrollToTurn}
      />
    </div>
  );
};
