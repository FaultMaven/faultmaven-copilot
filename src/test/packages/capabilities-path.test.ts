/**
 * The capabilities probe goes through `/api`, like everything else.
 *
 * It was the one client route outside it — `/v1/meta/capabilities` — and the
 * exception was invisible until a host served the API from its own origin. The
 * Kubernetes ingress forwards `/api` and nothing else, so the request fell
 * through to the SPA's catch-all rewrite and came back `200 text/html`.
 * `response.ok` was true, `json()` threw into the catch, and the panel ran on
 * the fabricated self-hosted fallback with no visible error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilitiesManager } from '@faultmaven/copilot-ui/lib/capabilities';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

const json = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  }) as unknown as Response;

const spaHtml = () =>
  ({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  }) as unknown as Response;

/**
 * A fresh manager per test rather than the singleton: it memoises a successful
 * network fetch, so one test's success would answer the next one's question.
 */
let capabilities: CapabilitiesManager;

beforeEach(() => {
  vi.clearAllMocks();
  capabilities = new CapabilitiesManager();
  setHostStore({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    subscribe: () => () => {},
  });
});

describe('the capabilities probe', () => {
  it('requests a path under /api/v1', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ deploymentMode: 'cloud', features: {} }));
    global.fetch = fetchMock as never;

    await capabilities.fetch('https://app.faultmaven.ai');

    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toBe('https://app.faultmaven.ai/api/v1/meta/capabilities');
    // The property, not just the string: an ingress that forwards `/api`
    // forwards this.
    expect(new URL(requested).pathname.startsWith('/api/v1/')).toBe(true);
  });

  it('still serves degraded capabilities when the probe fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as never;

    const caps = await capabilities.fetch('https://app.faultmaven.ai');

    expect(caps.deploymentMode).toBe('self-hosted');
  });

  // The SPA-rewrite shape: a 200 that is not JSON. It used to reach the catch
  // as a parse error logged at warning level, which is indistinguishable from
  // an offline blip and which nobody read.
  it('logs a non-JSON 200 at ERROR level, naming the path', async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    global.fetch = vi.fn().mockResolvedValue(spaHtml()) as never;

    const caps = await capabilities.fetch('https://app.faultmaven.ai');

    // Degraded, as before — the fallback is deliberate.
    expect(caps.deploymentMode).toBe('self-hosted');

    const said = errors
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    expect(said).toMatch(/not reaching the API/);
    expect(said).toMatch(/\/api\/v1\/meta\/capabilities/);
    spy.mockRestore();
  });
});
