// src/shared/ui/components/InlineError.tsx
import React from 'react';

export interface InlineErrorProps {
  message: string;
  action?: string;
  onRetry?: () => void | Promise<void>;
  className?: string;
}

/**
 * Inline error indicator for failed actions
 * Used within message bubbles, forms, or other UI elements
 */
export const InlineError: React.FC<InlineErrorProps> = ({
  message,
  action,
  onRetry,
  className = ''
}) => {
  return (
    <div
      className={`flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm ${className}`}
      role="alert"
    >
      {/* Error icon */}
      <div className="flex-shrink-0">
        <svg
          className="w-4 h-4 text-red-600 mt-0.5"
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
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-red-800 font-medium">{message}</p>
        {action && <p className="text-red-700 text-xs mt-1">{action}</p>}
      </div>

      {/* Retry button */}
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex-shrink-0 px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200 transition-colors text-xs font-medium"
          aria-label="Retry action"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export default InlineError;
