/**
 * StatusChangeRequestModal Component
 *
 * Confirmation modal for case actions (phase transitions and dispositions).
 */

import React, { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { createLogger } from '../../../../lib/utils/logger';

interface StatusChangeRequestModalProps {
  isOpen: boolean;
  currentStatus: string;
  newStatus: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Agent messages for each case action.
//
const log = createLogger('StatusChangeRequestModal');

// Only `closed` is reachable from the menu, from either phase. `investigating`
// is earned by a confirmed problem statement and `resolved` by a confirmed
// root-cause elimination, so neither is something a user picks and neither
// needs copy here. (``investigating`` is refused by every backend since #1608; ``resolved`` is refused from contract 9.0.0, which this repo has not pinned yet (``api-contract.pin.json``). Hiding both is safe against a backend that still accepts them, which is why the client change lands first.)
const CASE_ACTION_MESSAGES: Record<string, Record<string, string>> = {
  inquiry: {
    closed: "Close this case. I don't need further investigation."
  },
  investigating: {
    closed: "Close this case as unresolved. Summarize what we found so far."
  }
};

// User-friendly titles for each case action
const ACTION_TITLES: Record<string, Record<string, string>> = {
  inquiry: {
    closed: "Close case without investigating?"
  },
  investigating: {
    closed: "Close case as unresolved?"
  }
};

export const StatusChangeRequestModal: React.FC<StatusChangeRequestModalProps> = ({
  isOpen,
  currentStatus,
  newStatus,
  onConfirm,
  onCancel
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Accessibility: trap focus, lock body scroll, close on Escape while open.
  useFocusTrap({ isActive: isOpen, containerRef: modalRef, onEscape: onCancel });

  if (!isOpen) return null;

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      inquiry: 'Inquiry',
      investigating: 'Investigating',
      resolved: 'Resolved',
      closed: 'Closed'
    };
    return labels[status] || status;
  };

  const message = CASE_ACTION_MESSAGES[currentStatus]?.[newStatus];

  const getTitle = () => {
    return ACTION_TITLES[currentStatus]?.[newStatus] || 'Perform case action?';
  };

  const isDisposition = newStatus === 'resolved' || newStatus === 'closed';

  // ‼ FAIL CLOSED on a pair this modal has no copy for. It used to fall back
  // to `''`, which rendered a highlighted block containing a literal empty
  // quote under "Your request will be sent to the agent:", beneath a generic
  // "Perform case action?" title — and left Continue live. The submit it
  // leads to is dropped by `ChatWindow` for exactly the same reason (no
  // message to send), so the user watched a modal close and nothing happen.
  //
  // Every other layer already refuses an unmapped pair — `getCaseActionOptions`
  // does not offer it, `ChatWindow` returns without sending. This was the one
  // layer that rendered an empty promise, and the pairs it lacks copy for are
  // precisely the ones no longer reachable on purpose (`investigating` since
  // #1608, `resolved` since this change).
  if (!message) {
    log.error('StatusChangeRequestModal: no copy for case action', {
      currentStatus,
      newStatus,
    });
    return null;
  }

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-change-modal-title"
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 focus:outline-none"
    >
      <div className="bg-fm-surface rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 id="status-change-modal-title" className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          {getTitle()}
        </h3>

        <div className="mb-6 text-sm text-fm-text-primary space-y-3">
          <p>
            Your request will be sent to the agent:
          </p>

          <div className="bg-fm-accent-soft border-l-4 border-blue-400 p-3 rounded">
            <p className="text-sm text-fm-text-primary italic">
              {`"${message}"`}
            </p>
          </div>

          <p>
            The agent will be asked to transition from{' '}
            <strong>{getStatusLabel(currentStatus)}</strong> to{' '}
            <strong>{getStatusLabel(newStatus)}</strong>.
          </p>

          {isDisposition && (
            <p className="text-fm-warning bg-fm-warning-bg/50 border border-fm-warning-border p-2 rounded text-xs">
              {getStatusLabel(newStatus)} is a terminal disposition. The case cannot be reopened from the UI.
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-fm-elevated text-fm-text-primary rounded hover:bg-fm-elevated transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-fm-accent text-white rounded hover:opacity-90 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
