/**
 * HeaderSummary Component
 *
 * Collapsed header bar — always visible at-a-glance status.
 * Line 1: Title + severity chip
 * Line 2: Phase dropdown + stage label + milestone fraction + timestamp + expand chevron
 */

import React, { useState, useRef, useEffect } from 'react';
import type {
  CaseUIResponse,
  DispositionEligibility,
  UserCase,
} from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';
import { STAGE_DISPLAY_INFO, CLOSURE_DISPLAY_INFO, STATUS_LABELS } from '../../../../lib/api/services/case-service';
import { SeverityChip, ChevronDownIcon, getPhaseIcon, formatTimeAgo } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('HeaderSummary');

/**
 * One entry in the case-action dropdown.
 *
 * ``status`` is the action to take when the user clicks. ``eligibility``
 * is the per-disposition readiness verdict from backend PR #373, used
 * to drive the per-value UX (label hint, tooltip, styling). It is null
 * on the legacy fallback path (case has no ``disposition_eligibility``
 * yet) and on phase-change transitions like ``inquiry → investigating``
 * which are not gated by disposition_eligibility.
 */
export interface CaseActionOption {
  status: UserCaseStatus;
  eligibility: DispositionEligibility | null;
}

/**
 * Derive the dropdown options for the case-action menu from the
 * server-provided readiness verdicts.
 *
 * Preference order:
 *   1. ``case.disposition_eligibility`` (post PR #373) — drives per-
 *      verdict UX on the resolved/closed entries. Items whose verdict
 *      is ``not_eligible`` are dropped entirely (rendered absent, not
 *      disabled, per the design).
 *   2. ``case.valid_next_states`` — structural fallback for older cases
 *      that have not yet been backfilled with disposition_eligibility.
 *      All items show with no verdict UX.
 *   3. Hardcoded per-status defaults — last-resort safety net so the
 *      dropdown is never empty during a degraded API response.
 *
 * INQUIRY's ``investigating`` transition is a phase change (not a
 * disposition) so it is always included unconditionally, independent
 * of ``disposition_eligibility``.
 *
 * Terminal states (``resolved`` / ``closed``) return ``[]`` —
 * disposition_eligibility on these is all ``not_eligible`` anyway.
 *
 * Exported for unit testing.
 */
export function getCaseActionOptions(
  caseData: CaseUIResponse,
): CaseActionOption[] {
  // Terminal states have no outgoing actions, regardless of which
  // gating field is present.
  if (caseData.status === 'resolved' || caseData.status === 'closed') {
    return [];
  }

  const elig = caseData.disposition_eligibility;

  if (caseData.status === 'inquiry') {
    // Phase change (investigating) is always offered; it is not a
    // disposition and is not gated by disposition_eligibility.
    const options: CaseActionOption[] = [
      { status: 'investigating', eligibility: null },
    ];
    if (elig) {
      if (elig.closed !== 'not_eligible') {
        options.push({ status: 'closed', eligibility: elig.closed });
      }
      // ``resolved`` is structurally invalid from INQUIRY (per backend
      // ALLOWED_ACTIONS) so disposition_eligibility.resolved is always
      // ``not_eligible`` here. Skip it.
      return options;
    }
    // Fallback: structural valid_next_states or hardcoded.
    const validStates =
      ('valid_next_states' in caseData && caseData.valid_next_states) || null;
    if (validStates) {
      for (const s of validStates) {
        if (s !== 'investigating' && s !== caseData.status) {
          options.push({ status: s as UserCaseStatus, eligibility: null });
        }
      }
    } else {
      options.push({ status: 'closed', eligibility: null });
    }
    return options;
  }

  // INVESTIGATING — both resolved and closed are content-gated.
  if (caseData.status === 'investigating') {
    if (elig) {
      const options: CaseActionOption[] = [];
      if (elig.resolved !== 'not_eligible') {
        options.push({ status: 'resolved', eligibility: elig.resolved });
      }
      if (elig.closed !== 'not_eligible') {
        options.push({ status: 'closed', eligibility: elig.closed });
      }
      return options;
    }
    const validStates =
      ('valid_next_states' in caseData && caseData.valid_next_states) || null;
    if (validStates) {
      return validStates
        .filter((s) => s !== caseData.status)
        .map((s) => ({ status: s as UserCaseStatus, eligibility: null }));
    }
    // Hardcoded fallback mirroring the legacy behaviour.
    return [
      { status: 'resolved', eligibility: null },
      { status: 'closed', eligibility: null },
    ];
  }

  return [];
}

