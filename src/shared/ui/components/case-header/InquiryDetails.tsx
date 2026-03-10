/**
 * InquiryDetails Component
 *
 * Expanded header content for INQUIRY phase.
 * Progressive rendering: shows only rows with data.
 * Early inquiry = minimal (maybe just Files), late inquiry = problem/severity/status/files.
 */

import React, { useState, useEffect } from 'react';
import type { InquiryData, UploadedFileMetadata, UploadedFileDetailsResponse } from '../../../../types/case';
import { filesApi } from '../../../../lib/api/files-service';
import { EvidenceDetailsModal } from './EvidenceDetailsModal';
import { DetailRow, CheckCircleIcon, formatFileSize } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('InquiryDetails');

interface UploadedFileWithEvidence extends UploadedFileMetadata {
  evidence_count?: number;
}

interface InquiryDetailsProps {
  data: InquiryData;
  caseId: string;
  uploadedFilesCount: number;
  expandedSection: string | null;
  onToggleSection: (section: string) => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const InquiryDetails: React.FC<InquiryDetailsProps> = ({
  data,
  caseId,
  uploadedFilesCount,
  expandedSection,
  onToggleSection,
  onScrollToTurn,
}) => {
  const [files, setFiles] = useState<UploadedFileWithEvidence[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedFileForEvidence, setSelectedFileForEvidence] = useState<string | null>(null);
  const [evidenceDetails, setEvidenceDetails] = useState<UploadedFileDetailsResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const filesExpanded = expandedSection === 'files';

  // Fetch files when files section is expanded
  useEffect(() => {
    if (filesExpanded && files.length === 0) {
      const fetchFiles = async () => {
        log.debug('Fetching files for case:', caseId);
        setFilesLoading(true);
        setFilesError(null);
        try {
          const fetchedFiles = await filesApi.getUploadedFiles(caseId);
          setFiles(fetchedFiles);
        } catch (error) {
          log.error('Failed to fetch files', error);
          setFilesError(error instanceof Error ? error.message : 'Failed to load files');
        } finally {
          setFilesLoading(false);
        }
      };
      fetchFiles();
    }
  }, [filesExpanded, caseId, files.length]);

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

  // Null inquiry data — brand new case
  if (!data) {
    log.warn('Backend sent null inquiry data - API contract violation. Case still functional.');
    return (
      <div className="px-4 pb-2 pt-1.5 text-fm-sm text-fm-text-tertiary italic">
        Inquiry starting — details will appear after first interaction.
      </div>
    );
  }

  const hasFiles = uploadedFilesCount > 0 || files.length > 0;
  const hasProblem = !!data.proposed_problem_statement;
  const severityGuess = (data.problem_confirmation as Record<string, unknown> | null)?.severity_guess as string | undefined;

  // Nothing to show yet
  if (!hasProblem && !hasFiles) {
    return (
      <div className="px-4 pb-2 pt-1.5 text-fm-sm text-fm-text-tertiary italic">
        Inquiry in progress...
      </div>
    );
  }

  return (
    <div className="px-4 pb-2 pt-1.5 space-y-0">
      {hasProblem && (
        <DetailRow label="Problem">
          <span className="italic">"{data.proposed_problem_statement}"</span>
        </DetailRow>
      )}

      {hasProblem && severityGuess && (
        <DetailRow label="Severity">
          <span className="capitalize">{severityGuess} (estimated)</span>
        </DetailRow>
      )}

      {hasProblem && (
        <DetailRow label="Status">
          {data.problem_statement_confirmed ? (
            <span className="text-fm-success font-medium inline-flex items-center gap-1">
              <CheckCircleIcon className="w-3.5 h-3.5" /> Confirmed
            </span>
          ) : (
            <span className="text-fm-warning">Awaiting confirmation</span>
          )}
        </DetailRow>
      )}

      {hasFiles && (
        <>
          <DetailRow
            label="Files"
            expandable
            expanded={filesExpanded}
            onToggle={() => onToggleSection('files')}
          >
            {files.length > 0 ? files.length : uploadedFilesCount} uploaded
          </DetailRow>

          {/* Files drill-down */}
          {filesExpanded && (
            <div className="pl-[84px] pb-0.5">
              {filesLoading && (
                <p className="text-fm-xs text-fm-text-tertiary italic py-1">Loading files...</p>
              )}
              {filesError && (
                <p className="text-fm-xs text-fm-critical py-1">Error: {filesError}</p>
              )}
              {!filesLoading && !filesError && files.length > 0 && (
                <div className="space-y-1">
                  {files.map((file, idx) => (
                    <div key={file.file_id} className="flex items-center gap-2 text-fm-xs text-fm-text-primary">
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
                          title="Jump to turn in conversation"
                        >
                          → T{file.uploaded_at_turn}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!filesLoading && !filesError && files.length === 0 && uploadedFilesCount > 0 && (
                <p className="text-fm-xs text-fm-text-tertiary italic py-1">No files found</p>
              )}
            </div>
          )}
        </>
      )}

      {/* Evidence Details Modal */}
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
