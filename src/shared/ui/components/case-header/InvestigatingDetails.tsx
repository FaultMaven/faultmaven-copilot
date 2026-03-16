/**
 * InvestigatingDetails Component
 *
 * Expanded header content for INVESTIGATING phase.
 * Compact key-value rows: Progress, Stage, Root Cause, Evidence (drill-down),
 * Hypotheses (drill-down), Files (drill-down, lazy-fetched).
 */

import React, { useState, useEffect } from 'react';
import type { CaseUIResponse_Investigating, UploadedFileMetadata, UploadedFileDetailsResponse } from '../../../../types/case';
import { STAGE_DISPLAY_INFO, getEvidenceTypeInfo } from '../../../../lib/api/services/case-service';
import { filesApi } from '../../../../lib/api/files-service';
import { EvidenceDetailsModal } from './EvidenceDetailsModal';
import { DetailRow, FilledCircleIcon, EmptyCircleIcon, formatFileSize } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('InvestigatingDetails');

/** The 6 progress milestones in investigation order */
const MILESTONE_KEYS: { key: string; label: string }[] = [
  { key: 'symptom_verified', label: 'Symptoms' },
  { key: 'scope_assessed', label: 'Scope' },
  { key: 'timeline_established', label: 'Timeline' },
  { key: 'changes_identified', label: 'Changes' },
  { key: 'root_cause_identified', label: 'Root Cause' },
  { key: 'solution_proposed', label: 'Solution' },
];

interface UploadedFileWithEvidence extends UploadedFileMetadata {
  evidence_count?: number;
}

