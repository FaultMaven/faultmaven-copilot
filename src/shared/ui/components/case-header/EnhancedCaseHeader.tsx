/**
 * EnhancedCaseHeader Component
 *
 * Main wrapper for case header with expand/collapse functionality
 * Routes to phase-specific detail components based on case status
 */

import React, { useState } from 'react';
import type { CaseUIResponse, UploadedFileMetadata } from '../../../../types/case';
import { isCaseInquiry, isCaseInvestigating, isCaseResolved } from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';
import { HeaderSummary } from './HeaderSummary';
import { InquiryDetails } from './InquiryDetails';
import { InvestigatingDetails } from './InvestigatingDetails';
import { ResolvedDetails } from './ResolvedDetails';
import { StatusChangeRequestModal } from './StatusChangeRequestModal';

interface EnhancedCaseHeaderProps {
  caseData: CaseUIResponse | null;
  loading?: boolean;
  error?: string | null;
  initialExpanded?: boolean;
  onStatusChangeRequest?: (newStatus: UserCaseStatus) => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const EnhancedCaseHeader: React.FC<EnhancedCaseHeaderProps> = ({
  caseData,
  loading = false,
  error = null,
  initialExpanded = true,
  onStatusChangeRequest,
  onScrollToTurn,
}) => {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [requestedStatus, setRequestedStatus] = useState<UserCaseStatus | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [isSubmittingStatusChange, setIsSubmittingStatusChange] = useState(false);

  if (loading) {
    return (
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-b border-red-200 p-4">
        <p className="text-sm text-red-600">Error loading case: {error}</p>
      </div>
    );
  }

  // If no data yet (shouldn't happen if loading/error handled above, but be safe)
  if (!caseData) {
    return (
      <div className="bg-white border-b border-gray-200 p-4">
        <p className="text-sm text-gray-500">No case data available</p>
      </div>
    );
  }

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const handleStatusChangeRequest = (newStatus: UserCaseStatus) => {
    // Prevent multiple status change requests while one is in progress
    if (isSubmittingStatusChange) {
      return;
    }
    setRequestedStatus(newStatus);
    setShowStatusModal(true);
  };

  const handleConfirmStatusChange = () => {
    if (requestedStatus && onStatusChangeRequest && !isSubmittingStatusChange) {
      setIsSubmittingStatusChange(true);
      onStatusChangeRequest(requestedStatus);
      setShowStatusModal(false);
      setRequestedStatus(null);

      // Reset after a short delay to allow the request to complete
      setTimeout(() => setIsSubmittingStatusChange(false), 3000);
    }
  };

  const handleCancelStatusChange = () => {
    setShowStatusModal(false);
    setRequestedStatus(null);
  };

  return (
    <>
      <div className="bg-white border-b border-gray-300">
        {/* Collapsed Summary */}
        <HeaderSummary
          caseData={caseData}
          expanded={expanded}
          onToggle={handleToggle}
          onStatusChangeRequest={handleStatusChangeRequest}
        />

        {/* Expanded Details (phase-specific) */}
        {expanded && renderDetails(caseData, showFiles, setShowFiles, onScrollToTurn)}
      </div>

      {/* Status Change Request Modal */}
      {caseData && requestedStatus && (
        <StatusChangeRequestModal
          isOpen={showStatusModal}
          currentStatus={caseData.status}
          newStatus={requestedStatus}
          onConfirm={handleConfirmStatusChange}
          onCancel={handleCancelStatusChange}
        />
      )}
    </>
  );
};

function renderDetails(
  caseData: CaseUIResponse,
  showFiles: boolean,
  setShowFiles: (show: boolean) => void,
  onScrollToTurn?: (turnNumber: number) => void
): React.ReactNode {
  if (isCaseInquiry(caseData)) {
    return (
      <InquiryDetails
        data={caseData.inquiry}
        caseId={caseData.case_id}
        uploadedFilesCount={'uploaded_files_count' in caseData ? caseData.uploaded_files_count : 0}
        showFiles={showFiles}
        onToggleFiles={() => setShowFiles(!showFiles)}
        onScrollToTurn={onScrollToTurn}
      />
    );
  }

  if (isCaseInvestigating(caseData)) {
    return (
      <InvestigatingDetails
        data={caseData}
        caseId={caseData.case_id}
      />
    );
  }

  if (isCaseResolved(caseData)) {
    return (
      <ResolvedDetails
        data={caseData}
        caseId={caseData.case_id}
      />
    );
  }

  return null;
}
