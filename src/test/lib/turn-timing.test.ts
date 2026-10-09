/**
 * Contract 12.4.0: the turn request timeout and the keyed-turn recovery
 * deadline are derived from the response bound the API publishes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FALLBACK_KEYED_TURN_DEADLINE_MS,
  FALLBACK_TURN_REQUEST_TIMEOUT_MS,
  TURN_NETWORK_MARGIN_SECONDS,
  deriveTurnTiming,
} from '@faultmaven/copilot-ui/lib/utils/turn-timing';
import { CapabilitiesManager } from '@faultmaven/copilot-ui/lib/capabilities';

const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
const warn = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() }),
}));

const caps = (limits: Record<string, unknown> = {}) => ({
  deploymentMode: 'cloud',
  kbManagement: 'dashboard',
  dashboardUrl: 'https://app.example',
  features: { extensionKB: false, adminKB: true, teamSharing: true, caseHistory: true, sso: true, managementConsole: true },
  branding: { name: 'FaultMaven', supportUrl: 'https://example/support' },
  limits: { maxFileBytes: 1, allowedExtensions: ['.md'], turnCeilingSeconds: 120, turnResponseBoundSeconds: 150, ...limits },
});
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
});

describe('deriveTurnTiming', () => {
  it('request timeout = bound + the network margin; deadline = twice that', () => {
    const timing = deriveTurnTiming(150);
    expect(TURN_NETWORK_MARGIN_SECONDS).toBe(60);
    expect(timing).toEqual({ requestTimeoutMs: 210_000, deadlineMs: 420_000, source: 'published' });
  });

  it('follows the bound: a provider switch to a 600 s ceiling moves both', () => {
    expect(deriveTurnTiming(650)).toMatchObject({ requestTimeoutMs: 710_000, deadlineMs: 1_420_000 });
  });

  it.each([undefined, null, 0, -5, Number.NaN, Infinity, '150'])('falls back on %s', (bad) => {
    expect(deriveTurnTiming(bad)).toEqual({
      requestTimeoutMs: FALLBACK_TURN_REQUEST_TIMEOUT_MS,
      deadlineMs: FALLBACK_KEYED_TURN_DEADLINE_MS,
      source: 'fallback',
    });
    expect(FALLBACK_TURN_REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(FALLBACK_KEYED_TURN_DEADLINE_MS).toBe(660_000);
  });
});

describe('CapabilitiesManager.getTurnTiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).browser.storage.local.get.mockResolvedValue({});
    (global as any).browser.storage.local.set.mockResolvedValue(undefined);
  });

  it('derives from a capabilities double carrying the published bound', async () => {
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 190 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming()).toEqual({ requestTimeoutMs: 250_000, deadlineMs: 500_000, source: 'published' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the fallback, logged, before any capabilities are held', () => {
    expect(new CapabilitiesManager().getTurnTiming().source).toBe('fallback');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback, logged, when the capabilities fetch failed (fabricated defaults say nothing)', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    warn.mockClear();
    expect(mgr.getTurnTiming()).toMatchObject({ requestTimeoutMs: 300_000, deadlineMs: 660_000, source: 'fallback' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback, logged, when the payload lacks the field (an older backend or cache)', async () => {
    const { turnResponseBoundSeconds: _omit, ...rest } = caps().limits;
    fetchWithTimeout.mockResolvedValue(ok({ ...caps(), limits: rest }));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming()).toMatchObject({ requestTimeoutMs: 300_000, deadlineMs: 660_000, source: 'fallback' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a cached payload that carries the bound is used when the fetch fails', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    (global as any).browser.storage.local.get.mockResolvedValue({
      backendCapabilities: caps({ turnResponseBoundSeconds: 140 }),
    });
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming()).toMatchObject({ requestTimeoutMs: 200_000, source: 'published' });
  });
});
