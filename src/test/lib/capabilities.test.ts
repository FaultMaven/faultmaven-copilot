import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilitiesManager, MAX_STORED_CAPABILITIES } from '@faultmaven/copilot-ui/lib/capabilities';

// Mock the timeout-wrapped fetch used by CapabilitiesManager.
const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: any[]) => fetchWithTimeout(...args)
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const liveCaps = {
  deploymentMode: 'cloud',
  kbManagement: 'dashboard',
  dashboardUrl: 'https://app.faultmaven.ai',
  features: { extensionKB: false, adminKB: true, teamSharing: true, caseHistory: true, sso: true },
  limits: { maxFileBytes: 10485760, allowedExtensions: ['.md'] }
};

const okResponse = (body: any) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body
});

describe('CapabilitiesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).browser.storage.local.get.mockResolvedValue({});
    (global as any).browser.storage.local.set.mockResolvedValue(undefined);
  });

  it('marks a live network result as authoritative and serves it from cache thereafter', async () => {
    fetchWithTimeout.mockResolvedValue(okResponse(liveCaps));
    const mgr = new CapabilitiesManager();

    const caps = await mgr.fetch('https://api.example');
    expect(caps.deploymentMode).toBe('cloud');

    // Second call short-circuits an authoritative result — no second network request.
    await mgr.fetch('https://api.example');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('serves a fabricated fallback when the fetch fails with no cache', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('network down'));
    const mgr = new CapabilitiesManager();

    const caps = await mgr.fetch('https://api.example');
    expect(caps.deploymentMode).toBe('self-hosted'); // fabricated default
  });

  it('serves cached capabilities when the fetch fails', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('network down'));
    (global as any).browser.storage.local.get.mockResolvedValue({
      backendCapabilitiesByUrl: { 'https://api.example': liveCaps },
    });
    const mgr = new CapabilitiesManager();

    const caps = await mgr.fetch('https://api.example');
    expect(caps.deploymentMode).toBe('cloud'); // from cache
  });

  // Regression: a transient failure previously cached the fabricated fallback as
  // `this.capabilities`, so the short-circuit at the top of fetch() returned it
  // forever — a recovered backend was never re-detected until reload. Only an
  // authoritative (network) result may short-circuit future fetches.
  it('re-detects a live backend on the next call after a degraded fallback', async () => {
    const mgr = new CapabilitiesManager();

    fetchWithTimeout.mockRejectedValueOnce(new Error('network down'));
    const degraded = await mgr.fetch('https://api.example');
    expect(degraded.deploymentMode).toBe('self-hosted'); // fabricated fallback

    // Backend recovers — the degraded result must NOT have poisoned the cache.
    fetchWithTimeout.mockResolvedValueOnce(okResponse(liveCaps));
    const caps = await mgr.fetch('https://api.example');
    expect(caps.deploymentMode).toBe('cloud');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });
});

