// src/lib/utils/retry.ts

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
  /**
   * The wait slept before the next attempt, given the exponential backoff this
   * attempt has reached (default: the backoff itself). A caller that honours a
   * server-directed wait returns the longer of the two. The ONLY place a wait
   * between attempts comes from: `deadlineMs` is judged on this value, so a
   * wait taken anywhere else (an `onRetry` that sleeps) would escape it.
   */
  retryDelay?: (error: unknown, attempt: number, backoffDelay: number) => number;
  /**
   * Wall-clock bound in ms from the first attempt, counting time inside each
   * attempt as well as the waits (`Date.now()`). No attempt STARTS at or after
   * it: a retry whose wait would reach it is not made, and the last error is
   * thrown. An attempt already running is not cut short.
   */
  deadlineMs?: number;
  /** Callback for each retry attempt, with the wait about to be slept before it */
  onRetry?: (error: any, attempt: number, delay: number) => void | Promise<void>;
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
    retryDelay,
    deadlineMs,
    onRetry
  } = options;

  const startedAt = Date.now();
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

      // The wait actually slept, decided once: the deadline is judged on the
      // same number the timer is set with, so the next attempt cannot start
      // later than the check allowed.
      const wait = retryDelay ? retryDelay(error, attempt, delay) : delay;
      if (deadlineMs !== undefined && Date.now() - startedAt + wait >= deadlineMs) {
        throw error;
      }

      // Notify retry callback. Awaited so an async observer finishes before
      // the next attempt; a wait belongs in `retryDelay`, not here.
      if (onRetry) {
        await onRetry(error, attempt, wait);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, wait));

      // Exponential backoff for the next iteration
      delay = Math.min(delay * backoffMultiplier, maxDelay);
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

