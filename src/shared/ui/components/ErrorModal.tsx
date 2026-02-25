// src/shared/ui/components/ErrorModal.tsx
import React, { useEffect, useRef, useCallback } from 'react';
import { ActiveError } from '../../../lib/errors/useErrorHandler';

interface ErrorModalProps {
  activeError: ActiveError | null;
  onAction?: (id: string) => void | Promise<void>;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({ activeError, onAction }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Stable dismiss handler
  const handleDismiss = useCallback(() => {
    if (activeError && activeError.displayOptions.dismissible && onAction) {
      onAction(activeError.id);
    }
  }, [activeError, onAction]);

  // Focus management for accessibility
  useEffect(() => {
    if (activeError) {
      // Save current focus
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the modal
      modalRef.current?.focus();

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      return () => {
        // Restore scroll
        document.body.style.overflow = '';

        // Restore focus (only if element still exists in DOM)
        if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
          previousActiveElement.current.focus();
        }

        // Clear ref to prevent memory leak
        previousActiveElement.current = null;
      };
    }
  }, [activeError]);

  // Handle keyboard events
  useEffect(() => {
    if (!activeError) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Trap focus within modal
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }

      // ESC key only works if modal is dismissible
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeError, handleDismiss]);

  if (!activeError) return null;

  const { error, displayOptions, id } = activeError;

  const handleAction = async () => {
    if (onAction) {
      await onAction(id);
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

  const getIconColor = () => {
    const icon = displayOptions.icon || 'error';
    switch (icon) {
      case 'error':
        return 'text-fm-critical';
      case 'warning':
        return 'text-yellow-600';
      case 'info':
        return 'text-fm-accent';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
      aria-describedby="error-modal-description"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={displayOptions.blocking ? undefined : handleDismiss}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative bg-fm-surface rounded-lg shadow-xl max-w-md w-full mx-4 p-6 transform transition-all"
      >
        {/* Icon */}
        <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-fm-surface rounded-full">
          <svg className={`w-6 h-6 ${getIconColor()}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={getIconPath()} />
          </svg>
        </div>

        {/* Content */}
        <div className="text-center">
          <h3 id="error-modal-title" className="text-lg font-semibold text-white mb-2">
            {error.userTitle}
          </h3>
          <p id="error-modal-description" className="text-sm text-fm-text-tertiary mb-2">
            {error.userMessage}
          </p>
          <p className="text-sm text-fm-text-tertiary">
            {error.userAction}
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2">
          {displayOptions.actions && displayOptions.actions.length > 0 ? (
            displayOptions.actions.map((action, idx) => (
              <button
                key={idx}
                onClick={async () => {
                  // Call the action's onClick if provided, otherwise call the modal's onAction
                  if (action.onClick && typeof action.onClick === 'function') {
                    await action.onClick();
                  }
                  // Always call the modal's onAction to handle dismissal
                  if (onAction) {
                    await onAction(id);
                  }
                }}
                className={`
                  w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors
                  ${action.primary
                    ? 'bg-fm-accent text-white hover:opacity-90 focus:ring-2 focus:ring-fm-accent focus:ring-offset-2'
                    : 'bg-fm-surface text-fm-text-primary hover:bg-fm-elevated focus:ring-2 focus:ring-fm-accent focus:ring-offset-2'
                  }
                `}
                autoFocus={idx === 0}
              >
                {action.label}
              </button>
            ))
          ) : (
            <button
              onClick={handleAction}
              className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              autoFocus
            >
              OK
            </button>
          )}

          {displayOptions.dismissible && !displayOptions.blocking && (
            <button
              onClick={handleDismiss}
              className="w-full px-4 py-2 text-sm font-medium text-fm-text-tertiary hover:text-fm-text-primary transition-colors"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Close button (only if dismissible and not blocking) */}
        {displayOptions.dismissible && !displayOptions.blocking && (
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-fm-text-secondary hover:text-fm-text-primary transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorModal;
