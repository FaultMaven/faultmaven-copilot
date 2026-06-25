import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import * as api from '../../../lib/api';
import { browser } from 'wxt/browser';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  }
}));

vi.mock('../../../lib/api', () => ({
  createSession: vi.fn()
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

describe('session-slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ sessionId: null, isSessionInitialized: false, sessionError: null });
    (browser.storage.local.get as any).mockResolvedValue({});
  });

  afterEach(async () => {
    // Tear down the heartbeat interval started by initializeSession.
    await useAppStore.getState().clearSession();
  });

  it('skips initialization when shouldInitialize is false', async () => {
    await useAppStore.getState().initializeSession(false);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(useAppStore.getState().isSessionInitialized).toBe(false);
  });

  it('reuses an existing stored session without creating a new one', async () => {
    (browser.storage.local.get as any).mockResolvedValue({ sessionId: 'existing-sess' });

    await useAppStore.getState().initializeSession();

    expect(api.createSession).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessionId).toBe('existing-sess');
    expect(useAppStore.getState().isSessionInitialized).toBe(true);
  });

  it('creates a new session when none is stored', async () => {
    (api.createSession as any).mockResolvedValue({
      session_id: 'new-sess',
      session_resumed: false,
      client_id: 'client-1'
    });

    await useAppStore.getState().initializeSession();

    expect(api.createSession).toHaveBeenCalled();
    expect(useAppStore.getState().sessionId).toBe('new-sess');
    expect(useAppStore.getState().isSessionInitialized).toBe(true);
    expect(browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'new-sess', clientId: 'client-1' })
    );
  });

  it('records an error and stays uninitialized when the backend omits session_id', async () => {
    (api.createSession as any).mockResolvedValue({ session_id: undefined });

    await useAppStore.getState().initializeSession();

    expect(useAppStore.getState().sessionId).toBeNull();
    expect(useAppStore.getState().isSessionInitialized).toBe(false);
    expect(useAppStore.getState().sessionError).toMatch(/missing session_id/i);
  });

  it('clearSession removes persisted keys and resets state', async () => {
    useAppStore.setState({ sessionId: 'x', isSessionInitialized: true });

    await useAppStore.getState().clearSession();

    expect(browser.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId'])
    );
    expect(useAppStore.getState().sessionId).toBeNull();
    expect(useAppStore.getState().isSessionInitialized).toBe(false);
  });
});
