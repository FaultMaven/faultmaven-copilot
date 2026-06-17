import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileAuthBridgeRegistration } from '../../../lib/auth/auth-bridge-registration';

// Resolves `browser` to the global mock from src/test/setup.ts (the per-file
// vi.mock('wxt/browser') does not apply through the transitive config import).
const b = (global as any).browser;

describe('reconcileAuthBridgeRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // dashboardUrl drives getDashboardUrl()
    b.storage.local.get.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    b.permissions = {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn() },
    };
    b.scripting = {
      ...b.scripting,
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('registers the bridge for the configured dashboard origin when permitted and not yet registered', async () => {
    await reconcileAuthBridgeRegistration();
    expect(b.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'auth-bridge', matches: ['https://app.faultmaven.ai/*'] }),
    ]);
  });

  it('does not register when host permission is missing; clears any stale registration', async () => {
    b.permissions.contains.mockResolvedValue(false);
    await reconcileAuthBridgeRegistration();
    expect(b.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(b.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['auth-bridge'] });
  });

  it('is a no-op when already registered for the same origin', async () => {
    b.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'auth-bridge', matches: ['https://app.faultmaven.ai/*'] },
    ]);
    await reconcileAuthBridgeRegistration();
    expect(b.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(b.scripting.updateContentScripts).not.toHaveBeenCalled();
  });

  it('updates the registration when the configured origin changes', async () => {
    b.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'auth-bridge', matches: ['https://old.example.com/*'] },
    ]);
    await reconcileAuthBridgeRegistration();
    expect(b.scripting.updateContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://app.faultmaven.ai/*'] }),
    ]);
  });
});
