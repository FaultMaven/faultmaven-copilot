/**
 * The API origin a host supplies has to be absolute.
 *
 * Request sites build their URLs with `new URL(`${baseUrl}/api/v1/…`)`, which
 * throws on a relative value. A same-origin deployment configures the empty
 * string — the most natural way to say "wherever this page is served from" —
 * and the result was not an error anyone could see: the transcript rendered
 * empty, the case list never arrived, async turns never polled, and the
 * capabilities probe hit the SPA's catch-all rewrite and fell back to a
 * fabricated feature set.
 *
 * So the transport refuses the value, at the request that used it, naming the
 * value and the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setApiTransport,
  getApiTransport,
  clearApiTransport,
  type ApiTransport,
} from '@faultmaven/copilot-ui/lib/api/transport';

const transportWithBase = (baseUrl: string): ApiTransport => ({
  baseUrl: async () => baseUrl,
  accessToken: async () => 'token',
  sessionId: async () => null,
  clearSession: async () => {},
  onUnauthorized: () => 'ended' as const,
});

describe('the host must supply an absolute API origin', () => {
  beforeEach(() => {
    clearApiTransport();
  });

  it.each([
    ['the same-origin empty string', ''],
    ['a root path', '/'],
    ['an api path', '/api'],
    ['a protocol-relative host', '//api.faultmaven.ai'],
    ['a bare host', 'api.faultmaven.ai'],
  ])('rejects %s', async (_label, value) => {
    setApiTransport(transportWithBase(value));

    await expect(getApiTransport().baseUrl()).rejects.toThrow(/not an absolute origin/);
  });

  it('names the value and the fix, so the message is actionable', async () => {
    setApiTransport(transportWithBase(''));

    await expect(getApiTransport().baseUrl()).rejects.toThrow(/window\.location\.origin/);
    await expect(getApiTransport().baseUrl()).rejects.toThrow(/""/);
  });

  it.each([
    ['https', 'https://api.faultmaven.ai'],
    ['http on a LAN host', 'http://192.168.1.10:8090'],
    ['localhost', 'http://localhost:8090'],
  ])('accepts an absolute %s origin unchanged', async (_label, value) => {
    setApiTransport(transportWithBase(value));

    await expect(getApiTransport().baseUrl()).resolves.toBe(value);
  });

  // A same-origin host's correct answer, which is what the Dashboard must send
  // in place of the empty string.
  it("accepts what a same-origin host should answer instead of ''", async () => {
    const origin = new URL('https://app.faultmaven.ai/cases/case-1').origin;
    setApiTransport(transportWithBase(origin));

    await expect(getApiTransport().baseUrl()).resolves.toBe('https://app.faultmaven.ai');
  });

  // The wrapper must not swallow the rest of the transport.
  it('leaves every other member of the host transport intact', async () => {
    const onUnauthorized = vi.fn(() => 'ended' as const);
    setApiTransport({ ...transportWithBase('https://api.test'), onUnauthorized });

    const t = getApiTransport();
    await expect(t.accessToken()).resolves.toBe('token');
    await expect(t.sessionId()).resolves.toBeNull();
    expect(t.onUnauthorized()).toBe('ended');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
