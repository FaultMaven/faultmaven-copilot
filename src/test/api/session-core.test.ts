import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageSet, storageGet, createSessionWithRecovery } = vi.hoisted(() => ({
  storageSet: vi.fn().mockResolvedValue(undefined),
  storageGet: vi.fn().mockResolvedValue({}),
  createSessionWithRecovery: vi.fn()
}));

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: storageGet, set: storageSet } } }
}));

vi.mock('../../lib/session/client-session-manager', () => ({
  clientSessionManager: { createSessionWithRecovery }
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { refreshSession } from '../../lib/api/session-core';

const sessionResponse = (over: Record<string, any> = {}) => ({
  session_id: 'sess-new',
  created_at: '2026-02-20T00:00:00Z',
  status: 'active',
  user_id: 'u1',
  session_type: 'troubleshooting',
  client_id: 'client-1',
  session_resumed: false,
  message: 'Session created successfully',
  ...over
});

describe('refreshSession', () => {
  beforeEach(() => {
    storageSet.mockClear();
    storageGet.mockReset().mockResolvedValue({});
    createSessionWithRecovery.mockReset().mockResolvedValue(sessionResponse());
    // Force the in-context fallback path (no Web Locks in the test env).
    if (typeof navigator !== 'undefined') delete (navigator as any).locks;
  });

  it('persists the new session_id so subsequent requests carry X-Session-Id', async () => {
    await refreshSession();

    expect(createSessionWithRecovery).toHaveBeenCalledTimes(1);
    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-new',
        sessionResumed: false,
        clientId: 'client-1'
      })
    );
  });

  it('single-flights concurrent refreshes into ONE /sessions create', async () => {
    // Make the create hang until we resolve it, so both callers overlap.
    let resolveCreate!: (v: any) => void;
    createSessionWithRecovery.mockReturnValueOnce(new Promise(r => { resolveCreate = r; }));

    const a = refreshSession();
    const b = refreshSession();
    resolveCreate(sessionResponse());
    await Promise.all([a, b]);

    // Two concurrent callers, but only one backend session create + one persist.
    expect(createSessionWithRecovery).toHaveBeenCalledTimes(1);
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('skips creating when a fresh session already exists (re-check)', async () => {
    storageGet.mockResolvedValue({ sessionId: 'already-fresh' });

    await refreshSession();

    expect(createSessionWithRecovery).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('resets the single-flight guard so a later refresh can run again', async () => {
    await refreshSession();
    expect(createSessionWithRecovery).toHaveBeenCalledTimes(1);

    // A subsequent, non-overlapping refresh should create again (guard cleared).
    await refreshSession();
    expect(createSessionWithRecovery).toHaveBeenCalledTimes(2);
  });
});
