import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAuthConfig } from '../../../lib/auth/auth-config';

// auth-config resolves `browser` to the global mock provided by src/test/setup.ts.
const store = (global as any).browser.storage.local;

const OIDC_CACHE = {
  provider: 'oidc',
  features: {
    supports_registration: false,
    supports_password_reset: false,
    supports_email_verification: false,
    requires_redirect: true,
  },
};

describe('getAuthConfig fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // auth_config_version: 0 (< current) forces the version-check to clear the
    // in-memory cache at the start of each call, isolating tests.
    store.get.mockResolvedValue({ auth_config_version: 0 });
    store.set.mockResolvedValue(undefined);
    store.remove.mockResolvedValue(undefined);
  });

  it('persists the config to storage on a successful fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ auth_mode: 'oauth', supports_registration: false, login_endpoint: '/x' }),
    }) as any;

    const cfg = await getAuthConfig();

    expect(cfg.provider).toBe('oidc');
    expect(store.set).toHaveBeenCalledWith(
      expect.objectContaining({ auth_config_cache: expect.objectContaining({ provider: 'oidc' }) })
    );
  });

  it('falls back to the last-known-good config on fetch failure (not local)', async () => {
    store.get.mockResolvedValue({ auth_config_version: 0, auth_config_cache: OIDC_CACHE });
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    const cfg = await getAuthConfig();

    expect(cfg.provider).toBe('oidc'); // NOT silently switched to local
  });

  it('falls back to local only when there is no prior config', async () => {
    store.get.mockResolvedValue({ auth_config_version: 0 }); // no cache
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    const cfg = await getAuthConfig();

    expect(cfg.provider).toBe('local');
  });
});
