
import { ErrorClassifier } from '../errors/classifier';
import { hasServerDirectedWait, UserFacingError, ErrorContext } from '../errors/types';
import { retryWithBackoff, RetryOptions } from './retry';

export interface ResilientOperationOptions<T> {
  /** The operation to perform */
  operation: () => Promise<T>;
  
  /** Context for error classification */
  context: ErrorContext;
  
  /**
   * Optional specific retry options (overrides defaults). The wait between
   * attempts and the deadline are this function's own (`deadlineMs` below):
   * one place decides the wait, so the deadline is judged on what is slept.
   */
  retryOptions?: Partial<Omit<RetryOptions, 'retryDelay' | 'deadlineMs'>>;
  
  /** Callback for when an error occurs (even if retried) */
  onError?: (error: UserFacingError, attempt: number) => void;

  /** Callback for when the operation ultimately fails after all retries */
  onFailure?: (error: UserFacingError) => void;

  /**
   * Whether the operation is safe to auto-retry after an AMBIGUOUS failure — a
   * network error where the request may already have reached the server and
   * committed. Reads and idempotent writes are `true` (the default). A
   * non-idempotent write (submitting a turn, creating a case) MUST set `false`:
   * retrying an ambiguous network failure would re-send a POST that may have
   * already succeeded, silently DUPLICATING it. (Rejections like 429/401 mean the
   * request was not processed, so those are still retried; timeouts and 5xx are
   * already non-retryable via the recovery-strategy map below.)
   */
  idempotent?: boolean;

  /**
   * Wall-clock bound on the whole operation, in ms from the first attempt.
   *
   * Counts the time spent INSIDE each request as well as the waits between
   * them, measured with `Date.now()` like `POLL_MAX_TOTAL_MS`: a bound that
   * counted only the sleeps would let a request that hangs to its own timeout
   * spend nothing of it. No retry is started once the elapsed time plus the
   * wait actually slept before it — the backoff, or the server-directed wait
   * when that is longer — would reach the bound; an attempt already running is
   * not cut short (its own request timeout bounds it), so the worst case is
   * about `deadlineMs` + one request timeout.
   *
   * Enforced by `retryWithBackoff` once any `retryOptions.shouldRetry`
   * override has said yes, so an override cannot outlive it.
   */
  deadlineMs?: number;
}

/**
 * The retry decision for a classified error, from its recovery strategy.
 *
 * Exported so a `retryOptions.shouldRetry` override can COMPOSE with it: an
 * override replaces this decision entirely (including the non-idempotent
 * network rule), so one that only wants to add cases must call this for the
 * rest.
 */
export function defaultRetryDecision(
  classifiedError: UserFacingError,
  options: { idempotent: boolean }
): boolean {
  // Non-idempotent writes must NOT auto-retry an ambiguous network failure:
  // the request may already have reached the server and committed, so a
  // retry would duplicate it (e.g. a second turn / a second case). Surface
  // it instead — the user gets a manual retry affordance and can see whether
  // it landed.
  if (!options.idempotent && classifiedError.category === 'network') {
    return false;
  }

  // Use the recovery strategy from the error
  switch (classifiedError.recovery) {
    case 'retry_with_backoff':
    case 'auto_retry_with_delay':
      return true;

    case 'manual_retry':
    case 'user_fix_required':
    case 'show_modal':
    case 'graceful_degradation':
    case 'rollback_and_retry':
      return false;

    default:
      return false;
  }
}

/**
 * Executes an operation with automatic error classification, retry logic, and standardized error reporting.
 */
export async function resilientOperation<T>(
  options: ResilientOperationOptions<T>
): Promise<T> {
  const { operation, context, retryOptions = {}, onError, onFailure, idempotent = true, deadlineMs } = options;

  const performOperation = async () => {
    return await operation();
  };

  try {
    return await retryWithBackoff(performOperation, {
      // Default retry options
      maxAttempts: 3,
      initialDelay: 1000,
      backoffMultiplier: 2,
      ...retryOptions,
      
      // Intelligent retry logic based on error classification
      shouldRetry: (error, attempt) => {
        const classifiedError = ErrorClassifier.classify(error, context);
        
        // Notify observer
        if (onError) {
          onError(classifiedError, attempt);
        }

        // Check explicit retry options first
        if (retryOptions.shouldRetry) {
          return retryOptions.shouldRetry(error, attempt);
        }

        return defaultRetryDecision(classifiedError, { idempotent });
      },
      
      // The wait before the next attempt: the generic exponential backoff, or
      // the server's wait when that is longer. Any classified error carrying it
      // as `retryAfterMs` (`ServerDirectedWait`: a 429's RateLimitError, a 409
      // TURN_IN_PROGRESS's TurnInProgressError) is honoured — otherwise a 429
      // carrying a 60s window is retried after ~1s and simply burns its bounded
      // attempts. retryWithBackoff sleeps exactly this and judges `deadlineMs`
      // on it, so the bound sees the backoff too (#324: it used to add only the
      // server's wait, and a backoff-only retry started past the deadline).
      //
      // The wait is honored as given. Whether it is worth sitting on at all
      // was already decided upstream by the error's recovery: a 429 wait past
      // MAX_AUTO_RETRY_WAIT_MS is `manual_retry`, which the decision above
      // declines, so nothing that reaches here carries a window this client
      // is unwilling to wait out. Clamping it again here would only shorten
      // an honest wait into a guaranteed refusal.
      retryDelay: (error, _attempt, backoffDelay) => {
        const classified = ErrorClassifier.classify(error, context);
        return hasServerDirectedWait(classified)
          ? Math.max(backoffDelay, classified.retryAfterMs)
          : backoffDelay;
      },
      deadlineMs,
    });
  } catch (finalError) {
    const classifiedError = ErrorClassifier.classify(finalError, context);
    
    if (onFailure) {
      onFailure(classifiedError);
    }
    
    throw classifiedError;
  }
}
