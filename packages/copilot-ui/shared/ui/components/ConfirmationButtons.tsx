import React from 'react';

interface ConfirmationButtonsProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Renders Yes/No confirmation buttons for agent prompts
 * Displays below the agent message with tip text
 */
export const ConfirmationButtons: React.FC<ConfirmationButtonsProps> = ({
  onConfirm,
  onCancel
}) => {
  return (
    <div className="mt-3 border-t border-fm-border pt-3">
      <div className="flex gap-2 mb-2">
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium text-sm flex items-center gap-1.5"
        >
          <span>✅</span>
          <span>Yes</span>
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium text-sm flex items-center gap-1.5"
        >
          <span>❌</span>
          <span>No</span>
        </button>
      </div>
      <p className="text-xs text-fm-text-tertiary italic">
        💡 Tip: Click a button or type to clarify
      </p>
    </div>
  );
};
