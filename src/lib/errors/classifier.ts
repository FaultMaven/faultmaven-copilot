// src/lib/errors/classifier.ts

import {
  UserFacingError,
  AuthenticationError,
  NetworkError,
  TimeoutError,
  ServerError,
  ValidationError,
  RateLimitError,
  OptimisticUpdateError,
  UnknownError,
  ErrorContext
} from './types';
import { AuthenticationError as ApiAuthError } from '../api';

/**
 * Classifies technical errors into user-facing errors with friendly messages
 */
export class ErrorClassifier {
  /**
   * Converts any error into a UserFacingError with appropriate messaging
   */
  static classify(error: unknown, context?: ErrorContext): UserFacingError {
    // Already a user-facing error
    if (error instanceof UserFacingError) {
      return error;
    }

    // Convert to Error object if it's not
    const err = error instanceof Error ? error : new Error(String(error));

    // API Authentication Error
    if (error instanceof ApiAuthError || err.message.includes('Authentication required')) {
      return new AuthenticationError(err.message, err, context);
    }

    // HTTP Status-based classification
    if ('status' in err && typeof (err as any).status === 'number') {
      const status = (err as any).status;
      return this.classifyHttpError(status, err, context);
    }

    // Network errors (fetch failures)
    if (this.isNetworkError(err)) {
      return new NetworkError(err.message, err, context);
    }

    // Timeout errors
    if (this.isTimeoutError(err)) {
      return new TimeoutError(err.message, 30000, err, context);
    }

    // Validation errors
    if (this.isValidationError(err)) {
      return new ValidationError(err.message, {}, err, context);
    }

    // Optimistic update failures
    if (context?.operation && err.message.includes('failed')) {
      const actionType = this.getActionTypeFromOperation(context.operation);
      return new OptimisticUpdateError(actionType, err.message, err, context);
    }

    // Unknown error
    return new UnknownError(err.message, err, context);
  }

  /**
   * Classifies errors based on HTTP status code
   */
  private static classifyHttpError(status: number, error: Error, context?: ErrorContext): UserFacingError {
    switch (status) {
      case 401:
      case 403:
        return new AuthenticationError(error.message, error, context);

      case 400:
      case 422:
        return new ValidationError(error.message, {}, error, context);

      case 429:
        // Try to extract Retry-After header value
        const retryAfter = this.extractRetryAfter(error);
        return new RateLimitError(error.message, retryAfter, error, context);

      case 408: // Request Timeout
      case 504: // Gateway Timeout
        return new TimeoutError(error.message, 30000, error, context);

      case 500:
      case 502:
      case 503:
        return new ServerError(error.message, status, error, context);

      case 404:
        return new ValidationError('Resource not found', { resource: 'The requested item was not found' }, error, context);

      default:
        if (status >= 500) {
          return new ServerError(error.message, status, error, context);
        }
        if (status >= 400) {
          return new ValidationError(error.message, {}, error, context);
        }
        return new UnknownError(error.message, error, context);
    }
  }

  /**
   * Checks if error is a network/connection error
   */
  private static isNetworkError(error: Error): boolean {
    const message = error.message.toLowerCase();
    const networkIndicators = [
      'network',
      'fetch',
      'econnrefused',
      'enotfound',
      'econnreset',
      'etimedout',
      'unable to reach',
      'connection',
      'offline',
      'no internet'
    ];

    return networkIndicators.some(indicator => message.includes(indicator)) ||
           error.name === 'NetworkError' ||
           error.name === 'TypeError' && message.includes('fetch');
  }

  /**
   * Checks if error is a timeout
   */
  private static isTimeoutError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('timed out') ||
           message.includes('took too long') ||
           error.name === 'TimeoutError';
  }

  /**
   * Checks if error is a validation error
   */
  private static isValidationError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('invalid') ||
           message.includes('validation') ||
           message.includes('required field') ||
           message.includes('must be') ||
           error.name === 'ValidationError';
  }

  /**
   * Extracts retry-after value from error (if available)
   */
  private static extractRetryAfter(error: any): number {
    // Check if error has response headers
    if (error.response?.headers) {
      const retryAfter = error.response.headers.get('Retry-After');
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
          return seconds * 1000; // Convert to ms
        }
      }
    }

    // Default to 5 seconds
    return 5000;
  }

  /**
   * Converts operation name to user-friendly action type
   */
  private static getActionTypeFromOperation(operation: string): string {
    const operationMap: Record<string, string> = {
      'message_submission': 'message',
      'query_submission': 'message',
      'case_creation': 'chat',
      'title_update': 'title change',
      'data_upload': 'upload',
      'session_creation': 'session'
    };

    return operationMap[operation] || 'action';
  }

  /**
   * Extracts field-level validation errors from API response
   */
  static extractFieldErrors(error: any): Record<string, string> {
    const fieldErrors: Record<string, string> = {};

    // Check for FastAPI-style validation errors
    if (error.response?.data?.detail && Array.isArray(error.response.data.detail)) {
      for (const validationError of error.response.data.detail) {
        const field = validationError.loc?.join('.') || 'unknown';
        const message = validationError.msg || 'Invalid value';
        fieldErrors[field] = message;
      }
    }

    // Check for generic error detail
    if (error.response?.data?.detail && typeof error.response.data.detail === 'string') {
      fieldErrors['general'] = error.response.data.detail;
    }

    return fieldErrors;
  }

  /**
   * Determines if multiple errors should be aggregated
   */
  static shouldAggregate(error1: UserFacingError, error2: UserFacingError): boolean {
    // Same category and same user message = aggregate
    return error1.category === error2.category &&
           error1.userTitle === error2.userTitle &&
           error1.userMessage === error2.userMessage;
  }

  /**
   * Creates aggregate error from multiple similar errors
   */
  static aggregate(errors: UserFacingError[]): UserFacingError {
    if (errors.length === 0) {
      return new UnknownError('No errors provided');
    }

    if (errors.length === 1) {
      return errors[0];
    }

    // Use the first error as template
    const template = errors[0];
    const count = errors.length;

    // Create new error with aggregated context
    const aggregatedContext: ErrorContext = {
      ...template.context,
      metadata: {
        ...template.context?.metadata,
        aggregatedCount: count,
        aggregatedTimestamp: Date.now()
      }
    };

    // Return same type of error but with aggregated context
    const AggregatedErrorClass = template.constructor as any;
    return new AggregatedErrorClass(
      `${template.message} (${count} occurrences)`,
      template.originalError,
      aggregatedContext
    );
  }
}
