/**
 * Debounce Utility
 *
 * Implements debouncing for optimistic update operations to prevent
 * excessive API calls during rapid user actions.
 *
 * Design Principles:
 * - Optimistic updates still happen immediately (0ms)
 * - Only the background API sync is debounced
 * - Maintains data integrity through proper cleanup
 */

export type DebounceFunction<T extends (...args: any[]) => any> = (
  ...args: Parameters<T>
) => void;

export interface DebounceOptions {
  /**
   * Wait time in milliseconds before executing the function
   */
  wait: number;

  /**
   * Execute immediately on leading edge
   */
  leading?: boolean;

  /**
   * Maximum time to wait before forcing execution
   */
  maxWait?: number;
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 *
 * @param func - The function to debounce
 * @param options - Debounce configuration
 * @returns Debounced function with cancel method
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  options: DebounceOptions
): DebounceFunction<T> & { cancel: () => void; flush: () => void } {
  const { wait, leading = false, maxWait } = options;

  let timeoutId: NodeJS.Timeout | null = null;
  let maxTimeoutId: NodeJS.Timeout | null = null;
  let lastCallTime: number | null = null;
  let lastInvokeTime = 0;
  let lastArgs: Parameters<T> | null = null;
  let result: ReturnType<T> | undefined;

  const invokeFunc = (time: number) => {
    const args = lastArgs;
    lastArgs = null;
    lastInvokeTime = time;
    if (args) {
      result = func(...args);
    }
    return result;
  };

  const leadingEdge = (time: number) => {
    lastInvokeTime = time;
    // Start the timer for the trailing edge
    timeoutId = setTimeout(timerExpired, wait);
    // Call the function if leading edge is enabled
    return leading ? invokeFunc(time) : result;
  };

  const remainingWait = (time: number) => {
    const timeSinceLastCall = time - (lastCallTime || 0);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;

    return maxWait !== undefined
      ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  };

  const shouldInvoke = (time: number) => {
    const timeSinceLastCall = time - (lastCallTime || 0);
    const timeSinceLastInvoke = time - lastInvokeTime;

    return (
      lastCallTime === null ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
    );
  };

  const timerExpired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer
    timeoutId = setTimeout(timerExpired, remainingWait(time));
  };

  const trailingEdge = (time: number) => {
    timeoutId = null;

    // Clear maxWait timeout if it exists
    if (maxTimeoutId) {
      clearTimeout(maxTimeoutId);
      maxTimeoutId = null;
    }

    // Only invoke if we have lastArgs (was called at least once)
    if (lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = null;
    return result;
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (maxTimeoutId) {
      clearTimeout(maxTimeoutId);
      maxTimeoutId = null;
    }
    lastCallTime = null;
    lastArgs = null;
    lastInvokeTime = 0;
  };

  const flush = () => {
    if (timeoutId === null) {
      return result;
    }
    return trailingEdge(Date.now());
  };

  const debounced = function (this: any, ...args: Parameters<T>) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastCallTime = time;

    if (isInvoking) {
      if (timeoutId === null) {
        return leadingEdge(lastCallTime);
      }
      if (maxWait !== undefined) {
        // Handle maxWait
        timeoutId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }

    if (timeoutId === null) {
      timeoutId = setTimeout(timerExpired, wait);
    }

    // Set maxWait timer if specified
    if (maxWait !== undefined && maxTimeoutId === null) {
      maxTimeoutId = setTimeout(() => {
        if (lastArgs) {
          trailingEdge(Date.now());
        }
      }, maxWait);
    }

    return result;
  };

  debounced.cancel = cancel;
  debounced.flush = flush;

  return debounced as DebounceFunction<T> & { cancel: () => void; flush: () => void };
}