import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initiateDashboardOAuth,
  cleanupOAuthState,
  getDashboardUrl
} from '../../../extension/auth/dashboard-oauth';

// Mock browser environment
const { mockBrowserStorage, mockBrowserRuntime, mockBrowserIdentity } = vi.hoisted(() => {
  const mockStorage = {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined)
    }
  };

  const mockRuntime = {
    getURL: vi.fn((path: string) => `chrome-extension://abcdefghijklmnopqrstuvwxyzabcd${path}`)
  };

  // identity.getRedirectURL is what launchWebAuthFlow redirects back to. The
  // browser derives that host from the extension's own id — which is exactly
  // why it replaced the forgeable chrome-extension:// callback page.
  const mockIdentity = {
    getRedirectURL: vi.fn(() => 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn()
  };

  return {
    mockBrowserStorage: mockStorage,
    mockBrowserRuntime: mockRuntime,
    mockBrowserIdentity: mockIdentity
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: {
    storage: mockBrowserStorage,
    runtime: mockBrowserRuntime,
    identity: mockBrowserIdentity
  }
}));

import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { extensionEndpoints } from '../../../extension/host/endpoints';

describe('Dashboard OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The EXTENSION's own endpoints, over this file's storage mock. Not a stub
    // returning a fixed URL: what these tests are about is the resolution rule
    // — explicit key, legacy key, Cloud default — and a stub would assert the
    // test's own constant instead of it.
    setHostStore({
      get: (keys) => mockBrowserStorage.local.get(keys),
      set: (items) => mockBrowserStorage.local.set(items),
      remove: (keys) => mockBrowserStorage.local.remove(keys),
      subscribe: () => () => {},
    });
    setHostEndpoints(extensionEndpoints);
    // Mock storage to return Dashboard URL (not API URL)
    mockBrowserStorage.local.get.mockResolvedValue({ apiEndpoint: 'http://localhost:3333' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDashboardUrl', () => {
    it('reads Dashboard URL from storage (local deployment)', async () => {
      const dashboardUrl = await getDashboardUrl();
      expect(dashboardUrl).toBe('http://localhost:3333');
      // Delegates to the host's endpoints, which prefer the explicit
      // dashboardUrl key and fall back to the legacy apiEndpoint key.
      expect(mockBrowserStorage.local.get).toHaveBeenCalledWith(['dashboardUrl', 'apiEndpoint']);
    });

    it('returns production default when storage is empty', async () => {
      mockBrowserStorage.local.get.mockResolvedValue({});
      const dashboardUrl = await getDashboardUrl();
      expect(dashboardUrl).toBe('https://app.faultmaven.ai');
    });
  });

  describe('initiateDashboardOAuth', () => {
    it('generates PKCE parameters and stores them', async () => {
      const result = await initiateDashboardOAuth();

      // Verify PKCE parameters were generated
      expect(result.authorization_url).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.code_challenge).toBeDefined();

      // Verify state is 32 hex characters
      expect(result.state).toMatch(/^[a-f0-9]{32}$/);

      // Verify code challenge is base64url encoded (43 characters)
      expect(result.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Verify storage was called with correct parameters
      expect(mockBrowserStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          pkce_verifier: expect.any(String),
          auth_state: result.state,
          redirect_uri: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
          auth_initiated_at: expect.any(Number)
        })
      );
    });

    it('generates correct authorization URL', async () => {
      const result = await initiateDashboardOAuth();

      const url = new URL(result.authorization_url);

      // Verify base URL
      expect(url.origin + url.pathname).toBe('http://localhost:3333/auth/authorize');

      // Verify query parameters
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('faultmaven-copilot');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
      );
      expect(url.searchParams.get('state')).toBe(result.state);
      expect(url.searchParams.get('code_challenge')).toBe(result.code_challenge);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toContain('openid');
      expect(url.searchParams.get('scope')).toContain('cases:read');
      expect(url.searchParams.get('scope')).toContain('cases:write');
    });

    it('uses the browser-derived identity redirect, not an in-extension page', async () => {
      await initiateDashboardOAuth();

      // Not runtime.getURL('/callback.html'): that redirect is claimable by any
      // extension the backend's id-agnostic pattern admits.
      expect(mockBrowserIdentity.getRedirectURL).toHaveBeenCalled();
      expect(mockBrowserRuntime.getURL).not.toHaveBeenCalledWith('/callback.html');
    });

    it('generates unique state and verifier on each call', async () => {
      const result1 = await initiateDashboardOAuth();
      const result2 = await initiateDashboardOAuth();

      expect(result1.state).not.toBe(result2.state);
      expect(result1.code_challenge).not.toBe(result2.code_challenge);
    });
  });

  describe('cleanupOAuthState', () => {
    it('removes all OAuth state from storage', async () => {
      await cleanupOAuthState();

      expect(mockBrowserStorage.local.remove).toHaveBeenCalledWith([
        'pkce_verifier',
        'auth_state',
        'redirect_uri',
        'auth_initiated_at',
        'oauth_pending'
      ]);
    });
  });

  describe('PKCE Security', () => {
    it('generates cryptographically secure random values', async () => {
      // Run multiple times to check for randomness
      const results = await Promise.all([
        initiateDashboardOAuth(),
        initiateDashboardOAuth(),
        initiateDashboardOAuth()
      ]);

      // All states should be unique
      const states = results.map(r => r.state);
      const uniqueStates = new Set(states);
      expect(uniqueStates.size).toBe(3);

      // All challenges should be unique
      const challenges = results.map(r => r.code_challenge);
      const uniqueChallenges = new Set(challenges);
      expect(uniqueChallenges.size).toBe(3);
    });

    it('generates code_challenge from code_verifier using SHA-256', async () => {
      const result = await initiateDashboardOAuth();

      // Retrieve stored verifier
      const storageCall = mockBrowserStorage.local.set.mock.calls[0][0];
      const verifier = storageCall.pkce_verifier;

      // Verify verifier format (43 characters, base64url)
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Verify challenge is different from verifier
      expect(result.code_challenge).not.toBe(verifier);

      // Both should be 43 characters (base64url encoding of 32 bytes)
      expect(result.code_challenge.length).toBe(43);
      expect(verifier.length).toBe(43);
    });
  });
});
