import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resilientOperation } from '~lib/utils/resilient-operation';
import { ErrorClassifier } from '~lib/errors/classifier';
import { RateLimitError } from '~lib/errors/types';

describe('resilientOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result on successful operation', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    
    const result = await resilientOperation({
      operation,
      context: { operation: 'test' }
    });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    // Network error -> retryable
    const operation = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('success_on_retry');
      
    const onError = vi.fn();
    
    const promise = resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 3, initialDelay: 10 },
      onError
    });
    
    // Advance timers for the retry delay
    await vi.runAllTimersAsync();
    
    const result = await promise;
    
    expect(result).toBe('success_on_retry');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    const errorPassedToOnError = onError.mock.calls[0][0];
    expect(errorPassedToOnError.category).toBe('network');
  });

  it('should NOT retry on non-retryable errors', async () => {
    // Auth error (401) -> non-retryable
    const authError = new Error('Unauthorized');
    (authError as any).status = 401;
    
    const operation = vi.fn().mockRejectedValue(authError);
    const onError = vi.fn();
    const onFailure = vi.fn();
    
    await expect(resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 3 },
      onError,
      onFailure
    })).rejects.toThrow();
    
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    
    const errorPassedToOnFailure = onFailure.mock.calls[0][0];
    expect(errorPassedToOnFailure.category).toBe('authentication');
  });

  it('does NOT retry a NetworkError for a non-idempotent write (avoids duplicate POST)', async () => {
    // A network error on a POST is ambiguous — the request may already have
    // reached the server and committed. Retrying would duplicate the turn.
    const operation = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const onFailure = vi.fn();

    const promise = resilientOperation({
      operation,
      context: { operation: 'turn_submit' },
      idempotent: false,
      retryOptions: { maxAttempts: 3, initialDelay: 10 },
      onFailure
    });
    const resultPromise = promise.catch(e => e);
    await vi.runAllTimersAsync();
    const caught = await resultPromise;

    expect(caught).toBeDefined();
    expect(operation).toHaveBeenCalledTimes(1); // NOT retried
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].category).toBe('network');
  });

  it('STILL retries a rejection (429) for a non-idempotent write (request was not processed)', async () => {
    // A 429 means the server rejected the request without processing it, so a
    // retry cannot duplicate — non-idempotent ops must still retry these.
    const rateLimit = new Error('Too Many Requests');
    (rateLimit as any).status = 429;
    const operation = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('ok');

    const promise = resilientOperation({
      operation,
      context: { operation: 'turn_submit' },
      idempotent: false,
      retryOptions: { maxAttempts: 3, initialDelay: 10 }
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After on a 429: waits the server window, not just the generic backoff', async () => {
    // 429 with a Retry-After of 5s. The generic exponential backoff (100ms here)
    // is far shorter; without Retry-After wiring the retry would fire after ~100ms
    // and be wasted inside the server's window.
    const rateLimit = new Error('Too Many Requests');
    (rateLimit as any).status = 429;
    (rateLimit as any).retryAfter = 5; // seconds -> retryAfterMs = 5000
    const operation = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('ok');

    const promise = resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 3, initialDelay: 100 }
    });

    // Only the generic backoff has elapsed — the Retry-After window is still open,
    // so the operation must NOT have been retried yet.
    await vi.advanceTimersByTimeAsync(100);
    expect(operation).toHaveBeenCalledTimes(1);

    // Advance past the remainder of the Retry-After window; now the retry fires.
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does NOT auto-retry a 429 whose window is longer than we will wait', async () => {
    // An hourly bucket refusing a turn carries an honest Retry-After of up to
    // 3600s: the server has measured that no quota frees until then. Retrying
    // before that instant is refused by construction, so the old behaviour
    // (clamp to 60s and retry anyway) spent every remaining attempt on
    // guaranteed refusals and took two minutes to report a failure it knew
    // about immediately. The wait must be surfaced, not slept on.
    const rateLimit = new Error('Too Many Requests');
    (rateLimit as any).status = 429;
    (rateLimit as any).retryAfter = 3600; // seconds — a full hourly window
    const operation = vi.fn().mockRejectedValue(rateLimit);
    const onFailure = vi.fn();

    const promise = resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 3, initialDelay: 100 },
      onFailure
    });
    const settled = promise.catch(e => e);

    await vi.runAllTimersAsync();
    const caught = await settled;

    // One attempt only — no second request inside a window that cannot have freed.
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    // And it fails with the wait intact, so the UI can state it.
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfterMs).toBe(3_600_000);
  });

  it('still bounds the honored wait when a caller overrides shouldRetry', async () => {
    // `retryOptions.shouldRetry` is checked before the recovery strategy, so an
    // override can force a retry the strategy declined. The clamp is what keeps
    // that path from parking the operation on the raw hour-long header.
    const rateLimit = new Error('Too Many Requests');
    (rateLimit as any).status = 429;
    (rateLimit as any).retryAfter = 999999; // seconds — ~11.5 days
    const operation = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('ok');

    const promise = resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 3, initialDelay: 100, shouldRetry: () => true }
    });

    // Not retried inside the clamp window...
    await vi.advanceTimersByTimeAsync(59_000);
    expect(operation).toHaveBeenCalledTimes(1);

    // ...but the retry fires once the 60s bound elapses (well before the raw value).
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should fail after max retries and call onFailure', async () => {
    const networkError = new TypeError('Failed to fetch');
    const operation = vi.fn().mockRejectedValue(networkError);
    const onError = vi.fn();
    const onFailure = vi.fn();
    
    const promise = resilientOperation({
      operation,
      context: { operation: 'test' },
      retryOptions: { maxAttempts: 2, initialDelay: 10 },
      onError,
      onFailure
    });
    
    // Attach catch handler immediately to prevent UnhandledPromiseRejection during timer ticks
    const resultPromise = promise.catch(e => e);
    
    await vi.runAllTimersAsync();
    const caughtError = await resultPromise;
    
    expect(caughtError).toBeDefined();
    
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
