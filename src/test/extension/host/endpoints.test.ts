import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage, mockOnChanged } = vi.hoisted(() => ({
  mockStorage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
  mockOnChanged: { addListener: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('wxt/browser', () => ({
  browser: { storage: { ...mockStorage, onChanged: mockOnChanged } },
}));

import {
  validateEndpointUrl,
  setEndpoints,
  getApiUrl,
  getDashboardUrl,
  extensionEndpoints,
} from '../../../extension/host/endpoints';
import { setHostStore, clearHostStore } from '@faultmaven/copilot-ui/lib/host-store';

// This file mocks `wxt/browser` for itself, so the suite-wide store from
// setup.ts — which is bound to the GLOBAL mock — would answer these reads from
// the wrong place. Install one bound to THIS file's mock.
beforeEach(() => {
  setHostStore({
    get: (k) => mockStorage.local.get(k),
    set: (i) => mockStorage.local.set(i),
    remove: (k) => mockStorage.local.remove(k),
    subscribe: () => () => {},
  });
});

describe('extension endpoint configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.local.get.mockResolvedValue({});
  });

  describe('validateEndpointUrl', () => {
    it('accepts https URLs', () => {
      expect(validateEndpointUrl('https://fm.acme.com')).toBeNull();
    });
    it('accepts http on loopback AND LAN/custom hosts (extension bypasses CORS, no mixed-content block)', () => {
      expect(validateEndpointUrl('http://localhost:8090')).toBeNull();
      expect(validateEndpointUrl('http://127.0.0.1:8090')).toBeNull();
      expect(validateEndpointUrl('http://192.168.1.100:8090')).toBeNull();
      expect(validateEndpointUrl('http://fm.acme.com')).toBeNull();
    });
    it('rejects non-http(s) schemes and garbage', () => {
      expect(validateEndpointUrl('ftp://x')).not.toBeNull();
      expect(validateEndpointUrl('not a url')).not.toBeNull();
    });
  });

  describe('setEndpoints', () => {
    it('writes normalized (trailing-slash-stripped) values', async () => {
      await setEndpoints({ apiBaseUrl: 'https://fm.acme.com/', dashboardUrl: 'https://dash.acme.com/' });
      expect(mockStorage.local.set).toHaveBeenCalledWith({
        apiBaseUrl: 'https://fm.acme.com',
        dashboardUrl: 'https://dash.acme.com',
      });
    });
    it('throws on an invalid URL without writing anything', async () => {
      await expect(setEndpoints({ apiBaseUrl: 'not a url' })).rejects.toThrow();
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    // #110: changing the endpoint can change the auth mode, so the cached auth
    // config (incl. its stale-fallback storage key) must be invalidated —
    // otherwise TokenManager routes refresh to the previous deployment.
    // clearAuthConfigCache (in auth-config) uses the ambient global `browser`
    // (see test setup), distinct from this file's `wxt/browser` module mock.
    it('invalidates the cached auth config after an endpoint change', async () => {
      const globalRemove = (globalThis as any).browser.storage.local.remove;
      globalRemove.mockClear();
      await setEndpoints({ apiBaseUrl: 'https://fm.acme.com' });
      expect(globalRemove).toHaveBeenCalledWith(['auth_config_cache']);
    });

    it('does not invalidate the auth config when nothing is written', async () => {
      const globalRemove = (globalThis as any).browser.storage.local.remove;
      globalRemove.mockClear();
      await setEndpoints({});
      expect(globalRemove).not.toHaveBeenCalledWith(['auth_config_cache']);
    });
  });

  describe('getApiUrl', () => {
    it('returns the explicit apiBaseUrl when set', async () => {
      mockStorage.local.get.mockResolvedValue({ apiBaseUrl: 'https://fm.acme.com' });
      expect(await getApiUrl()).toBe('https://fm.acme.com');
    });
    it('defaults to Cloud when nothing is configured', async () => {
      expect(await getApiUrl()).toBe('https://api.faultmaven.ai');
    });
    it('migrates a legacy Cloud apiEndpoint and seeds the new keys', async () => {
      mockStorage.local.get.mockResolvedValue({ apiEndpoint: 'https://app.faultmaven.ai' });
      expect(await getApiUrl()).toBe('https://api.faultmaven.ai');
      expect(mockStorage.local.set).toHaveBeenCalledWith({
        apiBaseUrl: 'https://api.faultmaven.ai',
        dashboardUrl: 'https://app.faultmaven.ai',
      });
    });
    it('migrates a legacy localhost dashboard (:3333 -> :8090)', async () => {
      mockStorage.local.get.mockResolvedValue({ apiEndpoint: 'http://127.0.0.1:3333' });
      expect(await getApiUrl()).toBe('http://127.0.0.1:8090');
    });
    it('anchors the app.->api. derivation to the host label (no "myapp" mangling)', async () => {
      mockStorage.local.get.mockResolvedValue({ apiEndpoint: 'https://myapp.example.com' });
      // No "app." subdomain → returned unchanged (user corrects via Options).
      expect(await getApiUrl()).toBe('https://myapp.example.com');
    });
    it('returns the migrated URL even when the seed write fails', async () => {
      mockStorage.local.get.mockResolvedValue({ apiEndpoint: 'http://127.0.0.1:3333' });
      mockStorage.local.set.mockRejectedValueOnce(new Error('storage quota exceeded'));
      expect(await getApiUrl()).toBe('http://127.0.0.1:8090');
    });
  });

  describe('getDashboardUrl', () => {
    it('returns explicit dashboardUrl when set', async () => {
      mockStorage.local.get.mockResolvedValue({ dashboardUrl: 'https://dash.acme.com' });
      expect(await getDashboardUrl()).toBe('https://dash.acme.com');
    });
    it('defaults to Cloud when nothing is configured', async () => {
      expect(await getDashboardUrl()).toBe('https://app.faultmaven.ai');
    });
  });
});

/**
 * The subscription half of `HostEndpoints`, which is what `useConfiguredEndpoint`
 * consumes.
 *
 * WHICH KEYS mean "the endpoint changed" used to be spelled out in the hook,
 * where it was three inline `changes.x || changes.y` tests. It is stated once
 * here now, so this file is where that property has to be proven — a hook test
 * can no longer see it.
 */
describe('extensionEndpoints.subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const listener = () => mockOnChanged.addListener.mock.calls[0][0];

  it('re-reads on a change to ANY of the three endpoint keys, legacy included', () => {
    const onChange = vi.fn();
    extensionEndpoints.subscribe(onChange);

    for (const key of ['apiBaseUrl', 'dashboardUrl', 'apiEndpoint']) {
      onChange.mockClear();
      listener()({ [key]: { newValue: 'http://x' } }, 'local');
      expect(onChange, `a change to ${key} must reach the subscriber`).toHaveBeenCalledTimes(1);
    }
  });

  // An endpoint that was CLEARED changes the answer as surely as one that was
  // set. Membership, not truthiness.
  it('re-reads when an endpoint key is removed', () => {
    const onChange = vi.fn();
    extensionEndpoints.subscribe(onChange);

    listener()({ apiBaseUrl: { oldValue: 'http://x' } }, 'local');

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a change to a key that is not an endpoint', () => {
    const onChange = vi.fn();
    extensionEndpoints.subscribe(onChange);

    listener()({ faultmaven_current_case: { newValue: 'case-1' } }, 'local');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops delivering after the returned unsubscribe is called', () => {
    const onChange = vi.fn();
    const unsubscribe = extensionEndpoints.subscribe(onChange);
    unsubscribe();

    expect(mockOnChanged.removeListener).toHaveBeenCalledWith(listener());
  });
});

/**
 * A read before the host installed its store is a WIRING bug, not a storage
 * hiccup, and the two used to be indistinguishable: both landed in the same
 * catch and both answered with the Cloud default. That is how a self-hosted
 * deployment's background worker could come to talk to FaultMaven Cloud and
 * report nothing.
 */
describe('endpoints with no host store installed', () => {
  beforeEach(() => {
    clearHostStore();
  });

  it('getApiUrl throws rather than answering with the Cloud default', async () => {
    await expect(getApiUrl()).rejects.toThrow(/No HostStore installed/);
  });

  it('getDashboardUrl throws rather than answering with the Cloud default', async () => {
    await expect(getDashboardUrl()).rejects.toThrow(/No HostStore installed/);
  });

  // The distinction only means something if a genuine read FAILURE still falls
  // back — otherwise this would just be a throw with extra steps.
  it('still falls back to Cloud when the store is installed but the read fails', async () => {
    setHostStore({
      get: () => Promise.reject(new Error('storage unavailable')),
      set: async () => {},
      remove: async () => {},
      subscribe: () => () => {},
    });

    expect(await getApiUrl()).toBe('https://api.faultmaven.ai');
    expect(await getDashboardUrl()).toBe('https://app.faultmaven.ai');
  });
});
