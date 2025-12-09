/**
 * Centralized API Error Handler
 *
 * Provides consistent error detection and user-friendly messages
 * for all API operations across the application.
 */

import { AuthenticationError, UserFacingError } from '../errors/types';
import { createLogger } from './logger';

const log = createLogger('APIErrorHandler');

export enum ErrorType {
  AUTH = 'auth',
  PERMISSION = 'permission',  // New: 403 Forbidden errors
  NETWORK = 'network',
  SERVER = 'server'
}

export interface ErrorInfo {
  type: ErrorType;
  userMessage: string;
  technicalMessage: string;
  shouldRetry: boolean;
  shouldLogout: boolean;
}

/**
 * Classifies an error and returns user-friendly information
 */
export function classifyError(error: unknown, context?: string): ErrorInfo {
  const contextPrefix = context ? `[${context}] ` : '';

  // 0. Handle UserFacingError (from new error system)
  if (error instanceof UserFacingError) {
    return {
      type: error.category === 'authentication' ? ErrorType.AUTH :
            error.category === 'network' ? ErrorType.NETWORK :
            ErrorType.SERVER,
      userMessage: error.userMessage,
      technicalMessage: error.message,
      shouldRetry: error.recovery === 'retry_with_backoff' || error.recovery === 'auto_retry_with_delay',
      shouldLogout: error.category === 'authentication'
    };
  }

  // 1. Authentication Error
  if (error instanceof AuthenticationError ||
      (error instanceof Error && error.name === 'AuthenticationError')) {
    log.warn(`${contextPrefix}Auth error detected`, error);

    return {
      type: ErrorType.AUTH,
      userMessage: '🔒 Your session has expired. Please log in again to continue.',
      technicalMessage: error instanceof Error ? error.message : 'Authentication required',
      shouldRetry: false,
      shouldLogout: true
    };
  }

  // 2. Network Error (connection issues, timeout, DNS failure)
  if (error instanceof Error && error.name === 'NetworkError') {
    log.warn(`${contextPrefix}Network error detected`, error);

    return {
      type: ErrorType.NETWORK,
      userMessage: '🌐 Unable to connect to server. Please check your internet connection and try again.',
      technicalMessage: error.message,
      shouldRetry: true,
      shouldLogout: false
    };
  }

  // 3. Check for permission/authorization errors (403 Forbidden)
  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();

    // 403 Forbidden - insufficient permissions
    if (errorMsg.includes('403') ||
        errorMsg.includes('forbidden') ||
        errorMsg.includes('admin access required') ||
        errorMsg.includes('insufficient permissions')) {
      log.warn(`${contextPrefix}Permission error detected`, error);

      return {
        type: ErrorType.PERMISSION,
        userMessage: '🔐 This feature requires admin access. You don\'t have permission to perform this action.',
        technicalMessage: error.message,
        shouldRetry: false,
        shouldLogout: false
      };
    }

    // Network connectivity issues
    if (errorMsg.includes('network') ||
        errorMsg.includes('fetch') ||
        errorMsg.includes('connection') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('connect to server')) {
      log.warn(`${contextPrefix}Network error detected by message`, error);

      return {
        type: ErrorType.NETWORK,
        userMessage: '🌐 Unable to connect to server. Please check your internet connection and try again.',
        technicalMessage: error.message,
        shouldRetry: true,
        shouldLogout: false
      };
    }

    // Session/auth issues (401 Unauthorized - catch auth errors that came as 500)
    if (errorMsg.includes('401') ||
        errorMsg.includes('token') ||
        errorMsg.includes('authentication') ||
        errorMsg.includes('unauthorized') ||
        errorMsg.includes('session expired') ||
        errorMsg.includes('please sign in')) {
      log.warn(`${contextPrefix}Auth error detected by message`, error);

      return {
        type: ErrorType.AUTH,
        userMessage: '🔒 Your session has expired. Please log in again.',
        technicalMessage: error.message,
        shouldRetry: false,
        shouldLogout: true
      };
    }
  }

  // 4. Server Error (500, 502, 503, etc.) - everything else
  log.error(`${contextPrefix}Server error`, error);

  const technicalMessage = error instanceof Error ? error.message : String(error);

  return {
    type: ErrorType.SERVER,
    userMessage: '⚠️ Server encountered an error. Please try again in a moment.',
    technicalMessage,
    shouldRetry: true,
    shouldLogout: false
  };
}

/**
 * Formats error message for display in chat/conversation
 */
export function formatErrorForChat(errorInfo: ErrorInfo | UserFacingError): string {
  if (errorInfo instanceof UserFacingError) {
    return errorInfo.userMessage;
  }

  switch (errorInfo.type) {
    case ErrorType.AUTH:
      return '🔒 Your session has expired. Please log in again to continue.';

    case ErrorType.PERMISSION:
      return '🔐 Admin access required. You don\'t have permission to access this feature.';

    case ErrorType.NETWORK:
      return '🌐 Network error. Please check your connection and try again.';

    case ErrorType.SERVER:
      return `⚠️ Server error. Please try again.\n\nDetails: ${errorInfo.technicalMessage}`;

    default:
      return '❌ An unexpected error occurred. Please try again.';
  }
}

/**
 * Formats error message for display in toast/alert
 */
export function formatErrorForAlert(errorInfo: ErrorInfo | UserFacingError): string {
  if (errorInfo instanceof UserFacingError) {
    return errorInfo.userMessage;
  }
  return errorInfo.userMessage;
}

/**
 * Handles API errors with appropriate UI feedback
 */
export function handleApiError(
  error: unknown,
  context: string,
  callbacks: {
    showError: (message: string) => void;
    showErrorWithRetry?: (error: unknown, retryFn: () => Promise<void>, context?: any) => void;
    onAuthError?: () => void;
  }
): ErrorInfo {
  const errorInfo = classifyError(error, context);

  // Handle authentication errors
  if (errorInfo.shouldLogout && callbacks.onAuthError) {
    callbacks.onAuthError();
    callbacks.showError(errorInfo.userMessage);
  }
  // Handle retryable errors
  else if (errorInfo.shouldRetry && callbacks.showErrorWithRetry) {
    // Note: Retry function needs to be provided by caller
    callbacks.showError(errorInfo.userMessage);
  }
  // Handle non-retryable errors
  else {
    callbacks.showError(errorInfo.userMessage);
  }

  return errorInfo;
}
