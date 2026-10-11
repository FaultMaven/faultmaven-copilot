/**
 * Contract 12.4.0: the turn request timeout and the keyed-turn recovery
 * deadline are derived from the response bound the API publishes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FALLBACK_KEYED_TURN_DEADLINE_MS,
  FALLBACK_TURN_REQUEST_TIMEOUT_MS,
  TURN_NETWORK_MARGIN_SECONDS,
  deriveTurnTiming,
  uploadAllowanceSeconds,
} from '@faultmaven/copilot-ui/lib/utils/turn-timing';
import { turnBodyBytes } from '@faultmaven/copilot-ui/lib/utils/keyed-turn-retry';
import { CAPABILITIES_TTL_MS, CapabilitiesManager, REFRESH_WAIT_MS } from '@faultmaven/copilot-ui/lib/capabilities';

const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
const warn = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() }),
}));

const API = 'https://api.example';

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

  it.each([undefined, null, 0, -5, Number.NaN, Infinity, '150', 29.9, 1200.1, 5000])('falls back on %s', (bad) => {
    expect(deriveTurnTiming(bad)).toEqual({
      requestTimeoutMs: FALLBACK_TURN_REQUEST_TIMEOUT_MS,
      deadlineMs: FALLBACK_KEYED_TURN_DEADLINE_MS,
      source: 'fallback',
    });
    expect(FALLBACK_TURN_REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(FALLBACK_KEYED_TURN_DEADLINE_MS).toBe(660_000);
  });
});

describe('published bound range and upload allowance', () => {
  it('accepts exactly [30, 1200] s', () => {
    expect(deriveTurnTiming(30).source).toBe('published');
    expect(deriveTurnTiming(1200).source).toBe('published');
  });

  it('adds ceil(bytes / 125 000) s to the timeout and twice that to the deadline', () => {
    expect(uploadAllowanceSeconds(0)).toBe(0);
    expect(uploadAllowanceSeconds(1)).toBe(1);
    expect(uploadAllowanceSeconds(10_000_000)).toBe(80);
    expect(deriveTurnTiming(150, 10_000_000)).toEqual({
      requestTimeoutMs: 290_000,
      deadlineMs: 580_000,
      source: 'published',
    });
    // The fallback carries the allowance too.
    expect(deriveTurnTiming(undefined, 10_000_000)).toEqual({
      requestTimeoutMs: 380_000,
      deadlineMs: 820_000,
      source: 'fallback',
    });
  });

  it('sizes the body from files, paste and query', () => {
    const file = new File([new Uint8Array(1000)], 'a.log');
    expect(turnBodyBytes({ files: [file], pastedContent: 'abc', query: 'hé' })).toBe(1000 + 3 + 3);
    expect(turnBodyBytes({})).toBe(0);
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
    expect(mgr.getTurnTiming(API)).toEqual({ requestTimeoutMs: 250_000, deadlineMs: 500_000, source: 'published' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the fallback, logged, before any capabilities are held', () => {
    expect(new CapabilitiesManager().getTurnTiming(API).source).toBe('fallback');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback, logged, when the capabilities fetch failed (fabricated defaults say nothing)', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    warn.mockClear();
    expect(mgr.getTurnTiming(API)).toMatchObject({ requestTimeoutMs: 300_000, deadlineMs: 660_000, source: 'fallback' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback, logged, when the payload lacks the field (an older backend or cache)', async () => {
    const { turnResponseBoundSeconds: _omit, ...rest } = caps().limits;
    fetchWithTimeout.mockResolvedValue(ok({ ...caps(), limits: rest }));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming(API)).toMatchObject({ requestTimeoutMs: 300_000, deadlineMs: 660_000, source: 'fallback' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a cached payload that carries the bound is used when the fetch fails', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    (global as any).browser.storage.local.get.mockResolvedValue({
      backendCapabilitiesByUrl: { [API]: caps({ turnResponseBoundSeconds: 140 }) },
    });
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming(API)).toMatchObject({ requestTimeoutMs: 200_000, source: 'published' });
  });

  it('logs the fallback once per capabilities object, not on every attempt', async () => {
    const mgr = new CapabilitiesManager();
    mgr.getTurnTiming(API);
    mgr.getTurnTiming(API);
    expect(warn).toHaveBeenCalledTimes(1);
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 5000 })));
    await mgr.fetch('https://api.example');
    mgr.getTurnTiming(API);
    mgr.getTurnTiming(API);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('fallback turn timing'))).toHaveLength(2);
  });

  it('rejects an out-of-range published bound', async () => {
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 5000 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming(API).source).toBe('fallback');
  });

  it('adds the upload allowance for the body it is asked about', async () => {
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 150 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    expect(mgr.getTurnTiming(API, 10_000_000).requestTimeoutMs).toBe(290_000);
  });
});

describe('re-reading capabilities (a provider switch moves the bound)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (global as any).browser.storage.local.get.mockResolvedValue({});
    (global as any).browser.storage.local.set.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('does not re-read inside five minutes, re-reads after, and the new bound applies', async () => {
    expect(CAPABILITIES_TTL_MS).toBe(300_000);
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 150 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await mgr.refreshIfStale('https://api.example');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);

    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 300 })));
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await mgr.refreshIfStale('https://api.example');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(mgr.getTurnTiming(API).requestTimeoutMs).toBe(360_000);
  });

  it('a failed re-read keeps the earlier network read', async () => {
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 150 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    await mgr.refreshIfStale('https://api.example');
    expect(mgr.getTurnTiming(API)).toMatchObject({ requestTimeoutMs: 210_000, source: 'published' });
  });

  it('a slow re-read delays the turn at most REFRESH_WAIT_MS, and lands for the next turn', async () => {
    expect(REFRESH_WAIT_MS).toBe(5_000);
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 150 })));
    const mgr = new CapabilitiesManager();
    await mgr.fetch('https://api.example');
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    let answer!: (r: unknown) => void;
    fetchWithTimeout.mockReturnValue(new Promise((r) => { answer = r; }));
    let returned = false;
    const refresh = mgr.refreshIfStale('https://api.example').then(() => { returned = true; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await refresh;
    expect(returned).toBe(true);
    expect(mgr.getTurnTiming(API).requestTimeoutMs).toBe(210_000);
    answer(ok(caps({ turnResponseBoundSeconds: 300 })));
    await vi.advanceTimersByTimeAsync(0);
    expect(mgr.getTurnTiming(API).requestTimeoutMs).toBe(360_000);
  });

  it('holds a degraded read for this URL: no read is made (the app’s load already tried)', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('down'));
    const mgr = new CapabilitiesManager();
    await mgr.fetch(API);
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    await mgr.refreshIfStale(API);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('holds nothing for this URL (the API URL changed): it is read before the turn', async () => {
    fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 300 })));
    const mgr = new CapabilitiesManager();
    await mgr.refreshIfStale(API);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(mgr.getTurnTiming(API).requestTimeoutMs).toBe(360_000);
  });

  // A turn reads its timing twice (the hook, then `submitTurn`, once per
  // attempt). Each read used to wait REFRESH_WAIT_MS of its own on the SAME
  // slow probe, so the first POST went out after 10 s and every retry waited
  // another 5 s. The budget belongs to the probe: it runs from the probe's
  // start, and a later read waits only what is left of it.
  describe('one probe, one wait', () => {
    /** Runs `reads` reads back to back and says how long they held the turn. */
    async function heldFor(mgr: CapabilitiesManager, reads: number): Promise<number> {
      const t0 = Date.now();
      let doneAt = -1;
      const run = (async () => {
        for (let i = 0; i < reads; i += 1) await mgr.refreshIfStale(API);
        doneAt = Date.now() - t0;
      })();
      await vi.advanceTimersByTimeAsync(3 * REFRESH_WAIT_MS);
      await run;
      return doneAt;
    }

    it('nothing held: two reads before one turn wait on a slow probe once', async () => {
      fetchWithTimeout.mockReturnValue(new Promise(() => {}));
      expect(await heldFor(new CapabilitiesManager(), 2)).toBe(REFRESH_WAIT_MS);
      expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('stale read: two reads before one turn wait on a slow re-read once', async () => {
      fetchWithTimeout.mockResolvedValue(ok(caps({ turnResponseBoundSeconds: 150 })));
      const mgr = new CapabilitiesManager();
      await mgr.fetch(API);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      fetchWithTimeout.mockReturnValue(new Promise(() => {}));
      expect(await heldFor(mgr, 2)).toBe(REFRESH_WAIT_MS);
      expect(mgr.getTurnTiming(API).requestTimeoutMs).toBe(210_000);
    });

    it('a retry attempt after the budget is spent does not wait on the same probe again', async () => {
      fetchWithTimeout.mockReturnValue(new Promise(() => {}));
      const mgr = new CapabilitiesManager();
      expect(await heldFor(mgr, 1)).toBe(REFRESH_WAIT_MS);
      expect(await heldFor(mgr, 3)).toBe(0);
      expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('a read that joins a probe partway waits only the rest of its budget', async () => {
      fetchWithTimeout.mockReturnValue(new Promise(() => {}));
      const mgr = new CapabilitiesManager();
      void mgr.fetch(API); // the app's own load, already running
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await heldFor(mgr, 1)).toBe(REFRESH_WAIT_MS - 2_000);
    });
  });
});
