/**
 * ConsultingDetails Component
 *
 * Expanded header content for CONSULTING phase
 * Shows: Problem statement draft, confirmation status, severity estimate
 * Design based on: ui-mockups-text-diagrams.md lines 88-107
 */

import React, { useState, useEffect } from 'react';
import type { ConsultingData, UploadedFileMetadata, UploadedFileDetailsResponse } from '../../../../types/case';
import { filesApi } from '../../../../lib/api/files-service';
import { EvidenceDetailsModal } from './EvidenceDetailsModal';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('ConsultingDetails');

/**
 * Extended UploadedFileMetadata with evidence_count
 * Note: Backend schema missing this field - will be added in future API update
 */
interface UploadedFileWithEvidence extends UploadedFileMetadata {
  evidence_count?: number;
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface ConsultingDetailsProps {
  data: ConsultingData;
  caseId: string;
  uploadedFilesCount: number;
  showFiles: boolean;
  onToggleFiles: () => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const ConsultingDetails: React.FC<ConsultingDetailsProps> = ({
  data,
  caseId,
  uploadedFilesCount,
  showFiles,
  onToggleFiles,
  onScrollToTurn,
}) => {
  const [files, setFiles] = useState<UploadedFileWithEvidence[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedFileForEvidence, setSelectedFileForEvidence] = useState<string | null>(null);
  const [evidenceDetails, setEvidenceDetails] = useState<UploadedFileDetailsResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  // Fetch files when files section is expanded
  useEffect(() => {
    if (showFiles && files.length === 0) {
      const fetchFiles = async () => {
        log.debug(' 📂 Fetching files for case:', caseId);
        setFilesLoading(true);
        setFilesError(null);
        try {
          const fetchedFiles = await filesApi.getUploadedFiles(caseId);
          log.debug(' ✅ Files fetched:', fetchedFiles);
          log.debug(' ✅ Files array length:', Array.isArray(fetchedFiles) ? fetchedFiles.length : 'NOT AN ARRAY');
          setFiles(fetchedFiles);
        } catch (error) {
          console.error('[ConsultingDetails] ❌ Failed to fetch files:', error);
          setFilesError(error instanceof Error ? error.message : 'Failed to load files');
        } finally {
          setFilesLoading(false);
        }
      };
      fetchFiles();
    }
  }, [showFiles, caseId, files.length]);

  // Handler to show evidence details for a file
  const handleShowEvidence = async (fileId: string) => {
    setSelectedFileForEvidence(fileId);
    setEvidenceLoading(true);
    try {
      const details = await filesApi.getUploadedFileDetails(caseId, fileId);
      setEvidenceDetails(details);
    } catch (error) {
      console.error('[ConsultingDetails] Failed to fetch evidence details:', error);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handleCloseEvidence = () => {
    setSelectedFileForEvidence(null);
    setEvidenceDetails(null);
  };

  // Defensive: Handle null consulting data for brand new cases (current_turn: 0)
  // This is non-critical - user can still chat and interact normally
  // Backend should fix: case_ui_adapter.py _transform_consulting() to always return valid object
  if (!data) {
    console.warn('[ConsultingDetails] Backend sent null consulting data - API contract violation. Case still functional.');
    return (
      <div className="px-4 pb-4 space-y-3 text-sm text-gray-600">
        <p className="italic">Consultation starting - problem statement will appear after first interaction.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Problem Statement (Draft) */}
      {data.proposed_problem_statement && (
        <div>
          <h4 className="font-medium text-sm text-gray-700 mb-1">
            Problem Statement (Draft):
          </h4>
          <p className="text-sm text-gray-900">
            "{data.proposed_problem_statement}"
          </p>
        </div>
      )}

      {/* Status: Only show if problem has been proposed */}
      {data.proposed_problem_statement && (
        <div className="text-sm">
          <span className="text-gray-700">Status: </span>
          {data.problem_statement_confirmed ? (
            <span className="text-green-600 font-medium">✓ Problem confirmed</span>
          ) : (
            <span className="text-orange-600">⏳ Awaiting your confirmation</span>
          )}
        </div>
      )}

      {/* Estimated Severity */}
      {data.problem_confirmation?.severity_guess && (
        <div className="text-sm">
          <span className="text-gray-700">Estimated Severity: </span>
          <span className="font-medium capitalize">{data.problem_confirmation.severity_guess}</span>
        </div>
      )}

      {/* Files Section - Show if backend reports files OR if we fetched files */}
      {(uploadedFilesCount > 0 || files.length > 0) && (
        <>
          {/* Separator - only if there's content above */}
          {(data.proposed_problem_statement || data.problem_confirmation?.severity_guess) && (
            <div className="border-t border-gray-300 my-3"></div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={onToggleFiles}
              className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-2 flex-1"
            >
              <span className="font-medium">📎 Uploaded Files ({files.length > 0 ? files.length : uploadedFilesCount})</span>
            </button>
            <button
              onClick={onToggleFiles}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              [{showFiles ? '▲ Hide' : '▼ Show'}]
            </button>
          </div>

          {/* Files List (when expanded) */}
          {showFiles && (
            <>
              {/* Separator for expanded files section */}
              <div className="border-t border-gray-300 my-3"></div>

              <div className="space-y-3">
                {filesLoading && (
                  <p className="text-sm text-gray-500 italic">Loading files...</p>
                )}

                {filesError && (
                  <p className="text-sm text-red-600">Error: {filesError}</p>
                )}

                {!filesLoading && !filesError && files.length > 0 && (
                  <div className="space-y-3">
                    {files.map((file) => (
                      <div key={file.file_id} className="text-sm">
                        <div className="font-medium text-gray-900">
                          📄 {file.filename} · {formatFileSize(file.size_bytes)} · {onScrollToTurn ? (
                            <button
                              onClick={() => onScrollToTurn(file.uploaded_at_turn)}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                              title="Jump to turn in conversation"
                            >
                              Turn {file.uploaded_at_turn}
                            </button>
                          ) : (
                            <span>Turn {file.uploaded_at_turn}</span>
                          )}
                        </div>

                        {/* Evidence count - only show if file has derived evidence */}
                        {file.evidence_count !== undefined && file.evidence_count > 0 && (
                          <button
                            onClick={() => handleShowEvidence(file.file_id)}
                            className="text-xs text-green-600 hover:text-green-800 hover:underline mt-1 ml-5 block"
                            title="View evidence derived from this file"
                          >
                            ✓ Referenced in {file.evidence_count} evidence item{file.evidence_count > 1 ? 's' : ''}
                          </button>
                        )}

                        {file.summary && (
                          <div className="text-xs text-gray-700 mt-1 ml-5 italic">
                            {file.summary}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!filesLoading && !filesError && files.length === 0 && uploadedFilesCount > 0 && (
                  <p className="text-sm text-gray-500 italic">No files found</p>
                )}
              </div>
            </>
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
