import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareBody, authenticatedFetch } from '@faultmaven/copilot-ui/lib/api/client';
import { AuthenticationError, SessionExpiredError } from '@faultmaven/copilot-ui/lib/errors/types';
import { getAuthHeaders } from '@faultmaven/copilot-ui/lib/api/fetch-utils';

// --- Mocks for the authenticatedFetch catch-path test ---
// The hard-401 teardown is the HOST's now: the client reports a rejected
// credential and clears nothing itself. `onUnauthorized` is what it reports to.
const onUnauthorized = vi.fn().mockResolvedValue(undefined);
const clearSession = vi.fn().mockResolvedValue(undefined);
const storedSessionId = vi.fn().mockResolvedValue(null);
vi.mock('../../extension/auth/auth-manager', () => ({
  authManager: { clearAllAuthData: vi.fn() }
}));
vi.mock('@faultmaven/copilot-ui/lib/api/fetch-utils', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({})
}));
vi.mock('@faultmaven/copilot-ui/lib/api/session-core', () => ({
  refreshSession: vi.fn().mockResolvedValue(undefined)
}));
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: any[]) => fetchWithTimeout(...args)
}));
// The synchronous fence handleAuthError raises before tearing down, so an
// in-flight writer whose continuation is already queued skips its post-await
// writes instead of repopulating state that is about to be cleared.
const bumpEpoch = vi.fn().mockReturnValue(1);
vi.mock('@faultmaven/copilot-ui/lib/state/session-epoch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bumpEpoch: () => bumpEpoch(),
}));
const storageRemove = vi.fn().mockResolvedValue(undefined);
const storageGet = vi.fn().mockResolvedValue({});
vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { remove: (...a: any[]) => storageRemove(...a), get: (...a: any[]) => storageGet(...a) } } }
}));

import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';

// File-level, not per-suite: every suite here drives authenticatedFetch, and a
// suite without a transport would silently fall through to the shared default.
beforeEach(() => {
  storedSessionId.mockResolvedValue(null);
  setApiTransport({
    baseUrl: async () => 'http://localhost:8090',
    accessToken: async () => 'test-token',
    sessionId: () => storedSessionId(),
    clearSession: () => clearSession(),
    onUnauthorized: () => onUnauthorized(),
  });
});

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
    expect(onUnauthorized).toHaveBeenCalled();
  });

  // The revoked-token case, which account-scoped logout (faultmaven#1065) turned
  // from a rare admin action into what a sign-out on the OTHER client does to
  // this one. The teardown has to fence BEFORE it clears: a turn already
  // in flight resumes after its await and would otherwise write the previous
  // user's message back into a store that had just been emptied.
  it('fences in-flight writers before clearing, on a revoked credential', async () => {
    (getAuthHeaders as any).mockResolvedValue({ Authorization: 'Bearer revoked-token' });
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ detail: 'Token has been revoked. Please re-authenticate.' })
    } as any);

    await expect(authenticatedFetch('/api/v1/cases/abc/turns')).rejects.toBeInstanceOf(
      AuthenticationError
    );

    // Both, and in this order. Clearing without fencing leaves the race open;
    // fencing without clearing leaves a dead credential attached to every
    // later request.
    expect(bumpEpoch).toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalled();
    expect(bumpEpoch.mock.invocationCallOrder[0]).toBeLessThan(
      onUnauthorized.mock.invocationCallOrder[0]
    );
  });

  // A revoked token reaches the client as 401 on every route since #1065's
  // status fix. Before it, session routes answered 403, which classifies as a
  // permission problem: no teardown, tokens kept, and the panel rendered
  // "Access Denied. Contact your administrator." at a signed-out user.
  it('does not tear down on a 403, which is authorization and not a dead credential', async () => {
    (getAuthHeaders as any).mockResolvedValue({ Authorization: 'Bearer live-token' });
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ detail: 'Forbidden' })
    } as any);

    await expect(authenticatedFetch('/api/v1/admin/cases')).rejects.toMatchObject({
      status: 403
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(bumpEpoch).not.toHaveBeenCalled();
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
    expect(onUnauthorized).not.toHaveBeenCalled();
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
    storedSessionId.mockResolvedValue('S1');
    fetchWithTimeout.mockResolvedValue(sessionExpired);

    await expect(authenticatedFetch('/api/v1/whatever')).rejects.toBeInstanceOf(SessionExpiredError);
    // Which keys a stale session occupies is the host's business now; the client
    // asks for it to be cleared and nothing more.
    expect(clearSession).toHaveBeenCalled();
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

// The backend's protection middleware answers with `ProtectionErrorResponse`,
// which has no `detail` field at all — the text is in `message`. Reading only
// `detail` meant a rate-limited request reported a fabricated generic string
// and the server's own explanation was discarded (fm#994).
//
// These two are the mutation guard for the change: delete `errorBodyText`'s
// `message` branch, or revert either call site to `errorData.detail || …`, and
// they fail. Before them the whole suite stayed green either way.
describe('authenticatedFetch — protection-shaped error bodies (fm#994)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthHeaders as any).mockResolvedValue({});
    storageGet.mockResolvedValue({});
  });

  it('surfaces the server text from a 429 that carries `message` and no `detail`', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '60' : null) },
      json: async () => ({
        error: 'rate_limit_exceeded',
        message: 'Rate limit exceeded: per_session_read (121/120)',
        retry_after: 60
      })
    } as any);

    await expect(authenticatedFetch('/api/v1/cases/abc/ui')).rejects.toMatchObject({
      name: 'RateLimitError',
      status: 429,
      retryAfter: 60,
      message: 'Rate limit exceeded: per_session_read (121/120)'
    });
  });

  it('surfaces the server text from a non-429 body that carries `message`', async () => {
    // Deduplication answers 409 in the same shape.
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({ error: 'duplicate_request', message: 'Duplicate request detected' })
    } as any);

    await expect(authenticatedFetch('/api/v1/cases/abc/turns')).rejects.toMatchObject({
      name: 'HTTPError',
      status: 409,
      message: 'Duplicate request detected'
    });
  });

  it('still prefers `detail` when the body is FastAPI-shaped', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ detail: 'Case not found' })
    } as any);

    await expect(authenticatedFetch('/api/v1/cases/nope')).rejects.toMatchObject({
      message: 'Case not found'
    });
  });

  it('falls back to its own text when the body carries neither', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ error: 'internal' })
    } as any);

    await expect(authenticatedFetch('/api/v1/cases')).rejects.toMatchObject({
      message: 'HTTP 500'
    });
  });
});