// #324: capabilities belong to the server they were read from. The manager is
// one per document and the API URL is a runtime setting the user can change
// (and the options page probes an unsaved one), so a read for one URL must
// never answer for another — not from memory, not from an in-flight probe and
// not from the persisted offline copy.
describe('CapabilitiesManager is keyed on the API URL', () => {
  const A = 'https://a.example';
  const B = 'https://b.example';
  const capsFor = (deploymentMode: string, turnResponseBoundSeconds: number) => ({
    ...liveCaps,
    deploymentMode,
    limits: { ...liveCaps.limits, turnCeilingSeconds: 120, turnResponseBoundSeconds },
  });
  const capsA = capsFor('cloud', 150); // 210 s request timeout
  const capsB = capsFor('self-hosted', 300); // 360 s request timeout

  /** Each URL answers its own capabilities; `pending` holds a URL's answer back. */
  const pending = new Map<string, (r: unknown) => void>();
  const hold = new Set<string>();
  const down = new Set<string>();
  let stored: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    pending.clear();
    hold.clear();
    down.clear();
    stored = {};
    (global as any).browser.storage.local.get.mockImplementation(async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]])),
    );
    (global as any).browser.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(stored, items);
    });
    fetchWithTimeout.mockImplementation((url: string) => {
      const base = url.replace('/api/v1/meta/capabilities', '');
      if (down.has(base)) return Promise.reject(new Error('network down'));
      const body = base === A ? capsA : capsB;
      if (hold.has(base)) return new Promise((resolve) => pending.set(base, () => resolve(okResponse(body))));
      return Promise.resolve(okResponse(body));
    });
  });

  const requested = () => fetchWithTimeout.mock.calls.map(([url]) => String(url));

  it('a read for A does not answer a fetch for B: B is requested and served', async () => {
    const mgr = new CapabilitiesManager();
    expect((await mgr.fetch(A)).deploymentMode).toBe('cloud');

    expect((await mgr.fetch(B)).deploymentMode).toBe('self-hosted');
    expect(requested()).toEqual([`${A}/api/v1/meta/capabilities`, `${B}/api/v1/meta/capabilities`]);

    // Each is held under its own URL: neither is re-read, neither answers for the other.
    expect((await mgr.fetch(A)).deploymentMode).toBe('cloud');
    expect((await mgr.fetch(B)).deploymentMode).toBe('self-hosted');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  it('treats a trailing slash as the same server', async () => {
    const mgr = new CapabilitiesManager();
    await mgr.fetch(A);
    await mgr.fetch(`${A}/`);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('an in-flight probe for A does not satisfy B, and landing late does not displace B', async () => {
    hold.add(A);
    const mgr = new CapabilitiesManager();
    const forA = mgr.fetch(A);
    const forB = mgr.fetch(B);

    expect((await forB).deploymentMode).toBe('self-hosted');
    pending.get(A)!(undefined);
    expect((await forA).deploymentMode).toBe('cloud');

    expect(mgr.getTurnTiming(B).requestTimeoutMs).toBe(360_000);
    expect((await mgr.fetch(B)).deploymentMode).toBe('self-hosted');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  });

  it('the turn timing after a switch is B’s, read before the turn', async () => {
    const mgr = new CapabilitiesManager();
    await mgr.fetch(A);
    expect(mgr.getTurnTiming(A).requestTimeoutMs).toBe(210_000);

    // The user saved B; the panel's next turn asks about B.
    await mgr.refreshIfStale(B);
    expect(requested()).toContain(`${B}/api/v1/meta/capabilities`);
    expect(mgr.getTurnTiming(B)).toMatchObject({ requestTimeoutMs: 360_000, source: 'published' });
  });

  it('nothing held for B is the fallback timing, never A’s', async () => {
    const mgr = new CapabilitiesManager();
    await mgr.fetch(A);
    expect(mgr.getTurnTiming(B).source).toBe('fallback');
  });

  it('a failed read of B does not serve A’s network read', async () => {
    const mgr = new CapabilitiesManager();
    await mgr.fetch(A);
    down.add(B);
    const caps = await mgr.fetch(B);
    expect(caps.deploymentMode).toBe('self-hosted'); // the fabricated fallback, not A's 'cloud'
    expect(caps.limits.turnResponseBoundSeconds).toBe(0);
  });

  it('a failed read of B does not serve the offline copy persisted for A', async () => {
    await new CapabilitiesManager().fetch(A);
    down.add(B);
    const caps = await new CapabilitiesManager().fetch(B);
    expect(caps.limits.turnResponseBoundSeconds).toBe(0); // fallback, not A's 150
  });

  it('serves the offline copy to the server it was read from', async () => {
    await new CapabilitiesManager().fetch(A);
    down.add(A);
    const caps = await new CapabilitiesManager().fetch(A);
    expect(caps.limits.turnResponseBoundSeconds).toBe(150);
  });

  it('an offline copy written before it was tagged with its server is not served', async () => {
    stored.backendCapabilities = capsA;
    down.add(A);
    const caps = await new CapabilitiesManager().fetch(A);
    expect(caps.limits.turnResponseBoundSeconds).toBe(0);
  });

  it('a probe for A landing after B was requested does not displace B’s offline copy', async () => {
    hold.add(A);
    const mgr = new CapabilitiesManager();
    const forA = mgr.fetch(A);
    await mgr.fetch(B);
    pending.get(A)!(undefined);
    await forA;

    down.add(A);
    down.add(B);
    expect((await new CapabilitiesManager().fetch(B)).limits.turnResponseBoundSeconds).toBe(300);
    expect((await new CapabilitiesManager().fetch(A)).limits.turnResponseBoundSeconds).toBe(150);
  });

  // The options page and the panel are separate documents over ONE
  // storage.local. Options' Test probes an URL the user has not saved; that
  // must not cost the panel, still on A, its offline copy of A.
  it('another document probing an unsaved B does not evict A’s offline copy', async () => {
    await new CapabilitiesManager().fetch(A); // the panel, on A
    await new CapabilitiesManager().fetch(B); // options' Test of B
    down.add(A);
    const caps = await new CapabilitiesManager().fetch(A); // the panel, A down
    expect(caps.limits.turnResponseBoundSeconds).toBe(150);
  });

  it('keeps offline copies for the most recently read servers only', async () => {
    expect(MAX_STORED_CAPABILITIES).toBe(4);
    const urls = ['https://1.example', 'https://2.example', 'https://3.example', 'https://4.example', 'https://5.example'];
    for (const url of urls) {
      await new CapabilitiesManager().fetch(url);
    }
    const byUrl = stored.backendCapabilitiesByUrl as Record<string, unknown>;
    expect(Object.keys(byUrl).sort()).toEqual(urls.slice(1).sort());
  });
});