/**
 * Per-verdict UX metadata for the dropdown entries. Two slots — one
 * for resolve, one for close — because the copy is direction-specific
 * (e.g., "closing would discard the resolution" only makes sense on
 * the close side).
 *
 * ``ready`` and ``not_eligible`` are intentionally absent: ``ready`` is
 * the default (no tooltip / hint / softer styling) and ``not_eligible``
 * never reaches the render path (filtered out in getCaseActionOptions).
 *
 * Note on coverage: per ``derive_disposition_eligibility``'s current
 * implementation, ``Close / needs_info`` and ``Resolve / suggests_-
 * alternative`` never fire today. The entries below are defensive
 * placeholders so a future backend change to those branches won't
 * leave the UI without a tooltip.
 */
const DISPOSITION_UX: Record<
  'resolved' | 'closed',
  Partial<
    Record<
      DispositionEligibility,
      { tooltip?: string; hint?: string; className?: string }
    >
  >
> = {
  resolved: {
    needs_info: {
      tooltip: 'Add root cause and solution before resolving',
      hint: 'needs more info',
    },
    // suggests_alternative: never fires for resolved per backend design
    // (too-thin cases land on not_eligible instead). Defensive entry
    // would go here if that ever changes.
  },
  closed: {
    needs_info: {
      // Defensive only — backend does not emit closed:needs_info today.
      hint: 'needs more info',
    },
    suggests_alternative: {
      tooltip:
        'This case qualifies for Resolved — closing would discard the resolution. Click to see alternatives.',
      className: 'opacity-70',
    },
  },
};

function getOptionUx(option: CaseActionOption): {
  tooltip?: string;
  hint?: string;
  className?: string;
} {
  if (!option.eligibility) return {};
  if (option.status !== 'resolved' && option.status !== 'closed') return {};
  return DISPOSITION_UX[option.status][option.eligibility] ?? {};
}

/** The 6 progress milestones for milestone fraction display */
const MILESTONE_KEYS = [
  'symptom_verified', 'scope_assessed', 'timeline_established',
  'changes_identified', 'root_cause_identified', 'solution_proposed',
];

interface HeaderSummaryProps {
  caseData: CaseUIResponse;
  activeCase?: UserCase | null;
  expanded: boolean;
  severity: string | null;
  onToggle: () => void;
  onStatusChangeRequest?: (newStatus: UserCaseStatus) => void;
}

