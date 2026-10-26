/**
 * A host that still holds this user's session but has no credential right now
 * (an expired token while its renewal endpoint is down) throws
 * `CredentialUnavailableError` from `accessToken()`, and the request is NOT
 * SENT (faultmaven#1460).
 *
 * Sent with no bearer instead, its 401 read as an expired session: "Sign in
 * first" in a host that was still signed in (faultmaven-dashboard#257). The
 * Dashboard reaches the package through its entry alone, so the entry exports
 * the very class `getAuthHeaders` checks with `instanceof`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as entry from '@faultmaven/copilot-ui';
import { CredentialUnavailableError, SessionExpiredError } from '@faultmaven/copilot-ui/lib/errors/types';
import { authenticatedFetch } from '@faultmaven/copilot-ui/lib/api/client';
import { getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';

const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const CASES = 'http://localhost:8090/api/v1/cases';
const hostThrowing = (error: () => Error) =>
  entry.setApiTransport({
    baseUrl: async () => 'http://localhost:8090',
    accessToken: async () => {
      throw error();
    },
    sessionId: async () => null,
    clearSession: async () => undefined,
    onUnauthorized: async () => 'ended' as const,
  });

beforeEach(() => {
  // The server refuses a request that carries no bearer.
  fetchWithTimeout.mockResolvedValue({
    ok: false,
    status: 401,
    headers: new Headers(),
    json: async () => ({ detail: 'Not authenticated' }),
  });
});

afterEach(() => {
  entry.clearApiTransport();
  fetchWithTimeout.mockReset();
});

describe('CredentialUnavailableError from a host', () => {
  it('is exported by the entry, as the same class the request path checks', () => {
    expect(entry.CredentialUnavailableError).toBe(CredentialUnavailableError);
  });

  it('thrown by accessToken(), the request is NOT SENT', async () => {
    hostThrowing(() => new CredentialUnavailableError());

    await expect(authenticatedFetch(CASES, { method: 'POST' })).rejects.toBeInstanceOf(CredentialUnavailableError);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  // An invariant pin, green before the fix too: the host ended nothing.
  it('moves no session epoch', async () => {
    hostThrowing(() => new CredentialUnavailableError());
    const before = getEpoch();

    await authenticatedFetch(CASES, { method: 'POST' }).catch(() => undefined);

    expect(getEpoch()).toBe(before);
  });

  // The positive control: any other throw keeps the not-signed-in path.
  it('a plain throw still sends the request, with no bearer', async () => {
    hostThrowing(() => new Error('signed out'));

    await expect(authenticatedFetch(CASES, { method: 'POST' })).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
});
