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

  // The API client parses the Retry-After header and exposes it as
  // `error.retryAfter` in SECONDS. The classifier must honour it rather than
  // silently falling back to the 5s default (regression: it previously only
  // read `error.response.headers`, which the client never populates on a 429).
  it('should honour the client-parsed Retry-After for a 429', () => {
    const error = new Error('Too Many Requests');
    (error as any).status = 429;
    (error as any).retryAfter = 30; // seconds, as set by client.ts
    const classified = ErrorClassifier.classify(error) as any;

    expect(classified.category).toBe('rate_limit');
    expect(classified.retryAfterMs).toBe(30000);
  });

  it('falls back to the 5s default when no Retry-After is present', () => {
    const error = new Error('Too Many Requests');
    (error as any).status = 429;
    const classified = ErrorClassifier.classify(error) as any;

    expect(classified.retryAfterMs).toBe(5000);
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

// `extractFieldErrors` deliberately reads only `detail`, not the protection
// middleware's `message`. That rests on a premise, not a coincidence: the method
// is reached only from `classifyHttpError` for 400 and 422, and no backend body
// at those statuses uses `message` — FastAPI's own validation handler, the
// ValidationException handler and the idempotency middleware's 400 all send
// `detail`. `message` is the ProtectionErrorResponse shape, emitted only at 409,
// 429 and 503. A `message` fallback there would be an unreachable branch, which
// reads as coverage that is not there (fm#994, review finding 3).
//
// These pin the premise: if a protection-shaped body ever started reaching field
// extraction, the removal would need revisiting and this fails first.
describe('ErrorClassifier — protection-shaped bodies are not validation errors', () => {
  const protectionBody = {
    error: 'rate_limit_exceeded',
    message: 'Rate limit exceeded: per_session_read (121/120)',
    retry_after: 60
  };

  /**
   * An error shaped the way `client.ts` actually brands one.
   *
   * It must be a real Error: `ErrorClassifier.isHttpError` requires
   * `instanceof Error`, so a plain object literal falls straight through to
   * UnknownError and every negative assertion below would pass without ever
   * exercising the status path.
   */
  function brandedHttpError(status: number, body: any, retryAfter?: number): Error {
    const error: any = new Error(body.message ?? body.detail ?? 'error');
    error.name = status === 429 ? 'RateLimitError' : 'HTTPError';
    error.status = status;
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
    error.response = { data: body };
    return error;
  }

  it('the fixture really does reach the status path', () => {
    // Guards the guard. If branding changes and these stop being seen as HTTP
    // errors, the assertions below go vacuous instead of failing.
    expect(ErrorClassifier.classify(brandedHttpError(429, protectionBody, 60)).category)
      .not.toBe('unknown');
  });

  it('classifies a 429 carrying `message` as a rate limit, not a validation error', () => {
    const classified: any = ErrorClassifier.classify(brandedHttpError(429, protectionBody, 60));

    expect(classified.category).toBe('rate_limit');
    expect(classified).toBeInstanceOf(UserFacingError);
    expect(classified.fieldErrors).toBeUndefined();
    // The server's own text survives classification.
    expect(classified.message).toBe(protectionBody.message);
  });

  it.each([409, 503])('does not route a %i carrying `message` into field extraction', status => {
    const classified: any = ErrorClassifier.classify(brandedHttpError(status, protectionBody));

    // NOT asserted: that the category isn't 'validation'. A 409 is
    // CaseVersionConflictError, which *is* categorised validation — it simply
    // has its own `case 409` arm and never calls extractFieldErrors. The claim
    // that matters is the absence of extracted field errors, not the label.
    expect(classified.category).not.toBe('unknown');
    expect(classified.fieldErrors).toBeUndefined();
    expect(classified.message).toBe(protectionBody.message);
  });

  it('still extracts a string `detail` at 422, which is the shape that arrives there', () => {
    const fieldErrors = ErrorClassifier.extractFieldErrors(
      brandedHttpError(422, { detail: 'title must not be empty' })
    );
    expect(fieldErrors).toEqual({ general: 'title must not be empty' });
  });

  it('extracts nothing from a protection-shaped body — the branch that was removed', () => {
    expect(ErrorClassifier.extractFieldErrors(brandedHttpError(429, protectionBody))).toEqual({});
  });
});
