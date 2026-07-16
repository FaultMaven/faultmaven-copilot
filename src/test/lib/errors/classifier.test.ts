import { describe, it, expect } from 'vitest';
import { ErrorClassifier } from '~lib/errors/classifier';
import { UserFacingError } from '~lib/errors/types';

describe('ErrorClassifier', () => {
  it('should map 401 to Authentication error', () => {
    const error = new Error('Unauthorized');
    (error as any).status = 401;
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('authentication');
    expect(classified.recovery).toBe('show_modal');
  });

  // 403 is authorization, not authentication. It must NOT be classified as an
  // AuthenticationError (which drives a blocking sign-in modal + forced logout).
  it('should map 403 to a non-logout Permission error', () => {
    const error = new Error('Forbidden');
    (error as any).status = 403;
    const classified = ErrorClassifier.classify(error);

    expect(classified.category).toBe('authorization');
    expect(classified.recovery).toBe('graceful_degradation');
    // Not blocking, not a modal — a 403 should never look like "session expired".
    const display = (classified as any).getDisplayOptions();
    expect(display.displayType).not.toBe('modal');
    expect(display.blocking).not.toBe(true);
  });

  // A numeric status is authoritative: a 403 must classify as PermissionError
  // even when its message contains an auth-sounding phrase, otherwise the
  // message heuristic would shadow it back into a forced-logout AuthenticationError.
  it('should classify a 403 by status even if its message mentions authentication', () => {
    const error = new Error('Authentication required: insufficient permissions');
    (error as any).status = 403;
    const classified = ErrorClassifier.classify(error);

    expect(classified.category).toBe('authorization');
  });

  it('should map 429 to Rate Limit error', () => {
    const error = new Error('Too Many Requests');
    (error as any).status = 429;
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('rate_limit');
    expect(classified.recovery).toBe('auto_retry_with_delay');
  });

  it('should map 500 to Server error', () => {
    const error = new Error('Internal Server Error');
    (error as any).status = 500;
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('server');
    expect(classified.recovery).toBe('manual_retry');
  });

  it('should detect network errors via message', () => {
    const error = new Error('Failed to fetch');
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('network');
    expect(classified.recovery).toBe('retry_with_backoff');
  });

  it('should detect TypeError as network error (fetch failure)', () => {
    const error = new TypeError('Failed to fetch');
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('network');
    expect(classified.recovery).toBe('retry_with_backoff');
  });

  it('should detect timeout errors', () => {
    const error = new Error('Timeout');
    error.name = 'AbortError';
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('timeout');
    expect(classified.recovery).toBe('manual_retry');
  });

  it('should map 422 to Validation error and extract fields if possible', () => {
    const error = new Error('Unprocessable Entity');
    (error as any).status = 422;
    (error as any).response = {
      data: {
        detail: [{ loc: ['body', 'email'], msg: 'Invalid email format' }]
      }
    };
    
    const classified = ErrorClassifier.classify(error);
    
    expect(classified.category).toBe('validation');
    expect(classified.recovery).toBe('user_fix_required');
    expect(classified.userMessage).toContain('Invalid email format');
  });

  it('should pass through already-classified UserFacingError', () => {
    const originalError = new Error('API Error');
    (originalError as any).status = 401;
    const classifiedFirst = ErrorClassifier.classify(originalError);

    const classifiedSecond = ErrorClassifier.classify(classifiedFirst);
    expect(classifiedSecond).toBe(classifiedFirst);
  });

  // Billing / quota exhaustion (case_b639fac38fe0): the AI provider is out of
  // credits — a permanent, operator-actionable condition. It must NOT be shown
  // as a generic server error with a futile "Retry" button.
  it('should map 402 to QuotaExhausted (billing) error with no auto-retry', () => {
    const error = new Error('AI provider is out of quota or credits');
    (error as any).status = 402;
    const classified = ErrorClassifier.classify(error);

    expect(classified.category).toBe('billing');
    expect(classified.recovery).toBe('graceful_degradation');
    expect(classified.userMessage.toLowerCase()).toContain('credit');
  });

  it('should map x-error-code QUOTA_EXHAUSTED to billing error regardless of status', () => {
    // Direct HttpError path preserves the x-error-code header.
    const error: any = new Error('quota exhausted');
    error.status = 500; // even if status is generic, the code is authoritative
    error.headers = { 'x-error-code': 'QUOTA_EXHAUSTED' };
    const classified = ErrorClassifier.classify(error);

    expect(classified.category).toBe('billing');
    expect(classified.recovery).toBe('graceful_degradation');
  });

  it('should not classify a plain 429 as billing', () => {
    const error = new Error('Too Many Requests');
    (error as any).status = 429;
    const classified = ErrorClassifier.classify(error);

    expect(classified.category).toBe('rate_limit');
  });
});
