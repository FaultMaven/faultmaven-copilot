// src/lib/capabilities.ts

import { createLogger } from './utils/logger';
import { fetchWithTimeout } from './utils/fetch-timeout';
import { ownedStorage } from './owned-storage';
import type { components } from '../types/api.generated';
import { deriveTurnTiming, type TurnTiming } from './utils/turn-timing';

/** A network read older than this is re-read before a turn (the bound moves with a provider switch). */
export const CAPABILITIES_TTL_MS = 5 * 60 * 1000;

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
  private fetchedAt = 0;
  /** The capabilities object the fallback-timing warning was last issued for. */
  private warnedFor: unknown = undefined;
  private fetchPromise: Promise<BackendCapabilities> | null = null;

  async fetch(apiUrl: string): Promise<BackendCapabilities> {
    // Only an authoritative (network) result short-circuits future fetches.
    // A cached / fabricated fallback must NOT poison the cache: the backend may
    // be temporarily unreachable and then recover, so a degraded result has to
    // leave the door open for the next call to re-detect a live backend.
    if (this.capabilities && this.source === 'network' && !this.isStale()) {
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
        this.fetchedAt = Date.now();

        // Cache for offline access. No availability guard: the host store
        // throws when it is not installed, and that is a wiring bug to surface
        // rather than a condition to tiptoe around.
        await ownedStorage.set({ backendCapabilities: caps });

        log.info('Connected to backend', { deploymentMode: caps.deploymentMode });
        return caps;

      } catch (error) {
        // A stale NETWORK read is better than any degraded one: keep it, and
        // the next call (still stale) tries the network again.
        if (this.capabilities && this.source === 'network') {
          log.warn('Capabilities re-read failed; keeping the earlier network read', error);
          return this.capabilities;
        }
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

  private isStale(): boolean {
    return Date.now() - this.fetchedAt >= CAPABILITIES_TTL_MS;
  }

  /**
   * Re-read the capabilities before a turn when the network read held is older
   * than `CAPABILITIES_TTL_MS`: a panel can stay open for days and the turn
   * bound moves with an operator's provider switch. Does nothing when nothing
   * authoritative is held (the app's own load covers that) or the read is fresh.
   */
  async refreshIfStale(apiUrl: string): Promise<void> {
    if (this.capabilities && this.source === 'network' && this.isStale()) {
      await this.fetch(apiUrl);
    }
  }

  /**
   * The turn request timeout and recovery deadline (`utils/turn-timing.ts`) for
   * a body of `bodyBytes`, from the bound the API published on the capabilities
   * held now (re-read when stale: `refreshIfStale`). A payload without a usable
   * bound (a cache written before 12.4.0, a fallback, an out-of-range value) or
   * nothing held yet uses the policy constants; that is logged once per
   * capabilities object, not on every attempt.
   */
  getTurnTiming(bodyBytes = 0): TurnTiming {
    const held = this.capabilities;
    const timing = deriveTurnTiming(held?.limits?.turnResponseBoundSeconds, bodyBytes);
    if (timing.source === 'fallback' && this.warnedFor !== (held ?? NOTHING_HELD)) {
      this.warnedFor = held ?? NOTHING_HELD;
      log.warn('No usable turnResponseBoundSeconds; using the fallback turn timing', {
        capabilitiesSource: this.source,
        requestTimeoutMs: timing.requestTimeoutMs,
        deadlineMs: timing.deadlineMs,
      });
    }
    return timing;
  }
}

const NOTHING_HELD = Symbol('nothing held');

export const capabilitiesManager = new CapabilitiesManager();
