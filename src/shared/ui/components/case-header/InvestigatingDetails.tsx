/**
 * InvestigatingDetails Component
 *
 * Expanded header content for INVESTIGATING phase
 * Shows: Problem, Milestone checklist, Stage flow, Evidence with type badges,
 * Working Theory (renamed from Root Cause), Active Hypotheses
 *
 * Aligned with: investigation-lifecycle-logic.md, investigation-data-models.md
 */

import React from 'react';
import type { CaseUIResponse_Investigating } from '../../../../types/case';
import { STAGE_DISPLAY_INFO, getEvidenceTypeInfo } from '../../../../lib/api/services/case-service';

/** The 6 progress milestones (non-stage-driving) in investigation order */
const PROGRESS_MILESTONES: { key: string; label: string }[] = [
  { key: 'symptom_verified', label: 'Symptoms' },
  { key: 'scope_assessed', label: 'Scope' },
  { key: 'timeline_established', label: 'Timeline' },
  { key: 'changes_identified', label: 'Changes' },
  { key: 'root_cause_identified', label: 'Root Cause' },
  { key: 'solution_proposed', label: 'Solution' },
];

/** Stage flow definitions per investigation path */
const STAGE_FLOW = {
  root_cause: ['diagnosis', 'treatment'] as const,
  mitigation_first: ['diagnosis', 'mitigation', 'diagnosis', 'treatment'] as const,
};

interface InvestigatingDetailsProps {
  data: CaseUIResponse_Investigating;
  caseId: string;
}

export const InvestigatingDetails: React.FC<InvestigatingDetailsProps> = ({
  data,
}) => {
  const completedIndicators = new Set(data.progress.completed_indicators ?? []);
  const completedCount = completedIndicators.size;

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

  // Infer investigation path from strategy approach text
  const inferPath = (): 'root_cause' | 'mitigation_first' | null => {
    const approach = data.investigation_strategy?.approach?.toLowerCase() ?? '';
    if (/mitigat|quick fix|workaround|speed|urgent/.test(approach)) return 'mitigation_first';
    if (/root cause|analysis|diagnos|systematic/.test(approach)) return 'root_cause';
    return null;
  };

  const currentStage = data.progress.current_stage;
  const stageInfo = STAGE_DISPLAY_INFO[currentStage];
  const path = inferPath();

  return (
    <div className="px-4 pb-4 space-y-3 text-sm">
      {/* Problem Statement */}
      <div>
        <h4 className="font-medium text-fm-text-primary mb-1">Problem:</h4>
        <p className="text-white">{data.title}</p>
      </div>

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Milestone Checklist */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-fm-text-primary">
            🎯 Milestones ({completedCount}/{PROGRESS_MILESTONES.length})
          </span>
        </div>
        {/* Dot indicators */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
          {PROGRESS_MILESTONES.map((m) => {
            const done = completedIndicators.has(m.key);
            return (
              <span
                key={m.key}
                className={`text-xs ${done ? 'text-fm-success' : 'text-fm-text-tertiary'}`}
                title={done ? `${m.label} ✓` : m.label}
              >
                {done ? '●' : '○'} {m.label}
              </span>
            );
          })}
        </div>
        {/* Slim progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-fm-elevated rounded-full h-1.5">
            <div
              className="bg-fm-accent h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round((completedCount / PROGRESS_MILESTONES.length) * 100)}%` }}
            />
          </div>
          <span className="text-fm-text-tertiary text-xs">{Math.round((completedCount / PROGRESS_MILESTONES.length) * 100)}%</span>
        </div>
      </div>

      {/* Stage Flow Line */}
      {path && (
        <div className="flex items-center gap-1 text-xs text-fm-text-tertiary">
          <span className="text-fm-text-primary font-medium mr-1">Path:</span>
          {STAGE_FLOW[path].map((stage, i) => {
            const info = STAGE_DISPLAY_INFO[stage];
            const isCurrent = stage === currentStage;
            return (
              <React.Fragment key={`${stage}-${i}`}>
                {i > 0 && <span className="mx-0.5">━</span>}
                <span className={isCurrent ? 'font-bold text-white' : ''}>
                  {isCurrent && '▸ '}{info?.label || stage}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {!path && stageInfo && (
        <div className="text-xs text-fm-text-tertiary">
          <span className="text-fm-text-primary font-medium">Stage: </span>
          <span className="text-white font-medium">{stageInfo.icon} {stageInfo.label}</span>
        </div>
      )}

      {/* Strategy */}
      {data.investigation_strategy?.approach && (
        <div>
          <span className="font-medium text-fm-text-primary">⚡ Strategy: </span>
          <span className="text-white">{data.investigation_strategy.approach}</span>
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Working Theory (renamed from Root Cause) */}
      {data.working_conclusion && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">💡 Working Theory:</h4>
          <p className="text-white mb-1">
            Working Theory ({Math.round(data.working_conclusion.confidence * 100)}%): {data.working_conclusion.summary}
          </p>
          {data.working_conclusion.last_updated && (
            <div className="text-xs text-fm-text-tertiary">
              Last updated: {formatTimeAgo(data.working_conclusion.last_updated)}
            </div>
          )}
        </div>
      )}

      {/* Evidence Section (replaces flat file count) */}
      {(data.progress.total_evidence > 0 || (data.latest_evidence && data.latest_evidence.length > 0)) && (
        <div>
          <h4 className="font-medium text-fm-text-primary mb-1">
            🔬 Evidence ({data.progress.total_evidence} collected):
          </h4>
          {data.latest_evidence && data.latest_evidence.length > 0 ? (
            <div className="space-y-1.5 pl-1">
              {data.latest_evidence.slice(0, 3).map((ev) => {
                const typeInfo = getEvidenceTypeInfo(ev.type);
                return (
                  <div key={ev.evidence_id} className="flex items-start gap-2">
                    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${typeInfo.badgeClass}`}>
                      {typeInfo.icon} {typeInfo.label}
                    </span>
                    <span className="text-white text-xs flex-1">{ev.summary}</span>
                  </div>
                );
              })}
              {data.latest_evidence.length > 3 && (
                <p className="text-xs text-fm-text-tertiary pl-1">
                  +{data.latest_evidence.length - 3} more
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-fm-text-tertiary italic">Evidence collected, details loading...</p>
          )}
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-fm-border"></div>

      {/* Footer: hypotheses summary */}
      <div className="text-center text-fm-text-primary text-xs">
        🔬 {data.progress.total_evidence} evidence
        {data.active_hypotheses && data.active_hypotheses.length > 0 && (
          <> · 💡 {data.active_hypotheses.length} hypothesis{data.active_hypotheses.length > 1 ? 'es' : ''}</>
        )}
      </div>
    </div>
  );
};
