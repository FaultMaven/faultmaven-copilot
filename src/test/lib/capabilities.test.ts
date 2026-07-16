import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilitiesManager } from '../../lib/capabilities';

// Mock the timeout-wrapped fetch used by CapabilitiesManager.
const fetchWithTimeout = vi.fn();
vi.mock('../../lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: any[]) => fetchWithTimeout(...args)
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const liveCaps = {
  deploymentMode: 'cloud',
  kbManagement: 'dashboard',
  dashboardUrl: 'https://app.faultmaven.ai',
  features: { extensionKB: false, adminKB: true, teamWorkspaces: true, caseHistory: true, sso: true },
  limits: { maxFileBytes: 10485760, allowedExtensions: ['.md'] }
};

const okResponse = (body: any) => ({ ok: true, status: 200, json: async () => body });

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
    (global as any).browser.storage.local.get.mockResolvedValue({ backendCapabilities: liveCaps });
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
