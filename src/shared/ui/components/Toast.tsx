// src/shared/ui/components/Toast.tsx
import React, { useEffect, useState, memo, useCallback } from 'react';
import { ActiveError } from '../../../lib/errors/useErrorHandler';

interface ToastProps {
  activeError: ActiveError;
  onDismiss: (id: string) => void;
  onRetry?: (id: string) => Promise<void>;
}

const Toast: React.FC<ToastProps> = memo(({ activeError, onDismiss, onRetry }) => {
  const [isExiting, setIsExiting] = useState(false);
  const { error, displayOptions, id } = activeError;

  // Check for reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(id);
    }, prefersReducedMotion ? 0 : 300); // Skip animation if user prefers reduced motion
  }, [id, onDismiss, prefersReducedMotion]);

  const handleRetry = async () => {
    if (onRetry) {
      try {
        await onRetry(id);
        handleDismiss();
      } catch (retryError) {
        console.error('[Toast] Retry failed:', retryError);
      }
    }
  };

  const getIconPath = () => {
    const icon = displayOptions.icon || 'error';
    switch (icon) {
      case 'error':
        return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'warning':
        return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z';
      case 'info':
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
    }
  };

  const getColorClasses = () => {
    const icon = displayOptions.icon || 'error';
    switch (icon) {
      case 'error':
        return {
          bg: 'bg-fm-critical-bg',
          border: 'border-fm-critical-border',
          icon: 'text-fm-critical',
          title: 'text-fm-critical',
          message: 'text-fm-critical',
          button: 'bg-fm-critical-bg text-fm-critical hover:bg-fm-surface'
        };
      case 'warning':
        return {
          bg: 'bg-fm-warning-bg',
          border: 'border-fm-warning-border',
          icon: 'text-fm-warning',
          title: 'text-fm-warning',
          message: 'text-fm-warning',
          button: 'bg-fm-warning-bg text-fm-warning hover:bg-fm-surface'
        };
      case 'info':
        return {
          bg: 'bg-fm-accent-soft',
          border: 'border-fm-accent-border',
          icon: 'text-fm-accent',
          title: 'text-fm-accent',
          message: 'text-fm-accent',
          button: 'bg-fm-accent-soft text-fm-accent hover:bg-fm-surface'
        };
    }
  };

  const colors = getColorClasses();

  // Check if this error has a retry action
  const hasRetryAction = displayOptions.actions?.some(action => action.label === 'Retry');

  return (
    <div
      className={`
        ${colors.bg} ${colors.border} border rounded-lg shadow-lg p-4 mb-3
        transition-all duration-300 ease-in-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <svg className={`w-5 h-5 ${colors.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={getIconPath()} />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-medium ${colors.title}`}>{error.userTitle}</h3>
          <p className={`text-xs ${colors.message} mt-1`}>{error.userMessage}</p>
          <p className={`text-xs ${colors.message} mt-1 opacity-90`}>{error.userAction}</p>

          {/* Action buttons */}
          {(hasRetryAction || displayOptions.actions) && (
            <div className="mt-3 flex items-center gap-2">
              {hasRetryAction && onRetry && (
                <button
                  onClick={handleRetry}
                  className={`px-3 py-1 text-xs rounded font-medium transition-colors ${colors.button}`}
                >
                  Retry
                </button>
              )}
              {displayOptions.actions?.filter(a => a.label !== 'Retry').map((action, idx) => (
                <button
                  key={idx}
                  onClick={action.onClick}
                  className={`px-3 py-1 text-xs rounded font-medium transition-colors ${colors.button}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dismiss button */}
        {displayOptions.dismissible !== false && (
          <button
            onClick={handleDismiss}
            className={`flex-shrink-0 ${colors.icon} hover:opacity-70 transition-opacity`}
            aria-label="Dismiss notification"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});

Toast.displayName = 'Toast';

interface ToastContainerProps {
  activeErrors: ActiveError[];
  onDismiss: (id: string) => void;
  onRetry?: (id: string) => Promise<void>;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  activeErrors,
  onDismiss,
  onRetry,
  position = 'top-right'
}) => {
  const getPositionClasses = () => {
    switch (position) {
      case 'top-right':
        return 'top-4 right-4';
      case 'top-left':
        return 'top-4 left-4';
      case 'bottom-right':
        return 'bottom-4 right-4';
      case 'bottom-left':
        return 'bottom-4 left-4';
    }
  };

  if (activeErrors.length === 0) return null;

  return (
    <div
      className={`fixed ${getPositionClasses()} z-50 w-full max-w-sm pointer-events-none`}
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="pointer-events-auto">
        {activeErrors.map((activeError) => (
          <Toast
            key={activeError.id}
            activeError={activeError}
            onDismiss={onDismiss}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
};

export default Toast;
