import React from 'react';

interface ErrorScreenProps {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ErrorScreen({ message, action }: ErrorScreenProps) {
  return (
    <div className="flex items-center justify-center h-screen bg-fm-bg">
      <div className="text-center max-w-md p-8">
        <svg
          className="w-16 h-16 text-fm-red mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h2 className="text-xl font-semibold text-fm-text mb-2">
          Connection Error
        </h2>
        <p className="text-fm-dim mb-6">{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="px-6 py-2 bg-fm-blue text-white rounded-lg hover:bg-fm-active transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
