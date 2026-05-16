/**
 * EnhancedCaseHeader Component
 *
 * Main wrapper for the case header. Composes the always-visible two-row
 * summary (HeaderSummary) with the expandable unified detail view
 * (CaseDetails) and the status-change confirmation modal. Manages
 * drill-down section state (accordion — one open section at a time).
 */

import React, { useState } from 'react';
import type { CaseUIResponse, UserCase } from '../../../../types/case';
import type { UserCaseStatus } from '../../../../lib/api';
import { HeaderSummary } from './HeaderSummary';
import { CaseDetails } from './CaseDetails';
import { StatusChangeRequestModal } from './StatusChangeRequestModal';
import { getSeverity } from './shared';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('EnhancedCaseHeader');

interface EnhancedCaseHeaderProps {
  caseData: CaseUIResponse | null;
  activeCase?: UserCase | null;
  loading?: boolean;
  error?: string | null;
  initialExpanded?: boolean;
  onStatusChangeRequest?: (newStatus: UserCaseStatus) => void;
  onScrollToTurn?: (turnNumber: number) => void;
}

export const EnhancedCaseHeader: React.FC<EnhancedCaseHeaderProps> = ({
  caseData,
  activeCase,
  loading = false,
  error = null,
  initialExpanded = true,
  onStatusChangeRequest,
  onScrollToTurn,
}) => {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [requestedStatus, setRequestedStatus] = useState<UserCaseStatus | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isSubmittingStatusChange, setIsSubmittingStatusChange] = useState(false);

  if (loading) {
    return (
      <div className="bg-fm-surface-alt border-b border-fm-border-strong p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-fm-elevated rounded w-3/4 mb-2"></div>
          <div className="h-3 bg-fm-elevated rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-fm-critical-bg border-b border-fm-critical-border p-4">
        <p className="text-sm text-fm-critical">Error loading case: {error}</p>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="bg-fm-surface-alt border-b border-fm-border-strong p-4">
        <p className="text-sm text-fm-text-tertiary">No case data available</p>
      </div>
    );
  }

  const severity = getSeverity(activeCase, caseData);

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const handleToggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const handleScrollToTurn = onScrollToTurn
    ? (turnNumber: number) => {
      setExpanded(false);
      onScrollToTurn(turnNumber);
    }
    : undefined;

  const handleStatusChangeRequest = (newStatus: UserCaseStatus) => {
    log.debug('handleStatusChangeRequest called', {
      newStatus,
      isSubmittingStatusChange,
      hasParentCallback: !!onStatusChangeRequest
    });

    if (isSubmittingStatusChange) {
      log.debug('Blocked: already submitting');
      return;
    }
    setRequestedStatus(newStatus);
    setShowStatusModal(true);
  };

  const handleConfirmStatusChange = () => {
    log.debug('handleConfirmStatusChange called', {
      requestedStatus,
      hasCallback: !!onStatusChangeRequest,
      isSubmittingStatusChange
    });

    if (requestedStatus && onStatusChangeRequest && !isSubmittingStatusChange) {
      log.debug('Calling parent onStatusChangeRequest', { requestedStatus });
      setIsSubmittingStatusChange(true);
      onStatusChangeRequest(requestedStatus);
      setShowStatusModal(false);
      setRequestedStatus(null);

      // Reset after a short delay to allow the request to complete
      setTimeout(() => setIsSubmittingStatusChange(false), 3000);
    } else {
      log.debug('NOT calling parent callback', {
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
      <div className="bg-fm-surface-alt border-b border-fm-border-strong">
        {/* Collapsed Summary */}
        <HeaderSummary
          caseData={caseData}
          activeCase={activeCase}
          expanded={expanded}
          severity={severity}
          onToggle={handleToggle}
          onStatusChangeRequest={handleStatusChangeRequest}
        />

        {/* Expanded Details — unified across all phases */}
        {expanded && (
          <div className="border-t border-fm-border">
            <CaseDetails
              caseData={caseData}
              activeCase={activeCase ?? null}
              expandedSection={expandedSection}
              onToggleSection={handleToggleSection}
              onScrollToTurn={handleScrollToTurn}
            />
          </div>
        )}
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
