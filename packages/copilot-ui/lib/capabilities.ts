// src/lib/capabilities.ts

import { createLogger } from './utils/logger';
import { fetchWithTimeout } from './utils/fetch-timeout';
import { ownedStorage } from './owned-storage';
import type { components } from '../types/api.generated';
import { FALLBACK_TURN_TIMING, deriveTurnTiming, type TurnTiming } from './utils/turn-timing';

const log = createLogger('CapabilitiesManager');

/**
 * Where the currently-held capabilities came from. Only `network` is
 * authoritative; `cache`/`fallback` are degraded results served because the
 * fetch failed. Tracked so a degraded result does NOT short-circuit the next
 * fetch (a recovered backend must be re-detected rather than serving a stale
 * fabricated fallback forever).
 */
type CapabilitiesSource = 'network' | 'cache' | 'fallback';

/**
 * What the backend offers, aliased to the generated schema (the API types the
 * route since contract 12.4.0; there is no second, hand-written shape).
 */
export type BackendCapabilities = components['schemas']['BackendCapabilities'];

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
        // UNDER `/api/v1`, like every other client route.
        //
        // This was the one exception, `/v1/meta/capabilities`, and the exception
        // was invisible until a host served the API from its own origin: the
        // Kubernetes ingress forwards `/api` and nothing else, so the request
        // fell through to the SPA's catch-all and came back as `200 text/html`.
        // `response.ok` was true, `json()` threw, and the panel quietly ran on
        // the fabricated fallback below.
        const capabilitiesPath = `${apiUrl}/api/v1/meta/capabilities`;
        const response = await fetchWithTimeout(capabilitiesPath, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`Capabilities fetch failed: ${response.status}`);
        }

        // A 200 whose body is not JSON is the SPA-rewrite shape, and it is
        // worth saying so at error level with the path in hand: as a warning it
        // was indistinguishable from an offline blip and nobody read it.
        //
        // The body decides, not the content-type header: a live API answering
        // JSON under an odd or absent content-type is still a live API, and the
        // shape being caught here is by definition one that will not parse.
        let caps: BackendCapabilities;
        try {
          caps = await response.json();
        } catch {
          const contentType = response.headers.get('content-type') ?? '';
          log.error(
            'Capabilities probe returned a non-JSON 200 — the request is not reaching the API',
            { path: capabilitiesPath, contentType },
          );
          throw new Error(
            `Capabilities probe returned ${contentType || 'a body'} that is not JSON`,
          );
        }
        this.capabilities = caps;
        this.source = 'network';

        // Cache for offline access. No availability guard: the host store
        // throws when it is not installed, and that is a wiring bug to surface
        // rather than a condition to tiptoe around.
        await ownedStorage.set({ backendCapabilities: caps });

        log.info('Connected to backend', { deploymentMode: caps.deploymentMode });
        return caps;

      } catch (error) {
        log.warn('Capabilities fetch failed; serving degraded capabilities', error);

        // Try cache
        const cached = (await ownedStorage.get(['backendCapabilities'])) as {
          backendCapabilities?: BackendCapabilities;
        };
        if (cached.backendCapabilities) {
          this.capabilities = cached.backendCapabilities;
          this.source = 'cache';
          return this.capabilities;
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
            sso: false,
            managementConsole: false,
          },
          limits: {
            maxFileBytes: 10485760,
            allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv'],
            // Required by the schema, published by no one here: 0 is not a usable
            // bound, so turn timing falls back to its own constants.
            turnCeilingSeconds: 0,
            turnResponseBoundSeconds: 0,
          },
          branding: { name: 'FaultMaven', supportUrl: '' },
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
    const limits = this.capabilities?.limits;
    return {
      maxFileBytes: limits?.maxFileBytes ?? 10485760,
      allowedExtensions: limits?.allowedExtensions ?? ['.md', '.txt', '.log', '.json', '.csv'],
    };
  }

  /**
   * The turn request timeout and recovery deadline (`utils/turn-timing.ts`),
   * from the bound the API published on the capabilities held now. Read per
   * submission, so a panel session that re-reads capabilities follows an
   * operator's provider switch. A fallback result, a payload without the
   * field (a cache written before 12.4.0) or nothing held yet uses the policy
   * constants, and says so.
   */
  getTurnTiming(): TurnTiming {
    if (this.capabilities) {
      const timing = deriveTurnTiming(this.capabilities.limits?.turnResponseBoundSeconds);
      if (timing.source === 'published') return timing;
      log.warn('Capabilities carry no usable turnResponseBoundSeconds; using the fallback turn timing', {
        capabilitiesSource: this.source,
        ...FALLBACK_TURN_TIMING,
      });
      return timing;
    }
    log.warn('No live capabilities; using the fallback turn timing', {
      capabilitiesSource: this.source,
      ...FALLBACK_TURN_TIMING,
    });
    return FALLBACK_TURN_TIMING;
  }
}

export const capabilitiesManager = new CapabilitiesManager();
