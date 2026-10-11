/**
 * `SessionSwitchedError` is reachable through the package ENTRY, as the very
 * class the request path checks, and its copy is true in every host
 * (faultmaven-dashboard#212).
 *
 * The extension imports the class by path; the Dashboard may not — it reaches
 * the package through its entry alone, by one dynamic import. Without the
 * export it cannot throw the error at all, so a refused request goes out
 * header-less instead of not at all. And a COPY of the class would compile and
 * pass every test that only checks the name, while `getAuthHeaders`'
 * `instanceof` let the request through.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as entry from '@faultmaven/copilot-ui';
import { SessionSwitchedError } from '@faultmaven/copilot-ui/lib/errors/types';
import { authenticatedFetch } from '@faultmaven/copilot-ui/lib/api/client';

const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

afterEach(() => {
  entry.clearApiTransport();
  fetchWithTimeout.mockReset();
});

describe('SessionSwitchedError through the package entry', () => {
  it('is exported, and is the same class the request path checks', () => {
    // Identity, not a subclass or a look-alike: either would pass a test that
    // only checks `instanceof` against the original.
    expect(entry.SessionSwitchedError).toBe(SessionSwitchedError);
  });

  it('thrown by a host that has only the entry, the request is NOT SENT', async () => {
    entry.setApiTransport({
      baseUrl: async () => 'http://localhost:8090',
      accessToken: async () => {
        throw new entry.SessionSwitchedError();
      },
      sessionId: async () => null,
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });

    await expect(authenticatedFetch('http://localhost:8090/api/v1/cases', { method: 'POST' })).rejects.toBeInstanceOf(
      SessionSwitchedError,
    );
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('reassures, and asks for nothing only one host could honour', () => {
    // No host mechanism: the extension re-scopes its panel; the Dashboard ends
    // the tab. No sign-in: acting on it signs the NEW account out. No resend:
    // the panel is the other account's or gone by then, so a resend goes out
    // AS the other account — the write this error exists to stop.
    const { userTitle, userMessage, userAction } = new entry.SessionSwitchedError();
    const copy = `${userTitle} ${userMessage} ${userAction}`;

    expect(copy).not.toMatch(/\b(panel|tab|extension|dashboard|switching)\b/i);
    expect(copy).not.toMatch(/\b(sign|log)\s*(back\s+)?(in|on)\b|\bre-?auth/i);
    expect(copy).not.toMatch(/\b(send|submit|try)\b[^.]*\bagain\b|\bresend\b|\bretry\b/i);
  });
});
