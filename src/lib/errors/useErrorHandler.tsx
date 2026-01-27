// src/lib/errors/useErrorHandler.tsx

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ErrorClassifier } from './classifier';
import {
  UserFacingError,
  ErrorContext,
  ErrorDisplayOptions,
} from './types';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('ErrorHandler');

/**
 * Active error with display options and unique ID
 */
export interface ActiveError {
  id: string;
  error: UserFacingError;
  displayOptions: ErrorDisplayOptions;
  timestamp: number;
  dismissed: boolean;
}

/**
 * Error handler context value
 */
interface ErrorHandlerContextValue {
  /** Active errors to display */
  errors: ActiveError[];

  /** Show an error */
  showError: (error: unknown, context?: ErrorContext) => string;

  /** Dismiss an error by ID */
  dismissError: (errorId: string) => void;

  /** Dismiss all errors */
  dismissAll: () => void;

  /** Get errors by display type */
  getErrorsByType: (displayType: 'toast' | 'inline' | 'modal' | 'banner') => ActiveError[];

  /** Check if error is currently shown */
  hasError: (errorId: string) => boolean;

  /** Set retry action for an error */
  setRetryAction: (errorId: string, retryFn: () => Promise<void>) => void;
}

const ErrorHandlerContext = createContext<ErrorHandlerContextValue | null>(null);

/**
 * Provider component for error handling
 */
