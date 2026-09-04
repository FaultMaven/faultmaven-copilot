/**
 * A host that refreshed the credential must not get a "session expired" modal.
 *
 * The client reported a 401 to the host and then threw `AuthenticationError`
 * regardless of what the host did about it. A host that successfully renewed
 * the credential — the Dashboard, which owns its own token chain — kept the
 * session and still saw a blocking modal whose only action wiped the panel
 * while the surrounding app stayed signed in.
 *
 * So the host answers, and the client believes it: `'refreshed'` is retried
 * once with the new bearer, `'ended'` surfaces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticatedFetch } from '@faultmaven/copilot-ui/lib/api/client';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import type { AuthOutcome } from '@faultmaven/copilot-ui/lib/api/transport';

const unauthorized = () =>
  ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    json: async () => ({ detail: 'Unauthorized' }),
  }) as unknown as Response;

const ok = () =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ fine: true }),
  }) as unknown as Response;

function install(outcome: AuthOutcome, tokens: string[]) {
  const onUnauthorized = vi.fn(async () => outcome);
  let call = 0;
  setApiTransport({
    baseUrl: async () => 'https://api.test',
    accessToken: async () => tokens[Math.min(call++, tokens.length - 1)],
    sessionId: async () => null,
    clearSession: async () => {},
    onUnauthorized,
  });
  return { onUnauthorized };
}

const bearerOf = (call: unknown[]) => {
  const init = call[1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  return Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
};

describe('onUnauthorized decides what a 401 means', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("'refreshed' retries ONCE with the new bearer and surfaces nothing", async () => {
    const { onUnauthorized } = install('refreshed', ['stale-token', 'fresh-token']);
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
    global.fetch = fetchMock as never;

    const response = await authenticatedFetch('https://api.test/api/v1/cases');

    expect(response.status).toBe(200);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry carried the credential the host had just minted, not the one
    // that was rejected — a retry with the stale bearer would 401 forever.
    expect(bearerOf(fetchMock.mock.calls[0])).toBe('Bearer stale-token');
    expect(bearerOf(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it("'ended' surfaces, as it always did", async () => {
    const { onUnauthorized } = install('ended', ['stale-token']);
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    global.fetch = fetchMock as never;

    await expect(authenticatedFetch('https://api.test/api/v1/cases')).rejects.toThrow(
      /Authentication required/,
    );
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The retry is a retry, not a loop: a request still rejected with a freshly
  // minted bearer is a real rejection, and looping would hammer the host's
  // refresh path.
  it("a 401 on the retry surfaces rather than refreshing again", async () => {
    const { onUnauthorized } = install('refreshed', ['stale-token', 'fresh-token']);
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    global.fetch = fetchMock as never;

    await expect(authenticatedFetch('https://api.test/api/v1/cases')).rejects.toThrow();

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
