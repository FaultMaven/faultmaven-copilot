import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: { storage: mockStorage } }));

import {
  validateEndpointUrl,
  setEndpoints,
  getApiUrl,
  getDashboardUrl,
} from '../config';

describe('config endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.local.get.mockResolvedValue({});
  });

  describe('validateEndpointUrl', () => {
    it('accepts https custom domains', () => {
      expect(validateEndpointUrl('https://fm.acme.com')).toBeNull();
    });
    it('accepts http only on loopback hosts (localhost / 127.0.0.1 / 0.0.0.0)', () => {
      expect(validateEndpointUrl('http://localhost:8090')).toBeNull();
      expect(validateEndpointUrl('http://127.0.0.1:8090')).toBeNull();
      expect(validateEndpointUrl('http://0.0.0.0:8090')).toBeNull();
    });
    it('rejects http on a non-loopback host', () => {
      expect(validateEndpointUrl('http://fm.acme.com')).toMatch(/https/i);
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
      await expect(setEndpoints({ apiBaseUrl: 'http://fm.acme.com' })).rejects.toThrow();
      expect(mockStorage.local.set).not.toHaveBeenCalled();
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
