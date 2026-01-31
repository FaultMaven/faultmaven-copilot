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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          Request Status Change
        </h3>

        <div className="mb-6 text-sm text-gray-700 space-y-3">
          <p>
            This will ask the agent to transition the case from{' '}
            <strong>{getStatusLabel(currentStatus)}</strong> to{' '}
            <strong>{getStatusLabel(newStatus)}</strong>.
          </p>

          <p className="text-gray-600">
            The agent will validate the transition and ask for your confirmation.
          </p>
        </div>

        <p className="mb-6 text-sm text-gray-900">
          Are you sure you want to proceed?
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
