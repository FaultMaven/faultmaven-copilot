import React from "react";

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  title?: string;
}

export function ErrorState({ message, onRetry, title = "An Error Occurred" }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-fm-border rounded-lg bg-fm-bg">
      {/* Warning Icon */}
      <div className="w-12 h-12 text-yellow-500 mb-4">
        <svg
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </div>

      {/* Error Title */}
      <h3 className="text-lg font-semibold text-fm-text mb-2">{title}</h3>

      {/* Error Message */}
      <p className="text-sm text-fm-dim text-center max-w-sm mb-6">{message}</p>

      {/* Retry Button */}
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-fm-blue text-white text-sm font-medium rounded-md hover:bg-fm-active transition-colors focus:outline-none focus:ring-2 focus:ring-fm-blue focus:ring-offset-2"
      >
        Retry
      </button>
    </div>
  );
} 