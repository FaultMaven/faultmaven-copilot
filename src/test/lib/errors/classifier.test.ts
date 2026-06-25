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
});
