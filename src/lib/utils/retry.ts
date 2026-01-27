// src/lib/utils/retry.ts

import { createLogger } from '~/lib/utils/logger';

const log = createLogger('Retry');

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: all errors retryable) */
  shouldRetry?: (error: any, attempt: number) => boolean;
  /** Callback for each retry attempt */
  onRetry?: (error: any, attempt: number, delay: number) => void;
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves with function result or rejects with last error
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => createSession(),
 *   {
 *     maxAttempts: 3,
 *     initialDelay: 1000,
 *     onRetry: (err, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${err.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate next delay with exponential backoff
      const nextDelay = Math.min(delay * backoffMultiplier, maxDelay);

      // Notify retry callback
      if (onRetry) {
        onRetry(error, attempt, delay);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      // Update delay for next iteration
      delay = nextDelay;
    }
  }

  throw lastError;
}

/**
 * Determines if an error is retryable
 *
 * Network errors, timeouts, and 5xx server errors are retryable.
 * Authentication and validation errors are not retryable.
 */
export function isRetryableError(error: any): boolean {
  // Network errors are retryable
  if (error.name === 'NetworkError' || error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors are retryable
  if (error.name === 'TimeoutError' || error.message?.toLowerCase().includes('timeout')) {
    return true;
  }

  // HTTP status codes
  if ('status' in error || error.response?.status) {
    const status = error.status || error.response?.status;

    // 5xx server errors are retryable
    if (status >= 500 && status < 600) {
      return true;
    }

    // 429 rate limit is retryable (should wait for Retry-After)
    if (status === 429) {
      return true;
    }

    // 408 request timeout is retryable
    if (status === 408) {
      return true;
    }

    // 4xx client errors are NOT retryable (except 408 and 429)
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Default: assume retryable
  return true;
}

/**
 * Extract retry delay from Retry-After header
 *
 * @param error - Error that may contain Retry-After header
 * @returns Delay in milliseconds, or null if not found
 */
export function getRetryAfterDelay(error: any): number | null {
  // Check for Retry-After header in error response
  if (error.response?.headers) {
    const retryAfter = error.response.headers.get('Retry-After') ||
                       error.response.headers.get('retry-after');

    if (retryAfter) {
      // Retry-After can be either a number of seconds or an HTTP date
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000; // Convert to milliseconds
      }

      // Try to parse as HTTP date
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }
  }

  return null;
}

/**
 * Retry with rate limit handling
 *
 * Respects Retry-After header from 429 responses
 */
export async function retryWithRateLimit<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retryWithBackoff(fn, {
    ...options,
    shouldRetry: (error, attempt) => {
      // Check custom shouldRetry first
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) {
        return false;
      }

      // Check if error is retryable
      return isRetryableError(error);
    },
    onRetry: (error, attempt, delay) => {
      // Use Retry-After header for rate limit errors
      const retryAfter = getRetryAfterDelay(error);
      const actualDelay = retryAfter || delay;

      log.info('Retry attempt failed', {
        attempt,
        retryDelayMs: actualDelay,
        error: error.message,
        status: error.status || error.response?.status
      });

      // Call custom onRetry if provided
      if (options.onRetry) {
        options.onRetry(error, attempt, actualDelay);
      }

      // If we have Retry-After, wait for it
      if (retryAfter && retryAfter > delay) {
        return new Promise(resolve => setTimeout(resolve, retryAfter - delay));
      }
    }
  });
}
