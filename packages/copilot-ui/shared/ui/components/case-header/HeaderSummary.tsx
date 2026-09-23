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
import { STAGE_DISPLAY_INFO, closureDisplayFor, STATUS_LABELS, getValidActions } from '../../../../lib/api/services/case-service';
import { SeverityChip, ChevronDownIcon, getPhaseIcon, formatTimeAgo } from './shared';
import { createLogger } from '../../../../lib/utils/logger';

const log = createLogger('HeaderSummary');

/**
 * One entry in the case-action dropdown.
 *
 * ``status`` is the action to take when the user clicks. ``eligibility``
 * is the per-disposition readiness verdict from backend PR #373,
 * retained for analytics / future use even though the dropdown
 * currently surfaces only ``ready`` items (everything else is hidden
 * so the menu shows just what the engine will actually let through).
 * It is null on the legacy fallback path only — a case served without
 * ``disposition_eligibility``. Phase-change transitions used to be the
 * other source; there are none in this menu now (``inquiry →
 * investigating`` left in #1608, ``investigating → resolved`` in
 * contract 9.0.0), so every option this type describes is a disposition.
 */
export interface CaseActionOption {
  state: UserCaseState;
  eligibility: DispositionEligibility | null;
}

/**
 * Derive the dropdown options for the case-action menu from the
 * server-provided readiness verdicts.
 *
 * **Design rule:** the menu offers only what a user may PICK
 * (``ALLOWED_ACTIONS``) and only where the case CONTENT supports it
 * (``ready``). Both conditions, every path — the first is an allowlist
 * intersection rather than a list of exclusions.
 *
 *   - ``needs_info``  → clicking would dead-end on a readiness prompt;
 *                       the agent surfaces what's missing through the
 *                       conversation flow instead.
 *   - ``suggests_alternative`` → DO NOT RENDER. It is set exactly when a
 *                       qualifying causal-absence row is on the case,
 *                       which is exactly when the engine pivots every
 *                       close back to a resolve proposal — so a Close
 *                       control here could only ever produce "shall I
 *                       mark this resolved?". There is no alternative
 *                       control to render instead: resolve is not one.
 *   - ``not_eligible`` → no path to success.
 *
 * ‼ The menu CAN be empty, and on a resolution-grade case it is meant to be:
 * the case has one terminal destination and the agent is already offering it
 * through the confirm/decline pair. An earlier version of this block promised
 * the dropdown is "never empty"; that promise is what a degraded-API fallback
 * was for, not a property of the normal path.
 *
 * Preference order:
 *   1. ``case.disposition_eligibility`` (post PR #373) — of the actions
 *      ``ALLOWED_ACTIONS`` permits, keep those whose verdict is ``ready``.
 *   2. ``case.valid_next_states`` — structural fallback for older cases,
 *      INTERSECTED with ``ALLOWED_ACTIONS`` rather than filtered by a
 *      hand-maintained exclusion list.
 *   3. ``ALLOWED_ACTIONS`` alone — last resort when the server offers
 *      neither verdicts nor a state list.
 *
 * Both phases offer only ``closed``. ``investigating`` is reached by confirming
 * a problem statement (Gate 1) and ``resolved`` by confirming the resolution
 * the agent proposes once the root cause is confirmed eliminated — neither is
 * something a user picks. (Requesting ``investigating`` is refused by the
 * backend today; requesting ``resolved`` is refused from contract 9.0.0, which
 * this repo pins.)
 *
 * The INQUIRY branch used to inject ``investigating`` unconditionally with
 * ``eligibility: null`` — which meant the one transition with a real content
 * precondition was the one exempt from gating, and the backend could not take
 * it away because the entry was ours. ``resolved`` was the mirror of that: it
 * WAS gated here, on ``disposition_eligibility``, but only by this function's
 * convention — the server listed it in ``valid_next_states`` for every
 * investigating case, and the fallback below offered it ungated.
 *
 * Terminal states (``resolved`` / ``closed``) return ``[]`` —
 * disposition_eligibility on these is all ``not_eligible`` anyway.
 *
 * Exported for unit testing.
 */