export const HeaderSummary: React.FC<HeaderSummaryProps> = ({
  caseData,
  activeCase,
  expanded,
  severity,
  onToggle,
  onStatusChangeRequest,
}) => {
  const caseId = activeCase?.case_id || (caseData as any).case_id || null;
  const shortId = caseId ? caseId.slice(0, 8) : null;
  const [idCopied, setIdCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!caseId) return;
    navigator.clipboard.writeText(caseId).then(() => {
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    });
  };
  // Status label — shows substage for INVESTIGATING, closure reason for CLOSED.
  // Defensive default: when closure_reason is null/missing/unrecognized,
  // fall back to the 'other' enum entry rather than the bare literal "Closed".
  const getStatusLabel = (status: string): string => {
    if (status === caseData.status) {
      if (status === 'closed') {
        const reason = activeCase?.closure_reason;
        const info = (reason && CLOSURE_DISPLAY_INFO[reason]) || CLOSURE_DISPLAY_INFO.other;
        return `Closed - ${info.label}`;
      }
    }
    return STATUS_LABELS[status as UserCaseStatus] || status.charAt(0).toUpperCase() + status.slice(1);
  };

  // Pill className — stage-specific for INVESTIGATING
  const getStatusPillClass = (): string => {
    if (caseData.status === 'investigating' && 'progress' in caseData) {
      const stage = caseData.progress.current_stage;
      return STAGE_DISPLAY_INFO[stage]?.pillClass || 'border border-fm-accent-border bg-fm-accent-soft text-fm-accent';
    }
    if (caseData.status === 'closed') {
      return 'border border-fm-border bg-fm-surface text-fm-text-tertiary';
    }
    return 'border border-fm-accent-border bg-fm-accent-soft text-fm-accent';
  };

  // Get investigating context: stage label + milestone fraction
  const getInvestigatingContext = (): { stageLabel: string; completed: number; total: number } | null => {
    if (caseData.status !== 'investigating' || !('progress' in caseData)) return null;
    const stage = caseData.progress.current_stage;
    const stageLabel = STAGE_DISPLAY_INFO[stage]?.label || stage;
    const completedIndicators = new Set(caseData.progress.completed_indicators ?? []);
    const completed = MILESTONE_KEYS.filter(k => completedIndicators.has(k)).length;
    return { stageLabel, completed, total: MILESTONE_KEYS.length };
  };

  // Get available case actions. Prefers ``disposition_eligibility``
  // (PR #373) for content-gated dropdown rendering; falls back to the
  // structural ``valid_next_states`` for cases that haven't been
  // backfilled yet. See ``getCaseActionOptions`` JSDoc.
  const statusOptions = getCaseActionOptions(caseData);
  const canChangeStatus = statusOptions.length > 0 && onStatusChangeRequest;
  const investigatingContext = getInvestigatingContext();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleStatusSelect = (newStatus: UserCaseStatus) => {
    log.debug('handleStatusSelect fired', {
      currentStatus: caseData.status,
      newStatus,
      hasCallback: !!onStatusChangeRequest
    });

    setDropdownOpen(false);
    if (newStatus !== caseData.status && onStatusChangeRequest) {
      onStatusChangeRequest(newStatus);
    }
  };

  const pillClass = getStatusPillClass();
  const PhaseIcon = getPhaseIcon(caseData.status);

  return (
    <div className="p-3 cursor-pointer hover:bg-fm-elevated/40 transition-colors" onClick={onToggle}>
      {/* Line 1: Title + Short ID + Severity */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold text-white text-fm-title truncate flex-1 min-w-0">
          {caseData.title}
        </h2>
        {shortId && (
          <button
            type="button"
            onClick={handleCopyId}
            className="font-mono text-fm-xs text-fm-text-tertiary hover:text-fm-accent transition-colors flex-shrink-0 cursor-pointer"
            title={idCopied ? 'Copied!' : `Copy full ID: ${caseId}`}
          >
            {idCopied ? '✓' : `#${shortId}`}
          </button>
        )}
        <SeverityChip severity={severity} />
      </div>

      {/* Line 2: Phase pill + stage + milestones + timestamp + chevron */}
      <div className="flex items-center gap-1.5 text-fm-xs text-fm-text-tertiary">
        {/* Phase dropdown or static pill */}
        {canChangeStatus ? (
          <div className="relative inline-flex items-center" ref={dropdownRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen(!dropdownOpen);
              }}
              className={`cursor-pointer font-medium rounded-full focus:outline-none focus:ring-1 focus:ring-fm-accent pl-2 pr-5 py-0.5 inline-flex items-center gap-1 ${pillClass}`}
            >
              <PhaseIcon className="w-3 h-3" />
              {getStatusLabel(caseData.status)}
            </button>
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current/60 text-[10px]">▾</span>

            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[140px] bg-fm-elevated border border-fm-border rounded-lg shadow-lg z-50 py-1">
                {statusOptions.map((option) => {
                  const OptionIcon = getPhaseIcon(option.status);
                  const ux = getOptionUx(option);
                  return (
                    <button
                      key={option.status}
                      type="button"
                      // ``title`` is the browser-native tooltip; sufficient
                      // for the short verdict copy (no rich content needed).
                      title={ux.tooltip}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusSelect(option.status);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs text-fm-text-primary hover:bg-fm-accent-soft hover:text-fm-accent transition-colors flex items-center gap-1.5 ${ux.className ?? ''}`}
                    >
                      <OptionIcon className="w-3.5 h-3.5" />
                      <span>{STATUS_LABELS[option.status] || option.status}</span>
                      {ux.hint && (
                        <span className="ml-auto text-[10px] text-fm-warning">
                          {ux.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <span className={`font-medium rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${pillClass}`}>
            <PhaseIcon className="w-3 h-3" />
            {getStatusLabel(caseData.status)}
          </span>
        )}

        {/* Stage label + milestone fraction (investigating only) */}
        {investigatingContext && (
          <>
            <span className="text-fm-text-tertiary">·</span>
            <span className="text-fm-text-secondary">{investigatingContext.stageLabel}</span>
            <span className="text-fm-text-tertiary">·</span>
            <span className="text-fm-text-secondary">{investigatingContext.completed}/{investigatingContext.total}</span>
            {/* Path chip — surfaces non-default path commitment. RCA is the
                default; no chip needed for that case. Only renders when the
                user has confirmed the path (path_selection.user_confirmed). */}
            {'path_selection' in caseData
              && (caseData as any).path_selection?.user_confirmed
              && (caseData as any).path_selection.path === 'mitigation_first' && (
              <>
                <span className="text-fm-text-tertiary">·</span>
                <span
                  className="text-fm-accent text-[11px] font-medium"
                  title="Mitigation-first path: quick stabilization, then RCA"
                >
                  Mitigation-first
                </span>
              </>
            )}
            {/* Gate 3 pending chip — case is awaiting the user's decision
                whether to continue with RCA or close as mitigation-sufficient. */}
            {'path_selection' in caseData
              && (caseData as any).path_selection?.path === 'mitigation_first'
              && (caseData as any).path_selection?.mitigation_completed_at_turn != null
              && !(caseData as any).path_selection.rca_after_mitigation_confirmed && (
              <>
                <span className="text-fm-text-tertiary">·</span>
                <span
                  className="text-fm-warning text-[11px] font-medium"
                  title="Mitigation verified — choose to continue with RCA or close"
                >
                  RCA or close?
                </span>
              </>
            )}
            {/* Progress transparency fallback — only shows when no path-
                selection chip already covers the pending state. */}
            {'progress_transparency' in caseData
              && (caseData as any).progress_transparency?.active
              && !(caseData as any).path_selection?.mitigation_completed_at_turn && (
              <>
                <span className="text-fm-text-tertiary">·</span>
                <span className="text-fm-warning text-[11px]">Needs data</span>
              </>
            )}
          </>
        )}

        {/* Gate 2 pending chip — visible during INQUIRY when Gate 1 has
            passed but the user has not yet committed to a path. */}
        {caseData.status === 'inquiry'
          && (caseData as any).path_selection
          && !(caseData as any).path_selection.user_confirmed && (
          <>
            <span className="text-fm-text-tertiary">·</span>
            <span
              className="text-fm-warning text-[11px] font-medium"
              title="Confirm investigation path to start"
            >
              Awaiting path
            </span>
          </>
        )}

        <span className="text-fm-text-tertiary">·</span>
        <span className="text-fm-text-secondary">T{caseData.current_turn}</span>
        <span className="text-fm-text-tertiary">·</span>
        <span>{formatTimeAgo(caseData.updated_at)}</span>

        {/* Spacer + expand chevron */}
        <div className="flex-1" />
        <button
          className="p-1 text-fm-text-tertiary hover:text-fm-text-primary hover:bg-fm-elevated rounded transition-colors flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={expanded ? 'Collapse details' : 'Expand details'}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          <ChevronDownIcon
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </div>
  );
};
