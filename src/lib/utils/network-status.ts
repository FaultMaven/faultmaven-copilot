// src/lib/utils/network-status.ts

import { getApiUrl } from '../../config';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('NetworkStatus');

/**
 * Network status monitor for detecting connectivity issues
 */
export class NetworkStatusMonitor {
  private static listeners: Set<(isOnline: boolean) => void> = new Set();
  private static isMonitoring = false;

  /**
   * Check if browser reports being online
   */
  static isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * Check if we can actually reach the FaultMaven server
   * More reliable than navigator.onLine
   */
  static async canReachServer(): Promise<boolean> {
    try {
      const apiUrl = await getApiUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${apiUrl}/health`, {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.warn('[NetworkStatus] Server health check failed:', error);
      return false;
    }
  }

  /**
   * Start monitoring network status changes
   *
   * @param onStatusChange - Callback when network status changes
   * @returns Cleanup function to stop monitoring
   *
   * @example
   * ```typescript
   * const cleanup = NetworkStatusMonitor.startMonitoring((isOnline) => {
   *   if (isOnline) {
   *     console.log('Network restored!');
   *   } else {
   *     console.log('Network lost!');
   *   }
   * });
   *
   * // Later...
   * cleanup(); // Stop monitoring
   * ```
   */
  static startMonitoring(onStatusChange: (isOnline: boolean) => void): () => void {
    // Add listener
    this.listeners.add(onStatusChange);

    // Start monitoring if not already started
    if (!this.isMonitoring && typeof window !== 'undefined') {
      this.isMonitoring = true;

      const handleOnline = () => {
        log.info('Browser online event');
        this.notifyListeners(true);
      };

      const handleOffline = () => {
        log.info('Browser offline event');
        this.notifyListeners(false);
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Store cleanup for when all listeners are removed
      (this as any)._cleanup = () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        this.isMonitoring = false;
      };
    }

    // Return cleanup function for this specific listener
    return () => {
      this.listeners.delete(onStatusChange);

      // If no more listeners, stop monitoring
      if (this.listeners.size === 0 && (this as any)._cleanup) {
        (this as any)._cleanup();
        delete (this as any)._cleanup;
      }
    };
  }

  /**
   * Notify all listeners of status change
   */
  private static notifyListeners(isOnline: boolean) {
    this.listeners.forEach(listener => {
      try {
        listener(isOnline);
      } catch (error) {
        console.error('[NetworkStatus] Listener error:', error);
      }
    });
  }

  /**
   * Wait for network to be available
   *
   * @param timeout - Maximum time to wait in ms (default: 30000)
   * @returns Promise that resolves when network is available or rejects on timeout
   */
  static async waitForNetwork(timeout: number = 30000): Promise<void> {
    // Check if already online
    if (this.isOnline()) {
      const canReach = await this.canReachServer();
      if (canReach) return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Network wait timeout'));
      }, timeout);

      const cleanup = this.startMonitoring(async (isOnline) => {
        if (isOnline) {
          const canReach = await this.canReachServer();
          if (canReach) {
            clearTimeout(timeoutId);
            cleanup();
            resolve();
          }
        }
      });
    });
  }

  /**
   * Check network connectivity with detailed diagnostics
   */
  static async checkConnectivity(): Promise<{
    browserOnline: boolean;
    serverReachable: boolean;
    latency?: number;
    diagnosis: string;
  }> {
    const browserOnline = this.isOnline();

    if (!browserOnline) {
      return {
        browserOnline: false,
        serverReachable: false,
        diagnosis: 'Browser is offline. Check your network connection.'
      };
    }

    // Measure server reachability and latency
    const startTime = Date.now();
    const serverReachable = await this.canReachServer();
    const latency = Date.now() - startTime;

    if (!serverReachable) {
      if (latency > 4000) {
        return {
          browserOnline: true,
          serverReachable: false,
          latency,
          diagnosis: 'Server is not responding (timeout). The service may be down or experiencing issues.'
        };
      } else {
        return {
          browserOnline: true,
          serverReachable: false,
          latency,
          diagnosis: 'Cannot reach FaultMaven server. The service may be temporarily unavailable.'
        };
      }
    }

    return {
      browserOnline: true,
      serverReachable: true,
      latency,
      diagnosis: latency > 1000
        ? `Connected, but server is slow (${latency}ms). Responses may be delayed.`
        : 'Connected and healthy.'
    };
  }
}