export const ErrorHandlerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<ActiveError[]>([]);
  const [retryActions, setRetryActions] = useState<Map<string, () => Promise<void>>>(new Map());
  const [timeoutIds, setTimeoutIds] = useState<Map<string, NodeJS.Timeout>>(new Map());
  const [dismissalTimeouts, setDismissalTimeouts] = useState<Map<string, NodeJS.Timeout>>(new Map());

  // Refs to store latest callbacks (prevent stale closures in timeouts)
  const dismissErrorRef = useRef<((errorId: string) => void) | null>(null);

  // Maximum number of simultaneous toast notifications
  const MAX_TOASTS = 3;

  /**
   * Show an error with appropriate UI
   */
  const showError = useCallback((error: unknown, context?: ErrorContext): string => {
    // Classify the error
    const userFacingError = ErrorClassifier.classify(error, context);

    // Get display options
    const displayOptions = (userFacingError as any).getDisplayOptions?.() || {
      displayType: 'toast' as const,
      duration: 5000,
      dismissible: true,
      icon: 'error' as const
    };

    // Check if we should aggregate with existing errors
    const existingErrors = errors.filter(e => !e.dismissed && e.displayOptions.displayType === displayOptions.displayType);
    const shouldAggregate = existingErrors.some(existing =>
      ErrorClassifier.shouldAggregate(existing.error, userFacingError)
    );

    if (shouldAggregate) {
      // Don't add duplicate error, just return existing ID
      const existing = existingErrors.find(e =>
        ErrorClassifier.shouldAggregate(e.error, userFacingError)
      );
      log.debug('Aggregating similar error, not showing duplicate');
      return existing?.id || '';
    }

    // Generate unique ID
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create active error
    const activeError: ActiveError = {
      id: errorId,
      error: userFacingError,
      displayOptions,
      timestamp: Date.now(),
      dismissed: false
    };

    setErrors(prev => {
      const newErrors = [...prev, activeError];

      // Limit toast notifications to MAX_TOASTS
      if (displayOptions.displayType === 'toast') {
        const toasts = newErrors.filter(e => e.displayOptions.displayType === 'toast' && !e.dismissed);
        if (toasts.length > MAX_TOASTS) {
          // Dismiss oldest toast
          const oldestToast = toasts[0];
          return newErrors.map(e =>
            e.id === oldestToast.id ? { ...e, dismissed: true } : e
          );
        }
      }

      return newErrors;
    });

    // Log error for debugging
    console.error('[ErrorHandler] Error shown:', {
      id: errorId,
      category: userFacingError.category,
      userTitle: userFacingError.userTitle,
      displayType: displayOptions.displayType,
      originalError: userFacingError.originalError,
      context: userFacingError.context
    });

    return errorId;
  }, []);

  /**
   * Dismiss an error
   */
  const dismissError = useCallback((errorId: string) => {
    // Clear any pending auto-dismiss timeout
    setTimeoutIds(prev => {
      const timeoutId = prev.get(errorId);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const next = new Map(prev);
      next.delete(errorId);
      return next;
    });

    // Clear existing dismissal timeout if any (prevents race condition)
    setDismissalTimeouts(prev => {
      const existingTimeout = prev.get(errorId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const next = new Map(prev);
      next.delete(errorId);
      return next;
    });

    setErrors(prev => prev.map(e =>
      e.id === errorId ? { ...e, dismissed: true } : e
    ));

    // Clean up retry action
    setRetryActions(prev => {
      const next = new Map(prev);
      next.delete(errorId);
      return next;
    });

    // Remove dismissed errors after animation (300ms)
    const dismissalTimeoutId = setTimeout(() => {
      setErrors(prev => prev.filter(e => e.id !== errorId));
      setDismissalTimeouts(prev => {
        const next = new Map(prev);
        next.delete(errorId);
        return next;
      });
    }, 300);

    setDismissalTimeouts(prev => new Map(prev).set(errorId, dismissalTimeoutId));
  }, []);

  /**
   * Dismiss all errors
   */
  const dismissAll = useCallback(() => {
    setErrors(prev => prev.map(e => ({ ...e, dismissed: true })));
    setRetryActions(new Map());

    setTimeout(() => {
      setErrors([]);
    }, 300);
  }, []);

  /**
   * Get errors by display type
   */
  const getErrorsByType = useCallback((displayType: 'toast' | 'inline' | 'modal' | 'banner'): ActiveError[] => {
    return errors.filter(e => e.displayOptions.displayType === displayType && !e.dismissed);
  }, [errors]);

  /**
   * Check if error is currently shown
   */
  const hasError = useCallback((errorId: string): boolean => {
    return errors.some(e => e.id === errorId && !e.dismissed);
  }, [errors]);

  /**
   * Set retry action for an error
   */
  const setRetryAction = useCallback((errorId: string, retryFn: () => Promise<void>) => {
    setRetryActions(prev => new Map(prev).set(errorId, retryFn));
  }, []);

  // Auto-cleanup old dismissed errors
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setErrors(prev => prev.filter(e => {
        // Keep if not dismissed or dismissed less than 5 seconds ago
        return !e.dismissed || (now - e.timestamp < 5000);
      }));
    }, 5000);

    return () => clearInterval(cleanup);
  }, []);

  // Keep dismissErrorRef up-to-date
  useEffect(() => {
    dismissErrorRef.current = dismissError;
  }, [dismissError]);

  // Auto-dismiss errors with duration specified
  useEffect(() => {
    errors.forEach(error => {
      if (error.dismissed) return;

      const duration = error.displayOptions.duration;
      if (duration && duration > 0 && !timeoutIds.has(error.id)) {
        const timeoutId = setTimeout(() => {
          // Use ref to get latest dismissError (avoids stale closure)
          if (dismissErrorRef.current) {
            dismissErrorRef.current(error.id);
          }
        }, duration);

        setTimeoutIds(prev => new Map(prev).set(error.id, timeoutId));
      }
    });
  }, [errors, timeoutIds]);

  // Cleanup all timeouts on unmount (prevent memory leaks)
  useEffect(() => {
    return () => {
      // Clear all auto-dismiss timeouts
      timeoutIds.forEach(timeoutId => clearTimeout(timeoutId));
      // Clear all dismissal animation timeouts
      dismissalTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    };
  }, [timeoutIds, dismissalTimeouts]);

  const value: ErrorHandlerContextValue = {
    errors,
    showError,
    dismissError,
    dismissAll,
    getErrorsByType,
    hasError,
    setRetryAction
  };

  return (
    <ErrorHandlerContext.Provider value={value}>
      {children}
    </ErrorHandlerContext.Provider>
  );
};

/**
 * Hook to access error handler
 */
export const useErrorHandler = () => {
  const context = useContext(ErrorHandlerContext);
  if (!context) {
    throw new Error('useErrorHandler must be used within ErrorHandlerProvider');
  }

  return context;
};

/**
 * Convenience hook for common error operations
 */
export const useError = () => {
  const { showError, dismissError, setRetryAction } = useErrorHandler();

  /**
   * Handle error with automatic retry setup
   */
  const handleError = useCallback((
    error: unknown,
    context?: ErrorContext,
    retryFn?: () => Promise<void>
  ): string => {
    const errorId = showError(error, context);

    if (retryFn) {
      setRetryAction(errorId, retryFn);
    }

    return errorId;
  }, [showError, setRetryAction]);

  /**
   * Show error with retry
   */
  const showErrorWithRetry = useCallback((
    error: unknown,
    retryFn: () => Promise<void>,
    context?: ErrorContext
  ): string => {
    return handleError(error, context, retryFn);
  }, [handleError]);

  return {
    showError,
    showErrorWithRetry,
    dismissError,
    handleError
  };
};
