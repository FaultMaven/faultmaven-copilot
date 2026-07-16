import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareBody, authenticatedFetch } from '../../lib/api/client';
import { AuthenticationError } from '../../lib/errors/types';

// --- Mocks for the authenticatedFetch catch-path test ---
const clearAllAuthData = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/auth/auth-manager', () => ({
  authManager: { clearAllAuthData: () => clearAllAuthData() }
}));
vi.mock('../../lib/api/fetch-utils', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({})
}));
vi.mock('../../lib/api/session-core', () => ({
  refreshSession: vi.fn().mockResolvedValue(undefined)
}));
const fetchWithTimeout = vi.fn();
vi.mock('../../lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: any[]) => fetchWithTimeout(...args)
}));
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { remove: vi.fn().mockResolvedValue(undefined) } } }
}));

describe('authenticatedFetch — error branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: a hard 401 threw AuthenticationError inside the try, which the
  // catch then rebranded to 'NetworkError' (no `status`, not a TimeoutError).
  // The async-turn poll loop keys its terminal check on err.name, so the
  // mislabelled error looked retryable and a hard 401 was retried instead of
  // aborting. UserFacingError instances must propagate with name intact.
  it('preserves AuthenticationError on a hard 401 (does not rebrand to NetworkError)', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ detail: 'Unauthorized' })
    } as any);

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toMatchObject({
      name: 'AuthenticationError'
    });
    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });
});

describe('prepareBody', () => {
  describe('undefined → null conversion (Safety Net)', () => {
    it('should convert undefined field values to null', () => {
      const input = { name: 'test', title: undefined };
      const result = prepareBody(input);

      expect(result).toBe('{"name":"test","title":null}');
      expect(JSON.parse(result!)).toEqual({ name: 'test', title: null });
    });

    it('should convert nested undefined values to null', () => {
      const input = {
        outer: {
          inner: undefined,
          value: 'exists'
        }
      };
      const result = prepareBody(input);

      const parsed = JSON.parse(result!);
      expect(parsed.outer.inner).toBeNull();
      expect(parsed.outer.value).toBe('exists');
    });

    it('should convert undefined array elements to null', () => {
      const input = { items: [1, undefined, 3] };
      const result = prepareBody(input);

      const parsed = JSON.parse(result!);
      expect(parsed.items).toEqual([1, null, 3]);
    });
  });

  describe('null preservation', () => {
    it('should preserve explicit null values', () => {
      const input = { title: null, priority: 'medium' };
      const result = prepareBody(input);

      expect(result).toBe('{"title":null,"priority":"medium"}');
    });
  });

  describe('edge cases', () => {
    it('should return undefined for null input', () => {
      expect(prepareBody(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(prepareBody(undefined)).toBeUndefined();
    });

    it('should handle empty objects', () => {
      expect(prepareBody({})).toBe('{}');
    });

    it('should handle primitive values', () => {
      expect(prepareBody('string')).toBe('"string"');
      expect(prepareBody(123)).toBe('123');
      expect(prepareBody(true)).toBe('true');
    });

    it('should handle arrays', () => {
      expect(prepareBody([1, 2, 3])).toBe('[1,2,3]');
    });
  });

  describe('CreateCaseRequest simulation', () => {
    it('should correctly serialize CreateCaseRequest with null title', () => {
      // Simulates the actual use case for Case-MMDD-N auto-generation
      const request = {
        title: null,
        priority: 'medium',
        metadata: { created_via: 'browser_extension' }
      };

      const result = prepareBody(request);
      const parsed = JSON.parse(result!);

      expect(parsed.title).toBeNull();
      expect(parsed.priority).toBe('medium');
      expect(parsed.metadata.created_via).toBe('browser_extension');
    });

    it('should correctly serialize CreateCaseRequest with explicit title', () => {
      const request = {
        title: 'My Custom Title',
        priority: 'high'
      };

      const result = prepareBody(request);
      const parsed = JSON.parse(result!);

      expect(parsed.title).toBe('My Custom Title');
    });
  });
});
