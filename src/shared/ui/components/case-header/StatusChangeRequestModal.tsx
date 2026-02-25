/**
 * StatusChangeRequestModal Component
 *
 * Confirmation modal for manual status change requests
 */

import React from 'react';

interface StatusChangeRequestModalProps {
  isOpen: boolean;
  currentStatus: string;
  newStatus: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Status transition messages that will be sent to the agent
const STATUS_MESSAGES: Record<string, Record<string, string>> = {
  inquiry: {
    investigating: "I want to start a formal investigation to find the root cause.",
    closed: "Close this case. I don't need further investigation."
  },
  investigating: {
    resolved: "The issue is resolved. Generate final documentation with root cause and solution.",
    closed: "Close this case as unresolved. Summarize what we found so far."
  }
};

// User-friendly titles for each transition
const TRANSITION_TITLES: Record<string, Record<string, string>> = {
  inquiry: {
    investigating: "Start formal investigation?",
    closed: "Close case without investigating?"
  },
  investigating: {
    resolved: "Mark case as resolved?",
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

  const getMessage = () => {
    return STATUS_MESSAGES[currentStatus]?.[newStatus] || '';
  };

  const getTitle = () => {
    return TRANSITION_TITLES[currentStatus]?.[newStatus] || 'Change case status?';
  };

  const isTerminalState = newStatus === 'resolved' || newStatus === 'closed';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-fm-surface rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          {getTitle()}
        </h3>

        <div className="mb-6 text-sm text-fm-text-primary space-y-3">
          <p>
            Your request will be sent to the agent:
          </p>

          <div className="bg-fm-accent-soft border-l-4 border-blue-400 p-3 rounded">
            <p className="text-sm text-fm-text-primary italic">
              "{getMessage()}"
            </p>
          </div>

          <p>
            The case status will change immediately from{' '}
            <strong>{getStatusLabel(currentStatus)}</strong> to{' '}
            <strong>{getStatusLabel(newStatus)}</strong>.
          </p>

          {isTerminalState && (
            <p className="text-amber-700 bg-amber-50 p-2 rounded text-xs">
              ⚠️ {getStatusLabel(newStatus)} is a terminal state. The case cannot be reopened from the UI.
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
