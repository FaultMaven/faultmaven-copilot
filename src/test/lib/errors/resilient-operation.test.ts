import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resilientOperation } from '~lib/utils/resilient-operation';
import { ErrorClassifier } from '~lib/errors/classifier';

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
