// src/lib/capabilities.ts

import { createLogger } from '~/lib/utils/logger';

const log = createLogger('CapabilitiesManager');

export interface BackendCapabilities {
  deploymentMode: 'self-hosted' | 'cloud';
  kbManagement: 'dashboard';
  dashboardUrl: string;
  features: {
    extensionKB: boolean;  // Should always be false
    adminKB: boolean;
    teamWorkspaces: boolean;
    caseHistory: boolean;
    sso: boolean;
  };
  limits: {
    maxFileBytes: number;
    allowedExtensions: string[];
    maxDocuments?: number;
  };
  branding?: {
    name: string;
    logoUrl?: string;
    supportUrl?: string;
  };
}

class CapabilitiesManager {
  private capabilities: BackendCapabilities | null = null;
  private fetchPromise: Promise<BackendCapabilities> | null = null;

  async fetch(apiUrl: string): Promise<BackendCapabilities> {
    // Return cached if available
    if (this.capabilities) {
      return this.capabilities;
    }

    // Prevent duplicate requests
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/meta/capabilities`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`Capabilities fetch failed: ${response.status}`);
        }

        const caps = await response.json();
        this.capabilities = caps;

        // Cache in storage for offline access
        if (typeof browser !== 'undefined' && browser.storage) {
          await browser.storage.local.set({ backendCapabilities: caps });
        }

        log.info('Connected to backend', { deploymentMode: caps.deploymentMode });
        return caps;

      } catch (error) {
        log.warn('Fetch failed, trying cache', error);

        // Try cache
        if (typeof browser !== 'undefined' && browser.storage) {
          const cached = await browser.storage.local.get(['backendCapabilities']);
          if (cached.backendCapabilities) {
            this.capabilities = cached.backendCapabilities;
            return this.capabilities;
          }
        }

        // Final fallback: assume self-hosted
        const fallback: BackendCapabilities = {
          deploymentMode: 'self-hosted',
          kbManagement: 'dashboard',
          dashboardUrl: 'http://localhost:3333',
          features: {
            extensionKB: false,
            adminKB: false,
            teamWorkspaces: false,
            caseHistory: false,
            sso: false
          },
          limits: {
            maxFileBytes: 10485760,
            allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv']
          }
        };

        this.capabilities = fallback;
        return fallback;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  getCapabilities(): BackendCapabilities | null {
    return this.capabilities;
  }

  getDashboardUrl(): string | null {
    return this.capabilities?.dashboardUrl ?? null;
  }

  getUploadLimits() {
    return this.capabilities?.limits ?? {
      maxFileBytes: 10485760,
      allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv']
    };
  }
}

export const capabilitiesManager = new CapabilitiesManager();
