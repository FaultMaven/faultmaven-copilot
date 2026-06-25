import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkStatusMonitor } from '~lib/utils/network-status';

// Mock config
vi.mock('~/config', () => ({
  getApiUrl: async () => 'https://api.test.com'
}));

describe('NetworkStatusMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    
    // Reset navigator mock
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true
    });
  });

  describe('isOnline', () => {
    it('returns true when navigator.onLine is true', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      expect(NetworkStatusMonitor.isOnline()).toBe(true);
    });

    it('returns false when navigator.onLine is false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      expect(NetworkStatusMonitor.isOnline()).toBe(false);
    });
  });

  describe('canReachServer', () => {
    it('returns true if health check succeeds', async () => {
      (global.fetch as any).mockResolvedValueOnce({ ok: true });
      
      const result = await NetworkStatusMonitor.canReachServer();
      
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/health', expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'HEAD' })
      );
    });

    it('returns false if health check fails (status not ok)', async () => {
      (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });
      
      const result = await NetworkStatusMonitor.canReachServer();
      
      expect(result).toBe(false);
    });

    it('returns false if fetch throws an error (network failure)', async () => {
      (global.fetch as any).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      
      const result = await NetworkStatusMonitor.canReachServer();
      
      expect(result).toBe(false);
    });
  });
});
