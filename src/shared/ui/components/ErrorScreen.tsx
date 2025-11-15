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
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center max-w-md p-8">
        <svg
          className="w-16 h-16 text-red-500 mx-auto mb-4"
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
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Connection Error
        </h2>
        <p className="text-gray-600 mb-6">{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
