
import { ErrorClassifier } from '../errors/classifier';
import { UserFacingError, ErrorContext } from '../errors/types';
import { retryWithBackoff, RetryOptions } from './retry';

export interface ResilientOperationOptions<T> {
  /** The operation to perform */
  operation: () => Promise<T>;
  
  /** Context for error classification */
  context: ErrorContext;
  
  /** Optional specific retry options (overrides defaults) */
  retryOptions?: Partial<RetryOptions>;
  
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
}

/**
 * Executes an operation with automatic error classification, retry logic, and standardized error reporting.
 */
export async function resilientOperation<T>(
  options: ResilientOperationOptions<T>
): Promise<T> {
  const { operation, context, retryOptions = {}, onError, onFailure, idempotent = true } = options;

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

        // Non-idempotent writes must NOT auto-retry an ambiguous network failure:
        // the request may already have reached the server and committed, so a
        // retry would duplicate it (e.g. a second turn / a second case). Surface
        // it instead — the user gets a manual retry affordance and can see whether
        // it landed.
        if (!idempotent && classifiedError.category === 'network') {
          return false;
        }

        // Use the recovery strategy from the error
        const strategy = classifiedError.recovery;
        
        switch (strategy) {
          case 'retry_with_backoff':
          case 'auto_retry_with_delay':
            return true;
          
          case 'manual_retry':
          case 'logout_and_redirect':
          case 'user_fix_required':
          case 'show_modal':
          case 'graceful_degradation':
          case 'rollback_and_retry':
            return false;
            
          default:
            return false;
        }
      },
      
      onRetry: (error, attempt, delay) => {
        if (retryOptions.onRetry) {
          retryOptions.onRetry(error, attempt, delay);
        }
      }
    });
  } catch (finalError) {
    const classifiedError = ErrorClassifier.classify(finalError, context);
    
    if (onFailure) {
      onFailure(classifiedError);
    }
    
    throw classifiedError;
  }
}