export function getCaseActionOptions(
  caseData: CaseUIResponse,
): CaseActionOption[] {
  // ALLOWLIST, not a growing denylist. This was a chain of literal exclusions
  // added one per backend change — `s !== 'investigating'` (#1608), then
  // `s !== 'resolved'` — in two branches with two idioms, and that is exactly
  // how a gap ships: the INQUIRY fallback got the first filter and never the
  // second, so an older backend listing `resolved` for INQUIRY rendered a
  // Resolved control that leads to an empty modal and a silently dropped
  // submit. ``ALLOWED_ACTIONS`` already answers "what may a user pick from
  // this state", so ask it, and the omission becomes unrepresentable rather
  // than merely fixed.
  const selectable = getValidActions(caseData.state);
  if (selectable.length === 0) {
    // Terminal states, and any state the table gives no actions for.
    return [];
  }

  const elig = caseData.disposition_eligibility;
  if (elig) {
    // ‼ `ready` ONLY. `suggests_alternative` means DO NOT RENDER, not "warn
    // and offer anyway": it is set exactly when a qualifying causal-absence
    // row is on the case, which is exactly when every close pivots back to a
    // resolve proposal. A Close control there could only ever produce "shall I
    // mark this resolved?". On such a case there is NO status control, which
    // is the honest rendering: one terminal destination, and the agent is
    // already offering it in chat through the confirm/decline pair.
    return selectable
      .filter((s) => elig[s as keyof typeof elig] === 'ready')
      .map((s) => ({ state: s, eligibility: 'ready' as const }));
  }

  // Legacy fallback: an older backend with no eligibility verdicts. Intersect
  // rather than subtract — what the server lists AND the table allows.
  const validStates =
    ('valid_next_states' in caseData && caseData.valid_next_states) || null;
  if (validStates) {
    return validStates
      .filter(
        (s) =>
          s !== caseData.state && selectable.includes(s as UserCaseState),
      )
      .map((s) => ({ state: s as UserCaseState, eligibility: null }));
  }

  // Last resort: neither verdicts nor a server list. The table is the answer.
  return selectable.map((s) => ({ state: s, eligibility: null }));
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
  // Prefer the investigation turn; fall back to the clock only when the server
  // did not send one (contract older than 3.5.0). `??`, not `||`: 0 is a real
  // answer and must not fall through to the clock.
  const displayedCaseTurn = caseData.investigation_turn ?? caseData.current_turn;
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
        const info = closureDisplayFor(reason);
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

  // ‼ Close the menu when the control that owns it goes away. The
  // click-outside handler below closes on `dropdownRef.current`, and that ref
  // belongs to a subtree rendered only while `canChangeStatus` — so if the
  // control disappears with the menu open, React nulls the ref, the guard
  // `if (dropdownRef.current && ...)` is false forever, and `dropdownOpen`
  // latches true for the component's life. The menu then re-mounts ALREADY
  // OPEN if the control returns.
  //
  // This was survivable while a non-empty option list was the norm. It is a
  // mainline sequence now: a turn that records the fix flips eligibility to
  // {resolved: ready, closed: suggests_alternative}, the option list becomes
  // empty, and the control is replaced by a static pill — on exactly the turn
  // a user is most likely to have the menu open.
  useEffect(() => {
    if (!canChangeStatus) setDropdownOpen(false);
  }, [canChangeStatus]);

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

        {/* The INVESTIGATION turn, not the message clock (#251): an aside —
            small talk, trivia, a question about FaultMaven itself — advances
            `current_turn` and must leave this alone, which is the #1329
            symptom ("State: investigating Turn 8" after a haiku) read off the
            header. Falls back to the clock on a server older than contract
            3.5.0.

            Suppressed entirely at 0, which is what a case whose only exchange
            was an aside reports. `ChatWindow` drops the row label at 0 for the
            same reason — there is no turn to name yet — and one value must not
            read two ways on one screen. */}
        {displayedCaseTurn ? (
          <>
            <span className="text-fm-text-tertiary">·</span>
            <span className="text-fm-text-secondary">T{displayedCaseTurn}</span>
          </>
        ) : null}
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
