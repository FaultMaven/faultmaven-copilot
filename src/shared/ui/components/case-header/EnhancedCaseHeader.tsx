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
      <div className="bg-fm-surface border-b border-fm-border p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-fm-elevated rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-fm-elevated rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-fm-red-light border-b border-fm-border p-4">
        <p className="text-sm text-fm-red">Error loading case: {error}</p>
      </div>
    );
  }

  // If no data yet (shouldn't happen if loading/error handled above, but be safe)
  if (!caseData) {
    return (
      <div className="bg-fm-surface border-b border-fm-border p-4">
        <p className="text-sm text-fm-dim">No case data available</p>
      </div>
    );
  }

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const handleStatusChangeRequest = (newStatus: UserCaseStatus) => {
    console.log('[EnhancedCaseHeader] handleStatusChangeRequest called', {
      newStatus,
      isSubmittingStatusChange,
      hasParentCallback: !!onStatusChangeRequest
    });

    // Prevent multiple status change requests while one is in progress
    if (isSubmittingStatusChange) {
      console.log('[EnhancedCaseHeader] Blocked: already submitting');
      return;
    }
    setRequestedStatus(newStatus);
    setShowStatusModal(true);
    console.log('[EnhancedCaseHeader] Modal opened for status:', newStatus);
  };

  const handleConfirmStatusChange = () => {
    console.log('[EnhancedCaseHeader] handleConfirmStatusChange called', {
      requestedStatus,
      hasCallback: !!onStatusChangeRequest,
      isSubmittingStatusChange
    });

    if (requestedStatus && onStatusChangeRequest && !isSubmittingStatusChange) {
      console.log('[EnhancedCaseHeader] Calling parent onStatusChangeRequest', { requestedStatus });
      setIsSubmittingStatusChange(true);
      onStatusChangeRequest(requestedStatus);
      setShowStatusModal(false);
      setRequestedStatus(null);

      // Reset after a short delay to allow the request to complete
      setTimeout(() => setIsSubmittingStatusChange(false), 3000);
    } else {
      console.log('[EnhancedCaseHeader] NOT calling parent callback', {
        noRequestedStatus: !requestedStatus,
        noCallback: !onStatusChangeRequest,
        isSubmitting: isSubmittingStatusChange
      });
    }
  };

  const handleCancelStatusChange = () => {
    setShowStatusModal(false);
    setRequestedStatus(null);
  };

  return (
    <>
      <div className="bg-fm-surface border-b border-fm-border">
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
