// src/lib/errors/types.ts

/**
 * Base error class for all user-facing errors in FaultMaven Copilot
 * Extends Error with user-friendly messaging and recovery strategies
 */
export abstract class UserFacingError extends Error {
  /** User-friendly title for the error */
  abstract readonly userTitle: string;

  /** User-friendly message explaining what happened */
  abstract readonly userMessage: string;

  /** Guidance on what the user should do next */
  abstract readonly userAction: string;

  /** Error category for classification */
  abstract readonly category: ErrorCategory;

  /** Recovery strategy */
  abstract readonly recovery: RecoveryStrategy;

  /** Original technical error (for logging/debugging) */
  readonly originalError?: Error;

  /** Additional context about where/when error occurred */
  readonly context?: ErrorContext;

  constructor(message: string, originalError?: Error, context?: ErrorContext) {
    super(message);
    this.name = this.constructor.name;
    this.originalError = originalError;
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error categories for classification and handling
 */
export type ErrorCategory =
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'server'
  | 'validation'
  | 'rate_limit'
  | 'optimistic_rollback'
  | 'unknown';

/**
 * Recovery strategies for error handling
 */
export type RecoveryStrategy =
  | 'logout_and_redirect'      // Clear auth, redirect to login
  | 'retry_with_backoff'       // Auto-retry with exponential backoff
  | 'manual_retry'             // User must click retry
  | 'user_fix_required'        // User must fix input
  | 'auto_retry_with_delay'    // Auto-retry after fixed delay
  | 'rollback_and_retry'       // Rollback optimistic update + allow retry
  | 'show_modal'               // Show blocking modal
  | 'graceful_degradation';    // Disable feature, continue

/**
 * Context about where/when error occurred
 */
export interface ErrorContext {
  operation?: string;           // e.g., 'message_submission', 'case_creation'
  operationId?: string;         // Optimistic operation ID
  caseId?: string;             // Affected case
  userId?: string;             // User who encountered error
  timestamp?: number;          // When error occurred
  retryCount?: number;         // How many retries attempted
  preserveInput?: boolean;     // Should we preserve user input?
  rollbackData?: any;          // Data for rollback
  metadata?: Record<string, any>; // Additional context
}

/**
 * UI display options for errors
 */
export interface ErrorDisplayOptions {
  /** How to show the error */
  displayType: 'toast' | 'inline' | 'modal' | 'banner';

  /** Auto-dismiss duration (ms), 0 = persistent */
  duration?: number;

  /** Can user manually dismiss? */
  dismissible?: boolean;

  /** Should block all other interactions? */
  blocking?: boolean;

  /** Action buttons to show */
  actions?: ErrorAction[];

  /** Icon to display */
  icon?: 'error' | 'warning' | 'info';
}

/**
 * Action button for error UI
 */
export interface ErrorAction {
  label: string;
  onClick: () => void | Promise<void>;
  primary?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * Session expiration error for automatic session refresh
 */
export class SessionExpiredError extends UserFacingError {
  readonly userTitle = 'Session Expired';
  readonly userMessage = 'Your session has expired.';
  readonly userAction = 'We are refreshing your session...';
  readonly category: ErrorCategory = 'authentication';
  readonly recovery: RecoveryStrategy = 'auto_retry_with_delay';

  constructor(message: string = 'Session expired', originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: 3000,
      dismissible: true,
      icon: 'info'
    };
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends UserFacingError {
  readonly userTitle = 'Session Expired';
  readonly userMessage = 'Your session has expired.';
  readonly userAction = 'Please sign in again to continue.';
  readonly category: ErrorCategory = 'authentication';
  readonly recovery: RecoveryStrategy = 'show_modal';

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'modal',
      blocking: true,
      dismissible: false,
      actions: [{
        label: 'Sign In',
        onClick: async () => {
          // Will be set by error handler
        },
        primary: true
      }]
    };
  }
}

/**
 * Network/connection error
 */
export class NetworkError extends UserFacingError {
  readonly userTitle = 'Connection Problem';
  readonly userMessage = 'Unable to reach FaultMaven server.';
  readonly userAction = 'Please check your connection and try again.';
  readonly category: ErrorCategory = 'network';
  readonly recovery: RecoveryStrategy = 'retry_with_backoff';
  readonly maxRetries = 3;

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: 0, // Persistent until dismissed or connection restored
      dismissible: true,
      icon: 'error',
      actions: [{
        label: 'Retry',
        onClick: async () => {
          // Will be set by error handler
        }
      }]
    };
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends UserFacingError {
  readonly userTitle = 'Request Timed Out';
  readonly userMessage = 'The server took too long to respond.';
  readonly userAction = 'Please try again. If this continues, the server may be experiencing issues.';
  readonly category: ErrorCategory = 'timeout';
  readonly recovery: RecoveryStrategy = 'manual_retry';
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number = 30000, originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
    this.timeoutMs = timeoutMs;
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: 10000,
      dismissible: true,
      icon: 'warning',
      actions: [{
        label: 'Retry',
        onClick: async () => {
          // Will be set by error handler
        }
      }]
    };
  }
}

