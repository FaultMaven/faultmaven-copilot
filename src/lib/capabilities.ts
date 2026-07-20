// src/lib/capabilities.ts

import { createLogger } from '~/lib/utils/logger';
import { fetchWithTimeout } from '~/lib/utils/fetch-timeout';

const log = createLogger('CapabilitiesManager');

/**
 * Where the currently-held capabilities came from. Only `network` is
 * authoritative; `cache`/`fallback` are degraded results served because the
 * fetch failed. Tracked so a degraded result does NOT short-circuit the next
 * fetch (a recovered backend must be re-detected rather than serving a stale
 * fabricated fallback forever).
 */
type CapabilitiesSource = 'network' | 'cache' | 'fallback';

export interface BackendCapabilities {
  deploymentMode: 'self-hosted' | 'cloud';
  kbManagement: 'dashboard';
  dashboardUrl: string;
  features: {
    extensionKB: boolean;  // Should always be false
    adminKB: boolean;
    // Team-based KB/case sharing (ADR-013: Team = the sharing unit). Renamed
    // from the "teamWorkspaces" misnomer — a Slack workspace maps to a Team;
    // the capability is team *sharing*, not a workspace. Wire key must match
    // the backend /v1/meta/capabilities payload.
    teamSharing: boolean;
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

export class CapabilitiesManager {
  private capabilities: BackendCapabilities | null = null;
  private source: CapabilitiesSource | null = null;
  private fetchPromise: Promise<BackendCapabilities> | null = null;

  async fetch(apiUrl: string): Promise<BackendCapabilities> {
    // Only an authoritative (network) result short-circuits future fetches.
    // A cached / fabricated fallback must NOT poison the cache: the backend may
    // be temporarily unreachable and then recover, so a degraded result has to
    // leave the door open for the next call to re-detect a live backend.
    if (this.capabilities && this.source === 'network') {
      return this.capabilities;
    }

    // Prevent duplicate in-flight requests
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const response = await fetchWithTimeout(`${apiUrl}/v1/meta/capabilities`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`Capabilities fetch failed: ${response.status}`);
        }

        const caps = await response.json();
        this.capabilities = caps;
        this.source = 'network';

        // Cache in storage for offline access
        if (typeof browser !== 'undefined' && browser.storage) {
          await browser.storage.local.set({ backendCapabilities: caps });
        }

        log.info('Connected to backend', { deploymentMode: caps.deploymentMode });
        return caps;

      } catch (error) {
        log.warn('Capabilities fetch failed; serving degraded capabilities', error);

        // Try cache
        if (typeof browser !== 'undefined' && browser.storage) {
          const cached = await browser.storage.local.get(['backendCapabilities']);
          if (cached.backendCapabilities) {
            this.capabilities = cached.backendCapabilities;
            this.source = 'cache';
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
            teamSharing: false,
            caseHistory: false,
            sso: false
          },
          limits: {
            maxFileBytes: 10485760,
            allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv']
          }
        };

        this.capabilities = fallback;
        this.source = 'fallback';
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
