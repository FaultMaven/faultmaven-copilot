/**
 * HeaderSummary Component
 *
 * Collapsed header bar — always visible at-a-glance status.
 * Line 1: Title + severity chip
 * Line 2: Phase dropdown + stage label + milestone fraction + timestamp + expand chevron
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CaseUIResponse, UserCase } from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';
import { STAGE_DISPLAY_INFO, CLOSURE_DISPLAY_INFO, STATUS_LABELS } from '../../../../lib/api/services/case-service';
import { SeverityChip, ChevronDownIcon, getPhaseIcon, formatTimeAgo } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('HeaderSummary');

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
  // Status label — shows substage for INVESTIGATING, closure reason for CLOSED
  const getStatusLabel = (status: string): string => {
    if (status === caseData.status) {
      if (status === 'closed') {
        const reason = activeCase?.closure_reason;
        if (reason && CLOSURE_DISPLAY_INFO[reason]) {
          return `Closed - ${CLOSURE_DISPLAY_INFO[reason].label}`;
        }
        return 'Closed';
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

  // Get available case actions
  const getAvailableCaseActions = (currentStatus: string): UserCaseStatus[] => {
    if ('valid_next_states' in caseData && caseData.valid_next_states) {
      return caseData.valid_next_states as UserCaseStatus[];
    }
    if (currentStatus === 'resolved' || currentStatus === 'closed') return [];
    if (currentStatus === 'inquiry') return ['investigating' as UserCaseStatus, 'closed' as UserCaseStatus];
    if (currentStatus === 'investigating') return ['resolved' as UserCaseStatus, 'closed' as UserCaseStatus];
    return [];
  };

  const statusOptions = getAvailableCaseActions(caseData.status);
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
                {statusOptions.map(status => {
                  const OptionIcon = getPhaseIcon(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStatusSelect(status);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-fm-text-primary hover:bg-fm-accent-soft hover:text-fm-accent transition-colors flex items-center gap-1.5"
                    >
                      <OptionIcon className="w-3.5 h-3.5" />
                      {STATUS_LABELS[status] || status}
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
