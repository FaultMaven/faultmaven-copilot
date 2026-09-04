/**
 * Reload detection, where it now lives.
 *
 * These cases came from the persistence-manager suite unchanged in substance:
 * an explicit flag, a version bump and a runtime-id change each mean the local
 * cache may be gone, and nobody signed in means there is nothing to recover.
 * What changed is who answers them. `runtime.id` and `getManifest()` are
 * extension APIs, so a shared module could not ask — and the credential the
 * first check needs is the host's too.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockBrowser } = vi.hoisted(() => ({
  mockBrowser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '1.0.0' })),
      id: 'test-ext-id',
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: mockBrowser }));

vi.mock('../../extension/auth/auth-manager', () => ({
  authManager: { isAuthenticated: vi.fn() },
}));

import {
  detectExtensionReload,
  markReloadDetected,
  clearReloadFlag,
  stampRuntimeIdentity,
} from '../../extension/extension-reload';
import { authManager } from '../../extension/auth/auth-manager';

describe('extension reload detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowser.storage.local.get.mockResolvedValue({});
    vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
  });

  it('detects a reload when the explicit flag is set', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({
      conversationTitles: { case1: 'Title' },
      conversations: {},
      faultmaven_extension_version: '1.0.0',
      faultmaven_reload_detected: true,
      faultmaven_session_id: 'test-ext-id',
    });

    expect(await detectExtensionReload()).toBe(true);
  });

  it('detects nothing when every deterministic signal agrees', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({
      conversationTitles: { case1: 'Test Chat' },
      conversations: { case1: [{ id: '1', content: 'msg' }] },
      faultmaven_extension_version: '1.0.0',
      faultmaven_session_id: 'test-ext-id',
      faultmaven_last_sync: Date.now(),
    });

    expect(await detectExtensionReload()).toBe(false);
  });

  it('detects a reload on a version mismatch (an update)', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({
      conversationTitles: { case1: 'Test Chat' },
      conversations: { case1: [] },
      faultmaven_extension_version: '0.9.0',
      faultmaven_last_sync: Date.now(),
    });

    expect(await detectExtensionReload()).toBe(true);
  });

  it('detects a reload when the runtime id changed', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({
      faultmaven_extension_version: '1.0.0',
      faultmaven_session_id: 'a-previous-runtime',
    });

    expect(await detectExtensionReload()).toBe(true);
  });

  // Recovery talks to the backend. Asking first is what stops a signed-out
  // panel firing a doomed fetch on every launch — and it is asked HERE because
  // the credential is the host's.
  it('detects nothing when nobody is signed in', async () => {
    vi.mocked(authManager.isAuthenticated).mockResolvedValue(false);
    mockBrowser.storage.local.get.mockResolvedValue({ faultmaven_reload_detected: true });

    expect(await detectExtensionReload()).toBe(false);
  });

  it('holds off inside the recovery cooldown', async () => {
    mockBrowser.storage.local.get.mockResolvedValue({
      faultmaven_reload_detected: true,
      faultmaven_last_recovery_attempt: Date.now() - 1000,
    });

    expect(await detectExtensionReload()).toBe(false);
  });
});

describe('the runtime identity stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The stamp used to live inside markSyncComplete, which knew neither value
  // except by reaching for `browser`. Without it the SAME reload is detected on
  // every launch, because nothing ever records the runtime that is now current.
  it('records this build and this runtime', async () => {
    await stampRuntimeIdentity();

    expect(mockBrowser.storage.local.set).toHaveBeenCalledWith({
      faultmaven_extension_version: '1.0.0',
      faultmaven_session_id: 'test-ext-id',
    });
  });

  it('marks a reload with the runtime that observed it', async () => {
    await markReloadDetected();

    expect(mockBrowser.storage.local.set).toHaveBeenCalledWith({
      faultmaven_reload_detected: true,
      faultmaven_session_id: 'test-ext-id',
    });
  });

  it('clears the reload flag and nothing else', async () => {
    await clearReloadFlag();

    expect(mockBrowser.storage.local.remove).toHaveBeenCalledWith(['faultmaven_reload_detected']);
  });
});
