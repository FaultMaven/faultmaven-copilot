/**
 * CaseDetails Component — unified expanded view across all case phases.
 *
 * Renders the same row set conditionally per the hardened slice-4 matrix:
 *
 *   Row              | inquiry | investigating | resolved        | closed
 *   ─────────────────┼─────────┼───────────────┼─────────────────┼────────────────────────────
 *   Problem          |    —    |       ✓       |       ✓         |       ✓
 *   Progress         |    —    |       ✓       |       —         |       —
 *   Leading Hyp.     |    —    |       ✓       |       —         |       —
 *   Root Cause       |    —    |       —       |       ✓         |       ✓ (if known)
 *   Solution         |    —    |       —       | only if no rpt  |       —
 *   Closure          |    —    |       —       |       —         | only if rpt skipped
 *   Artifacts        |    —    |       ✓       |       ✓         |       ✓
 *   Files            |    ✓    |       ✓       |       ✓         |       ✓
 *
 * Inquiry collapses to a single visible row (Files) — inquiry is conversational,
 * the chat is the surface. Gate 2 (path selection) and Gate 3 (post-mitigation)
 * are surfaced as inline COOPERATIVE suggestions in chat; the header chips in
 * HeaderSummary indicate the gate state at a glance.
 *
 * Progress row uses Option C: dots + inline labels in one wrapping row. On the
 * mitigation-first path the row gains two diamond-outline mitigation gates
 * (mitigation_accepted, mitigation_verified) inserted between Changes and
 * Root Cause. The pending milestone gets a tooltip with the
 * progress_transparency.milestone_description so the user can read what's
 * blocking without a separate "Needs" row.
 */

import React, { useState, useEffect } from 'react';
import type {
  CaseUIResponse,
  UploadedFileMetadata,
  UploadedFileDetailsResponse,
  UserCase,
  PathSelection,
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
  FilledDiamondIcon,
  EmptyDiamondIcon,
  CheckCircleIcon,
  formatDuration,
  formatFileSize,
} from './shared';
import { createLogger } from '~/lib/utils/logger';
import { capabilitiesManager } from '~/lib/capabilities';

const log = createLogger('CaseDetails');

// ==================== Constants ====================

interface MilestoneSpec {
  key: string;
  label: string;
  kind: 'indicator' | 'mitigation_gate';
}

/** The 6 universal progress indicators (no fixed order — completed opportunistically). */
const BASE_MILESTONES: MilestoneSpec[] = [
  { key: 'symptom_verified', label: 'Symptoms', kind: 'indicator' },
  { key: 'scope_assessed', label: 'Scope', kind: 'indicator' },
  { key: 'timeline_established', label: 'Timeline', kind: 'indicator' },
  { key: 'changes_identified', label: 'Changes', kind: 'indicator' },
  { key: 'root_cause_identified', label: 'Root Cause', kind: 'indicator' },
  { key: 'solution_proposed', label: 'Solution', kind: 'indicator' },
];

/**
 * Mitigation-first path inserts the two stage-gate milestones between Changes
 * and Root Cause, rendered as diamonds to signal "detour" (per slice 4 design).
 * RCA-only path uses BASE_MILESTONES unchanged.
 */
function buildMilestoneList(pathSelection: PathSelection | null | undefined): MilestoneSpec[] {
  if (pathSelection?.path !== 'mitigation_first') {
    return BASE_MILESTONES;
  }
  const before = BASE_MILESTONES.slice(0, 4); // up through Changes
  const after = BASE_MILESTONES.slice(4); // Root Cause, Solution
  return [
    ...before,
    { key: 'mitigation_accepted', label: 'Mit. Accepted', kind: 'mitigation_gate' },
    { key: 'mitigation_verified', label: 'Mit. Verified', kind: 'mitigation_gate' },
    ...after,
  ];
}

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

function isPlaceholderValue(text: string | null | undefined): boolean {
  if (!text) return true;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return PLACEHOLDER_VALUES.has(normalized);
}

interface UploadedFileWithEvidence extends UploadedFileMetadata {
  evidence_count?: number;
}

// ==================== Sub-components ====================

interface MilestoneMapProps {
  milestones: MilestoneSpec[];
  completedKeys: Set<string>;
  pendingMilestone: string | null;
  pendingDescription: string | null;
}

/**
 * Milestone visualization — icons + inline labels in one wrapping row.
 *
 * Indicators use circles, mitigation gates use diamonds. The pending milestone
 * (from progress_transparency, when active) pulses in warning color and carries
 * the milestone_description in its tooltip — the user can hover to read what's
 * blocking, replacing the standalone "Needs" row.
 */
