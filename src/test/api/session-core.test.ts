import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageSet, storageGet, storageRemove, createSessionWithRecovery } = vi.hoisted(() => ({
  storageSet: vi.fn().mockResolvedValue(undefined),
  storageGet: vi.fn().mockResolvedValue({}),
  storageRemove: vi.fn().mockResolvedValue(undefined),
  createSessionWithRecovery: vi.fn()
}));

vi.mock('@faultmaven/copilot-ui/lib/session/client-session-manager', () => ({
  clientSessionManager: { createSessionWithRecovery }
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { refreshSession, clearPersistedSession } from '@faultmaven/copilot-ui/lib/api/session-core';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';

// session-core reaches storage through the host, so the spies above are
// installed AS the host's store rather than under `wxt/browser`. The
// assertions are unchanged — the same writes, observed where they now land.
beforeEach(() => {
  setHostStore({
    get: storageGet,
    set: storageSet,
    remove: storageRemove,
    subscribe: () => () => {},
  });
});

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
    storageRemove.mockClear();
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

  it('resets the in-context guard even when the refresh fails', async () => {
    createSessionWithRecovery.mockRejectedValueOnce(new Error('network down'));
    await expect(refreshSession()).rejects.toThrow('network down');

    // Guard must be cleared so a later refresh can retry.
    createSessionWithRecovery.mockResolvedValueOnce(sessionResponse());
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(createSessionWithRecovery).toHaveBeenCalledTimes(2);
  });

  it('uses the Web Locks mutex when available (production path)', async () => {
    // Provide a fake Web Locks impl so the actual extension code path runs.
    const request = vi.fn(async (_name: string, _opts: any, cb: () => Promise<void>) => cb());
    (navigator as any).locks = { request };

    await refreshSession();

    expect(request).toHaveBeenCalledWith(
      'faultmaven-session-refresh',
      { mode: 'exclusive' },
      expect.any(Function)
    );
    expect(createSessionWithRecovery).toHaveBeenCalledTimes(1);
    expect(storageSet).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-new' }));
  });
});

/**
 * The single clear, matching the single write above.
 *
 * Three call sites used to remove these keys with three slightly different
 * lists — the client's 401 path, the session slice's teardown and the extension
 * transport — so which keys survived a clear depended on who cleared. The one
 * real distinction is `clientId`, which OUTLIVES a session so a fresh
 * `/sessions` POST can resume rather than start cold.
 */
describe('clearPersistedSession', () => {
  beforeEach(() => {
    storageRemove.mockClear();
  });

  it('clears the session keys and KEEPS clientId by default', async () => {
    await clearPersistedSession();

    expect(storageRemove).toHaveBeenCalledWith(['sessionId', 'sessionCreatedAt', 'sessionResumed']);
  });

  it('takes clientId too only when asked', async () => {
    await clearPersistedSession({ includeClientId: true });

    expect(storageRemove).toHaveBeenCalledWith([
      'sessionId',
      'sessionCreatedAt',
      'sessionResumed',
      'clientId',
    ]);
  });
});
