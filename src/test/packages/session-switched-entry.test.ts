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
import { describe, it, expect, afterEach } from 'vitest';
import * as entry from '@faultmaven/copilot-ui';
import { SessionSwitchedError } from '@faultmaven/copilot-ui/lib/errors/types';
import { getAuthHeaders } from '@faultmaven/copilot-ui/lib/api/fetch-utils';

afterEach(() => {
  entry.clearApiTransport();
});

describe('SessionSwitchedError through the package entry', () => {
  it('is exported, and is the same class the request path checks', () => {
    expect(entry.SessionSwitchedError).toBe(SessionSwitchedError);
  });

  it('thrown by a host that has only the entry, stops the request', async () => {
    entry.setApiTransport({
      baseUrl: async () => 'http://localhost:8090',
      accessToken: async () => {
        throw new entry.SessionSwitchedError();
      },
      sessionId: async () => null,
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });

    await expect(getAuthHeaders()).rejects.toBeInstanceOf(SessionSwitchedError);
  });

  it('says nothing only one host does — and offers no sign-in', () => {
    // The extension re-scopes its panel; the Dashboard ends the tab. And a
    // sign-in prompt is what the `notice` category exists to avoid: acting on
    // it signs the NEW account out.
    const { userTitle, userMessage, userAction } = new entry.SessionSwitchedError();
    const copy = `${userTitle} ${userMessage} ${userAction}`;

    expect(copy).not.toMatch(/panel|tab|extension|dashboard|switching/i);
    expect(copy).not.toMatch(/\bsign[ -]?in\b/i);
  });
});