interface InvestigatingDetailsProps {
  data: CaseUIResponse_Investigating;
  caseId: string;
  expandedSection: string | null;
  onToggleSection: (section: string) => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const InvestigatingDetails: React.FC<InvestigatingDetailsProps> = ({
  data,
  caseId,
  expandedSection,
  onToggleSection,
  onScrollToTurn,
}) => {
  const completedIndicators = new Set(data.progress.completed_indicators ?? []);

  // Files state — lazy-fetched on drill-down expand
  const [files, setFiles] = useState<UploadedFileWithEvidence[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesFetched, setFilesFetched] = useState(false);
  const [selectedFileForEvidence, setSelectedFileForEvidence] = useState<string | null>(null);
  const [evidenceDetails, setEvidenceDetails] = useState<UploadedFileDetailsResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const filesExpanded = expandedSection === 'files';

  // Fetch files when files section is expanded (lazy load)
  useEffect(() => {
    if (filesExpanded && !filesFetched) {
      const fetchFiles = async () => {
        setFilesLoading(true);
        try {
          const fetchedFiles = await filesApi.getUploadedFiles(caseId);
          setFiles(fetchedFiles);
        } catch (error) {
          log.error('Failed to fetch files', error);
        } finally {
          setFilesLoading(false);
          setFilesFetched(true);
        }
      };
      fetchFiles();
    }
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

  // Infer approach hint from strategy text
  const getApproachHint = (): string | null => {
    const approach = data.investigation_strategy?.approach?.toLowerCase() ?? '';
    if (/mitigat|quick fix|workaround|speed|urgent/.test(approach)) return 'mitigation first';
    if (/root cause|analysis|diagnos|systematic/.test(approach)) return 'root cause analysis';
    return null;
  };

  // Compute hypothesis counts
  const getHypothesisSummary = (): string | null => {
    const hypotheses = data.active_hypotheses;
    if (!hypotheses || hypotheses.length === 0) return null;

    const active = hypotheses.filter(h =>
      ['captured', 'active', 'validated'].includes(h.status)
    ).length;
    const rejected = hypotheses.filter(h => h.status === 'refuted').length;

    const parts: string[] = [];
    if (active > 0) parts.push(`${active} active`);
    if (rejected > 0) parts.push(`${rejected} rejected`);
    return parts.join(', ') || `${hypotheses.length} total`;
  };

  const currentStage = data.progress.current_stage;
  const stageLabel = STAGE_DISPLAY_INFO[currentStage]?.label || currentStage;
  const approachHint = getApproachHint();
  const hypothesisSummary = getHypothesisSummary();
  const evidenceExpanded = expandedSection === 'evidence';
  const hypothesesExpanded = expandedSection === 'hypotheses';

  // Show Files row if backend reports files or we haven't fetched yet
  const fileCount = data.uploaded_files_count ?? 0;
  const showFilesRow = fileCount > 0 || files.length > 0 || !filesFetched;

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {/* Progress — milestone dots */}
      <DetailRow label="Progress">
        <span className="inline-flex items-center gap-1.5">
          {MILESTONE_KEYS.map((m) => {
            const done = completedIndicators.has(m.key);
            return done ? (
              <span key={m.key} title={`${m.label} ✓`}>
                <FilledCircleIcon className="w-2 h-2 text-fm-success" />
              </span>
            ) : (
              <span key={m.key} title={m.label}>
                <EmptyCircleIcon className="w-2 h-2 text-fm-text-tertiary" />
              </span>
            );
          })}
        </span>
      </DetailRow>

      {/* Stage + approach hint */}
      <DetailRow label="Stage">
        {stageLabel}{approachHint ? ` (${approachHint})` : ''}
      </DetailRow>

      {/* Root Cause = working_conclusion during investigating */}
      {data.working_conclusion && (
        <DetailRow label="Root Cause">
          <span className="truncate">
            {data.working_conclusion.summary} ({Math.round(data.working_conclusion.confidence * 100)}%)
          </span>
        </DetailRow>
      )}

      {/* Evidence — expandable */}
      {data.progress.total_evidence > 0 && (
        <>
          <DetailRow
            label="Evidence"
            expandable
            expanded={evidenceExpanded}
            onToggle={() => onToggleSection('evidence')}
          >
            {data.progress.total_evidence} item{data.progress.total_evidence !== 1 ? 's' : ''}
          </DetailRow>

          {evidenceExpanded && data.latest_evidence && data.latest_evidence.length > 0 && (
            <div className="pl-[84px] pb-0.5">
              <div className="space-y-0.5">
                {data.latest_evidence.slice(0, 5).map((ev, idx) => {
                  const typeInfo = getEvidenceTypeInfo(ev.type);
                  const isLast = idx === Math.min(data.latest_evidence!.length, 5) - 1;
                  const categoryLabel = ev.category && ev.category !== 'OTHER'
                    ? ev.category.replace(/_EVIDENCE$/, '').toLowerCase()
                    : null;
                  return (
                    <div key={ev.evidence_id} className="flex items-center gap-1.5 text-fm-xs">
                      <span className="text-fm-text-tertiary">{isLast ? '└' : '├'}</span>
                      <span className={`font-mono font-medium px-1 rounded-sm text-[10px] ${typeInfo.badgeClass}`}>
                        {typeInfo.shortLabel}
                      </span>
                      {ev.source_filename && (
                        <span className="text-fm-text-tertiary text-[10px] truncate max-w-[100px] flex-shrink-0" title={ev.source_filename}>
                          {ev.source_filename}
                        </span>
                      )}
                      <span className="text-fm-text-primary truncate flex-1">{ev.summary}</span>
                      {categoryLabel && (
                        <span className="text-fm-text-tertiary text-[10px] flex-shrink-0">{categoryLabel}</span>
                      )}
                      {/* Turn 0 = legacy data predating the collected_at_turn column */}
                      {ev.collected_at_turn > 0 && (
                        onScrollToTurn ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onScrollToTurn(ev.collected_at_turn); }}
                            className="text-fm-accent hover:text-fm-accent/80 flex-shrink-0"
                            title={`Jump to turn ${ev.collected_at_turn}`}
                          >
                            T{ev.collected_at_turn}
                          </button>
                        ) : (
                          <span className="text-fm-text-tertiary flex-shrink-0">T{ev.collected_at_turn}</span>
                        )
                      )}
                    </div>
                  );
                })}
                {data.latest_evidence.length > 5 && (
                  <p className="text-fm-xs text-fm-text-tertiary pl-4">
                    +{data.latest_evidence.length - 5} more
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Hypotheses — expandable */}
      {hypothesisSummary && (
        <>
          <DetailRow
            label="Hypotheses"
            expandable
            expanded={hypothesesExpanded}
            onToggle={() => onToggleSection('hypotheses')}
          >
            {hypothesisSummary}
          </DetailRow>

          {hypothesesExpanded && data.active_hypotheses && data.active_hypotheses.length > 0 && (
            <div className="pl-[84px] pb-0.5">
              <div className="space-y-0.5">
                {data.active_hypotheses.map((h, idx) => {
                  const isRefuted = h.status === 'refuted';
                  const isLast = idx === data.active_hypotheses!.length - 1;
                  return (
                    <div key={h.hypothesis_id} className="flex items-center gap-1.5 text-fm-xs">
                      <span className="text-fm-text-tertiary">{isLast ? '└' : '├'}</span>
                      <span className={isRefuted ? 'text-fm-critical' : 'text-fm-accent'}>
                        {isRefuted ? '✗' : '●'}
                      </span>
                      <span className="text-fm-text-primary truncate flex-1">{h.text}</span>
                      <span className="text-fm-text-tertiary flex-shrink-0">({h.status})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Files — expandable, lazy-fetched */}
      {showFilesRow && (
        <>
          <DetailRow
            label="Files"
            expandable
            expanded={filesExpanded}
            onToggle={() => onToggleSection('files')}
          >
            {fileCount > 0 ? `${fileCount} uploaded` : 'View uploads'}
          </DetailRow>

          {filesExpanded && (
            <div className="pl-[84px] pb-0.5">
              {filesLoading && (
                <p className="text-fm-xs text-fm-text-tertiary italic py-0.5">Loading...</p>
              )}
              {!filesLoading && files.length > 0 && (
                <div className="space-y-0.5">
                  {files.map((file, idx) => (
                    <div key={file.file_id} className="flex items-center gap-1.5 text-fm-xs text-fm-text-primary">
                      <span className="text-fm-text-tertiary">{idx < files.length - 1 ? '├' : '└'}</span>
                      <span className="truncate">{file.filename}</span>
                      <span className="text-fm-text-tertiary flex-shrink-0">({formatFileSize(file.size_bytes)})</span>
                      {file.evidence_count !== undefined && file.evidence_count > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleShowEvidence(file.file_id); }}
                          className="text-fm-success hover:text-fm-success/80 flex-shrink-0"
                        >
                          {file.evidence_count} evidence
                        </button>
                      )}
                      {onScrollToTurn && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onScrollToTurn(file.uploaded_at_turn); }}
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

      {/* Evidence Details Modal (for file evidence drill-down) */}
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