/**
 * Server error (500, 502, 503, 504)
 */
export class ServerError extends UserFacingError {
  readonly userTitle = 'Server Error';
  readonly userMessage = 'FaultMaven server encountered an error.';
  readonly userAction = 'Try again in a few minutes. If this continues, contact support.';
  readonly category: ErrorCategory = 'server';
  readonly recovery: RecoveryStrategy = 'manual_retry';
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number = 500, originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
    this.httpStatus = httpStatus;
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: 0, // Persistent until dismissed
      dismissible: true,
      icon: 'error',
      actions: [{
        label: 'Retry',
        onClick: async () => {
          // Will be set by error handler
        }
      }]
    };
  }
}

/**
 * Validation error (400, 422)
 */
export class ValidationError extends UserFacingError {
  readonly userTitle = 'Invalid Input';
  readonly userMessage: string;
  readonly userAction = 'Please check your input and try again.';
  readonly category: ErrorCategory = 'validation';
  readonly recovery: RecoveryStrategy = 'user_fix_required';
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}, originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
    this.fieldErrors = fieldErrors;
    this.userMessage = Object.keys(fieldErrors).length > 0
      ? Object.values(fieldErrors).join(', ')
      : 'Please check your input.';
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'inline',
      dismissible: false,
      icon: 'error'
    };
  }
}

/**
 * Rate limiting error (429)
 */
export class RateLimitError extends UserFacingError {
  readonly userTitle = 'Too Many Requests';
  readonly userMessage = "You're sending requests too quickly.";
  readonly userAction: string;
  readonly category: ErrorCategory = 'rate_limit';
  readonly recovery: RecoveryStrategy = 'auto_retry_with_delay';
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number = 5000, originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
    this.retryAfterMs = retryAfterMs;
    const seconds = Math.ceil(retryAfterMs / 1000);
    this.userAction = `We'll try again in ${seconds} seconds...`;
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: this.retryAfterMs,
      dismissible: false,
      icon: 'warning'
    };
  }
}

/**
 * Optimistic update rollback error
 */
export class OptimisticUpdateError extends UserFacingError {
  readonly userTitle = 'Action Failed';
  readonly userMessage: string;
  readonly userAction = 'Click retry to try again.';
  readonly category: ErrorCategory = 'optimistic_rollback';
  readonly recovery: RecoveryStrategy = 'rollback_and_retry';
  readonly actionType: string;

  constructor(actionType: string, message: string, originalError?: Error, context?: ErrorContext) {
    super(message, originalError, context);
    this.actionType = actionType;
    this.userMessage = `Your ${actionType} couldn't be completed.`;
  }

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'inline',
      dismissible: false,
      icon: 'error',
      actions: [{
        label: 'Retry',
        onClick: async () => {
          // Will be set by error handler
        }
      }]
    };
  }
}

/**
 * Unknown/unclassified error
 */
export class UnknownError extends UserFacingError {
  readonly userTitle = 'Unexpected Error';
  readonly userMessage = 'Something went wrong.';
  readonly userAction = 'Please try again or contact support if this continues.';
  readonly category: ErrorCategory = 'unknown';
  readonly recovery: RecoveryStrategy = 'manual_retry';

  getDisplayOptions(): ErrorDisplayOptions {
    return {
      displayType: 'toast',
      duration: 8000,
      dismissible: true,
      icon: 'error',
      actions: [{
        label: 'Retry',
        onClick: async () => {
          // Will be set by error handler
        }
      }]
    };
  }
}