const MilestoneMap: React.FC<MilestoneMapProps> = ({
  milestones,
  completedKeys,
  pendingMilestone,
  pendingDescription,
}) => (
  <div className="flex items-start gap-2 py-1 text-fm-sm">
    <span className="text-fm-text-tertiary w-[76px] flex-shrink-0 text-fm-sm font-medium">
      Progress
    </span>
    <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {milestones.map((m) => {
        const done = completedKeys.has(m.key);
        const isPending = pendingMilestone === m.key;
        const colorClass = done
          ? 'text-fm-success'
          : isPending
            ? 'text-fm-warning'
            : 'text-fm-text-tertiary';

        // Tooltip: pending milestone shows the description from progress
        // transparency when available, falling back to label-only.
        let title = m.label;
        if (done) title = `${m.label} ✓`;
        else if (isPending) {
          title = pendingDescription
            ? `${m.label} — ${pendingDescription}`
            : `${m.label} — needs attention`;
        }

        const Icon =
          m.kind === 'mitigation_gate'
            ? done
              ? FilledDiamondIcon
              : EmptyDiamondIcon
            : done
              ? FilledCircleIcon
              : EmptyCircleIcon;

        return (
          <span
            key={m.key}
            className={`inline-flex items-center gap-1 text-fm-xs ${colorClass}`}
            title={title}
          >
            <Icon className={`w-2 h-2 ${isPending ? 'animate-pulse' : ''}`} />
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

  // 1. Problem — hidden on inquiry (proposed statement is in chat, not committed).
  // Post-inquiry: sourced from caseData.problem_statement first, falling back
  // to activeCase.description for backwards compatibility while the field
  // rolls out across deployments.
  let problemRow: React.ReactNode = null;
  if (!isCaseInquiry(caseData)) {
    const fromCaseData =
      (isCaseInvestigating(caseData) || isCaseResolved(caseData) || isCaseClosed(caseData))
        ? caseData.problem_statement?.trim()
        : undefined;
    const confirmed = fromCaseData || activeCase?.description?.trim();
    if (confirmed) {
      problemRow = <DetailRow label="Problem">{confirmed}</DetailRow>;
    }
  }

  // 2. Progress (milestone map) — INVESTIGATING only.
  // Path-aware: includes mitigation gates as diamonds when on mitigation-first.
  let progressRow: React.ReactNode = null;
  if (isCaseInvestigating(caseData)) {
    const completedIndicators = new Set(caseData.progress.completed_indicators ?? []);
    // Include completed stage-gate milestones in the same set so mitigation
    // diamonds light up when the user reports compliance.
    for (const gate of caseData.progress.completed_stage_gates ?? []) {
      completedIndicators.add(gate);
    }
    const pendingMilestone = caseData.progress_transparency?.active
      ? caseData.progress_transparency.pending_milestone ?? null
      : null;
    const pendingDescription = caseData.progress_transparency?.active
      ? caseData.progress_transparency.milestone_description ?? null
      : null;
    const milestones = buildMilestoneList(caseData.path_selection ?? null);
    progressRow = (
      <MilestoneMap
        milestones={milestones}
        completedKeys={completedIndicators}
        pendingMilestone={pendingMilestone}
        pendingDescription={pendingDescription}
      />
    );
  }

  // 3. Leading Hypothesis (INVESTIGATING) / Root Cause (terminal).
  // Label changed from "Working Theory (mitigation first)" to "Leading
  // Hypothesis" — the path is now its own chip in HeaderSummary, no
  // parenthetical needed. getApproachHint regex removed.
  let understandingRow: React.ReactNode = null;
  if (isCaseInvestigating(caseData)) {
    const wc = caseData.working_conclusion;
    if (wc?.summary && !isPlaceholderValue(wc.summary)) {
      const confidence = Math.round((wc.confidence ?? 0) * 100);
      understandingRow = (
        <DetailRow label="Leading Hypothesis">
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

  // 4. Solution — RESOLVED only, hidden when an auto-generated resolution
  // summary report exists (the report's narrative covers it; the inline row
  // is redundant. The chat's inline closure summary is the primary surface.)
  let solutionRow: React.ReactNode = null;
  if (isCaseResolved(caseData)) {
    const hasResolutionSummary = (caseData.reports_available ?? []).some(
      (r) => r.report_type === 'resolution_summary' && r.status === 'auto_generated',
    );
    if (!hasResolutionSummary) {
      const solText = caseData.solution_applied?.description?.trim();
      if (solText && !isPlaceholderValue(solText)) {
        solutionRow = <DetailRow label="Solution">{solText}</DetailRow>;
      }
    }
  }

  // 5. Closure — CLOSED only, kept ONLY when the closure summary was skipped
  // (substance gate failed — no report to point at, so the closure-reason
  // label is the user's only signal of why the case closed).
  let closureRow: React.ReactNode = null;
  if (isCaseClosed(caseData)) {
    const closureSummary = (caseData.reports_available ?? []).find(
      (r) => r.report_type === 'closure_summary',
    );
    const closureSkipped = closureSummary?.status === 'skipped';
    if (closureSkipped) {
      const reason = activeCase?.closure_reason;
      if (reason && reason !== 'other' && CLOSURE_DISPLAY_INFO[reason]) {
        const info = CLOSURE_DISPLAY_INFO[reason];
        closureRow = (
          <DetailRow label="Closure">
            {info.label} — {info.description}
          </DetailRow>
        );
      }
    }
  }

  // File count is on every CaseUIResponse variant.
  const headerFileCount = caseData.uploaded_files_count ?? 0;

  // 6. Artifacts strip — combines investigation depth (evidence,
  // hypotheses, duration) with deliverables (solution, summary report,
  // runbook draft). Files stay on their own row below — they're inputs
  // to the investigation, not outputs.
  //
  // Summary + runbook badges are clickable links to the Dashboard when a
  // dashboard URL is configured (case detail Report tab for summaries,
  // KB Drafts filtered by case_id for runbooks). When not configured,
  // they render as plain indicators.
  let artifactsRow: React.ReactNode = null;
  {
    let evidence = 0;
    let hypotheses = 0;
    let durationMin = 0;
    let hasSolution = false;
    let hasSummary = false;
    let hasRunbook = false;

    if (isCaseInvestigating(caseData)) {
      evidence = caseData.progress.total_evidence ?? 0;
      hypotheses = caseData.active_hypotheses?.length ?? 0;
    } else if (isCaseResolved(caseData) || isCaseClosed(caseData)) {
      const rs = caseData.resolution_summary;
      evidence = rs?.evidence_collected ?? 0;
      hypotheses = rs?.hypotheses_tested ?? 0;
      durationMin = rs?.total_duration_minutes ?? 0;

      // solution_applied exists only on RESOLVED responses.
      if (isCaseResolved(caseData)) {
        const solText = caseData.solution_applied?.description?.trim();
        if (solText && !isPlaceholderValue(solText)) hasSolution = true;
      }

      // reports_available enumerates auto-generated summaries and any
      // case-linked runbook drafts (enriched server-side from
      // conversion_drafts).
      const reports = caseData.reports_available ?? [];
      hasSummary = reports.some(
        (r) =>
          (r.report_type === 'resolution_summary' ||
            r.report_type === 'closure_summary') &&
          r.status === 'auto_generated',
      );
      hasRunbook = reports.some((r) => r.report_type === 'runbook');
    }

    const dashboardUrl = capabilitiesManager.getDashboardUrl();
    const summaryHref = dashboardUrl
      ? `${dashboardUrl}/cases/${caseId}?tab=report`
      : null;
    const runbookHref = dashboardUrl
      ? `${dashboardUrl}/kb?tab=drafts&case=${encodeURIComponent(caseId)}`
      : null;

    const items: React.ReactNode[] = [];
    if (evidence > 0) items.push(`${evidence} evidence`);
    if (hypotheses > 0)
      items.push(`${hypotheses} hypothes${hypotheses === 1 ? 'is' : 'es'}`);
    if (hasSolution) items.push('1 solution');
    if (durationMin > 0) items.push(formatDuration(durationMin));
    if (hasSummary) {
      items.push(
        summaryHref ? (
          <a
            key="summary"
            href={summaryHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fm-accent hover:underline"
          >
            📄 summary
          </a>
        ) : (
          <span key="summary">📄 summary</span>
        ),
      );
    }
    if (hasRunbook) {
      items.push(
        runbookHref ? (
          <a
            key="runbook"
            href={runbookHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fm-accent hover:underline"
          >
            📘 runbook
          </a>
        ) : (
          <span key="runbook">📘 runbook</span>
        ),
      );
    }

    if (items.length > 0) {
      artifactsRow = (
        <DetailRow label="Artifacts">
          <span className="text-fm-text-secondary">
            {items.map((item, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span aria-hidden="true"> · </span>}
                {item}
              </React.Fragment>
            ))}
          </span>
        </DetailRow>
      );
    }
  }

  // 7. Files — drill-down (visible if any files reported by header or already fetched).
  const showFilesRow = headerFileCount > 0 || files.length > 0;

  // Reports row is intentionally dropped — the closure summary is rendered
  // inline in chat at the moment of generation (per the no-Dashboard-link
  // policy in CLAUDE.md). A header drill-down listing reports without a
  // working link to view them was noise.

  // Track which sub-rows we have so the wrapper renders an empty-state when none
  const anyRow =
    problemRow ||
    progressRow ||
    understandingRow ||
    solutionRow ||
    closureRow ||
    artifactsRow ||
    showFilesRow;

  if (!anyRow) {
    return (
      <div className="px-4 pb-2 pt-1.5 text-fm-sm text-fm-text-tertiary italic">
        {isCaseInquiry(caseData) ? 'Inquiry in progress…' : 'No details available yet.'}
      </div>
    );
  }

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {problemRow}
      {progressRow}
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
