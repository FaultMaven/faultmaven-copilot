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
import type { UserCaseState } from '../../../../lib/api';
import { STAGE_DISPLAY_INFO, CLOSURE_DISPLAY_INFO, STATUS_LABELS } from '../../../../lib/api/services/case-service';
import { SeverityChip, ChevronDownIcon, getPhaseIcon, formatTimeAgo } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('HeaderSummary');

/**
 * One entry in the case-action dropdown.
 *
 * ``status`` is the action to take when the user clicks. ``eligibility``
 * is the per-disposition readiness verdict from backend PR #373,
 * retained for analytics / future use even though the dropdown
 * currently surfaces only ``ready`` items (everything else is hidden
 * so the menu shows just what the engine will actually let through).
 * It is null on the legacy fallback path (case has no
 * ``disposition_eligibility`` yet) and on phase-change transitions
 * like ``inquiry → investigating`` which are not gated by
 * disposition_eligibility.
 */
export interface CaseActionOption {
  state: UserCaseState;
  eligibility: DispositionEligibility | null;
}

/**
 * Derive the dropdown options for the case-action menu from the
 * server-provided readiness verdicts.
 *
 * **Design rule:** the dropdown surfaces *only* options the engine
 * will accept as the user's terminal disposition for the case as-is.
 * That means we show only ``ready`` verdicts; ``needs_info``,
 * ``suggests_alternative``, and ``not_eligible`` are all hidden.
 *
 *   - ``needs_info``  → clicking would dead-end on a readiness prompt;
 *                       the agent surfaces what's missing through the
 *                       conversation flow instead.
 *   - ``suggests_alternative`` → clicking would pivot to the other
 *                       disposition (the engine's SUGGEST_RESOLVE
 *                       behaviour, [milestone_engine.py:6594-6603]).
 *                       Don't waste the user's click; the engine
 *                       considers the other action the right answer,
 *                       so render that instead.
 *   - ``not_eligible`` → no path to success.
 *
 * Both backend paths (dropdown click and natural-language request)
 * converge on the same ``assess_*_readiness`` + pivot logic, so the
 * dropdown options match what a free-text "please close this case"
 * request would commit to. Hiding non-``ready`` verdicts keeps the
 * UI honest with the engine.
 *
 * Preference order:
 *   1. ``case.disposition_eligibility`` (post PR #373) — keep only
 *      entries whose verdict is ``ready``.
 *   2. ``case.valid_next_states`` — structural fallback for older
 *      cases. All items show (the rich verdict isn't available, so
 *      we fall back to "show what the action graph allows").
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
  if (caseData.state === 'resolved' || caseData.state === 'closed') {
    return [];
  }

  const elig = caseData.disposition_eligibility;

  if (caseData.state === 'inquiry') {
    // Phase change (investigating) is always offered; it is not a
    // disposition and is not gated by disposition_eligibility.
    const options: CaseActionOption[] = [
      { state: 'investigating', eligibility: null },
    ];
    if (elig) {
      if (elig.closed === 'ready') {
        options.push({ state: 'closed', eligibility: 'ready' });
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
        if (s !== 'investigating' && s !== caseData.state) {
          options.push({ state: s as UserCaseState, eligibility: null });
        }
      }
    } else {
      options.push({ state: 'closed', eligibility: null });
    }
    return options;
  }

  // INVESTIGATING — both resolved and closed are content-gated.
  if (caseData.state === 'investigating') {
    if (elig) {
      const options: CaseActionOption[] = [];
      if (elig.resolved === 'ready') {
        options.push({ state: 'resolved', eligibility: 'ready' });
      }
      if (elig.closed === 'ready') {
        options.push({ state: 'closed', eligibility: 'ready' });
      }
      return options;
    }
    const validStates =
      ('valid_next_states' in caseData && caseData.valid_next_states) || null;
    if (validStates) {
      return validStates
        .filter((s) => s !== caseData.state)
        .map((s) => ({ state: s as UserCaseState, eligibility: null }));
    }
    // Hardcoded fallback mirroring the legacy behaviour.
    return [
      { state: 'resolved', eligibility: null },
      { state: 'closed', eligibility: null },
    ];
  }

  return [];
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
  onStatusChangeRequest?: (newStatus: UserCaseState) => void;
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
    // Defensive: a malformed/missing state must never crash the header
    // (a white-screened panel is strictly worse than a blank label).
    if (!status) return '—';
    if (status === caseData.state) {
      if (status === 'closed') {
        const reason = activeCase?.closure_reason;
        const info = (reason && CLOSURE_DISPLAY_INFO[reason]) || CLOSURE_DISPLAY_INFO.other;
        return `Closed - ${info.label}`;
      }
    }
    return STATUS_LABELS[status as UserCaseState] || status.charAt(0).toUpperCase() + status.slice(1);
  };

  // Pill className — stage-specific for INVESTIGATING
  const getStatusPillClass = (): string => {
    if (caseData.state === 'investigating' && 'progress' in caseData) {
      const stage = caseData.progress.current_stage;
      return STAGE_DISPLAY_INFO[stage]?.pillClass || 'border border-fm-accent-border bg-fm-accent-soft text-fm-accent';
    }
    if (caseData.state === 'closed') {
      return 'border border-fm-border bg-fm-surface text-fm-text-tertiary';
    }
    return 'border border-fm-accent-border bg-fm-accent-soft text-fm-accent';
  };

  // Get investigating context: stage label + milestone fraction
  const getInvestigatingContext = (): { stageLabel: string; completed: number; total: number } | null => {
    if (caseData.state !== 'investigating' || !('progress' in caseData)) return null;
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

  const handleStatusSelect = (newStatus: UserCaseState) => {
    log.debug('handleStatusSelect fired', {
      currentStatus: caseData.state,
      newStatus,
      hasCallback: !!onStatusChangeRequest
    });

    setDropdownOpen(false);
    if (newStatus !== caseData.state && onStatusChangeRequest) {
      onStatusChangeRequest(newStatus);
    }
  };

  const pillClass = getStatusPillClass();
  const PhaseIcon = getPhaseIcon(caseData.state);

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
        {/* Phase display — three render modes:
            1. Terminal (resolved/closed) → plain inline label (no pill,
               no button affordance, no chevron). The case is in its
               final state; surfacing this as a button-shaped control
               would imply actionability that doesn't exist.
            2. Non-terminal with actions available → dropdown button
               with chevron + menu of valid transitions.
            3. Non-terminal with no actions available → static pill
               (fallback; rare in practice). */}
        {caseData.state === 'resolved' || caseData.state === 'closed' ? (
          <span className="inline-flex items-center gap-1 font-medium text-fm-text-secondary">
            <PhaseIcon className="w-3 h-3" />
            {getStatusLabel(caseData.state)}
          </span>
        ) : canChangeStatus ? (
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
              {getStatusLabel(caseData.state)}
            </button>
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current/60 text-[10px]">▾</span>

            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[140px] bg-fm-elevated border border-fm-border rounded-lg shadow-lg z-50 py-1">
                {statusOptions.map((option) => {
                  const OptionIcon = getPhaseIcon(option.state);
                  return (
                    <button
                      key={option.state}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusSelect(option.state);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-fm-text-primary hover:bg-fm-accent-soft hover:text-fm-accent transition-colors flex items-center gap-1.5"
                    >
                      <OptionIcon className="w-3.5 h-3.5" />
                      <span>{STATUS_LABELS[option.state] || option.state}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <span className={`font-medium rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${pillClass}`}>
            <PhaseIcon className="w-3 h-3" />
            {getStatusLabel(caseData.state)}
          </span>
        )}

        {/* Stage label + milestone fraction (investigating only) */}
        {investigatingContext && (
          <>
            <span className="text-fm-text-tertiary">·</span>
            <span className="text-fm-text-secondary">{investigatingContext.stageLabel}</span>
            <span className="text-fm-text-tertiary">·</span>
            <span className="text-fm-text-secondary">{investigatingContext.completed}/{investigatingContext.total}</span>
            {/* Progress transparency — shows when data acquisition is stalled. */}
            {'progress_transparency' in caseData
              && (caseData as any).progress_transparency?.active && (
              <>
                <span className="text-fm-text-tertiary">·</span>
                <span className="text-fm-warning text-[11px]">Needs data</span>
              </>
            )}
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
