import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareBody, authenticatedFetch } from '../../lib/api/client';
import { AuthenticationError, SessionExpiredError } from '../../lib/errors/types';
import { getAuthHeaders } from '../../lib/api/fetch-utils';

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
const storageRemove = vi.fn().mockResolvedValue(undefined);
const storageGet = vi.fn().mockResolvedValue({});
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { remove: (...a: any[]) => storageRemove(...a), get: (...a: any[]) => storageGet(...a) } } }
}));

describe('authenticatedFetch — error branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthHeaders as any).mockResolvedValue({});
    storageGet.mockResolvedValue({});
  });

  // Regression: a hard 401 threw AuthenticationError inside the try, which the
  // catch then rebranded to 'NetworkError' (no `status`, not a TimeoutError).
  // The async-turn poll loop keys its terminal check on err.name, so the
  // mislabelled error looked retryable and a hard 401 was retried instead of
  // aborting. UserFacingError instances must propagate with name intact.
  it('preserves AuthenticationError on a credential-present hard 401 (does not rebrand to NetworkError)', async () => {
    // A hard 401 means "the credential we SENT is invalid" — attach one.
    (getAuthHeaders as any).mockResolvedValue({ Authorization: 'Bearer live-token' });
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
    expect(clearAllAuthData).toHaveBeenCalled();
  });

  // Regression: issue #99 — a 401 on a request that carried NO Authorization
  // header (getAuthHeaders returned none during a transient refresh outage that
  // deliberately preserved the tokens) must NOT trigger the hard-auth teardown
  // that destroys the still-valid refresh_token. It is treated as a recoverable
  // session-expired condition instead, so the credential survives to recover.
  it('does NOT tear down auth on a 401 when no Authorization header was sent (#99)', async () => {
    (getAuthHeaders as any).mockResolvedValue({}); // no credential attached
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ detail: 'Unauthorized' })
    } as any);

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(
      SessionExpiredError
    );
    // The refresh_token-destroying teardown must NOT have run.
    expect(clearAllAuthData).not.toHaveBeenCalled();
  });
});

// Regression: issue #104 — handleSessionExpired must compare-and-remove so a
// late 401 carrying an OLD session id can't wipe a session a concurrent refresh
// already rotated to a fresh one.
describe('authenticatedFetch — session-expired compare-and-remove (#104)', () => {
  const sessionExpired = {
    ok: false,
    status: 401,
    headers: { get: () => null },
    json: async () => ({ code: 'SESSION_EXPIRED' })
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT clear storage when a late 401 carries a superseded session id', async () => {
    (getAuthHeaders as any).mockResolvedValue({ 'X-Session-Id': 'S1' }); // request carried old S1
    storageGet.mockResolvedValue({ sessionId: 'S2' });                   // storage already rotated to S2
    fetchWithTimeout.mockResolvedValue(sessionExpired);

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(SessionExpiredError);
    // The fresh S2 must survive.
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('clears storage when the 401 carries the still-current session id', async () => {
    (getAuthHeaders as any).mockResolvedValue({ 'X-Session-Id': 'S1' });
    storageGet.mockResolvedValue({ sessionId: 'S1' });
    fetchWithTimeout.mockResolvedValue(sessionExpired);

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(storageRemove).toHaveBeenCalledWith(['sessionId', 'sessionCreatedAt', 'sessionResumed']);
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
