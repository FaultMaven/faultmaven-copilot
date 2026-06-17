import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    local: { get: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('wxt/browser', () => ({ browser: { storage: mockStorage } }));

import { isTrustedDashboardOrigin, CLOUD_DASHBOARD_ORIGIN } from '../../../lib/auth/trusted-origin';

describe('isTrustedDashboardOrigin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.local.get.mockResolvedValue({});
  });

  it('always trusts the Cloud Dashboard origin', async () => {
    expect(await isTrustedDashboardOrigin(CLOUD_DASHBOARD_ORIGIN)).toBe(true);
  });

  it('trusts the configured dashboardUrl origin (ignoring path/port specifics beyond origin)', async () => {
    mockStorage.local.get.mockResolvedValue({ dashboardUrl: 'http://localhost:3333' });
    expect(await isTrustedDashboardOrigin('http://localhost:3333')).toBe(true);
  });

  it('rejects an origin that is not the configured one', async () => {
    mockStorage.local.get.mockResolvedValue({ dashboardUrl: 'http://localhost:3333' });
    // A different localhost port (e.g. some other local app) is NOT trusted.
    expect(await isTrustedDashboardOrigin('http://localhost:5173')).toBe(false);
    expect(await isTrustedDashboardOrigin('https://evil.example.com')).toBe(false);
  });

  it('rejects everything but Cloud when nothing is configured', async () => {
    expect(await isTrustedDashboardOrigin('http://localhost:3333')).toBe(false);
    expect(await isTrustedDashboardOrigin(CLOUD_DASHBOARD_ORIGIN)).toBe(true);
  });
});
