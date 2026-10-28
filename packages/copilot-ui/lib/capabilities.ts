// src/lib/capabilities.ts

import { createLogger } from './utils/logger';
import { fetchWithTimeout } from './utils/fetch-timeout';
import { ownedStorage } from './owned-storage';
import type { components } from '../types/api.generated';
import { deriveTurnTiming, type TurnTiming } from './utils/turn-timing';

/** A network read older than this is re-read before a turn (the bound moves with a provider switch). */
export const CAPABILITIES_TTL_MS = 5 * 60 * 1000;
/**
 * The longest a turn is held by one capabilities probe, counted from the
 * probe's START: every read that joins it waits only what is left, so a turn
 * that reads its timing twice (the hook, then `submitTurn` per attempt) is not
 * held twice by the same slow probe.
 */
export const REFRESH_WAIT_MS = 5_000;

/**
 * The persisted offline copies: `{ [apiUrlKey]: BackendCapabilities }`, most
 * recently read last. One copy PER SERVER, not one slot: every document of the
 * host shares the store, and the options page probing an unsaved URL must not
 * cost a panel on the saved one its copy. Bounded to the servers read last.
 */
const STORED_CAPABILITIES_KEY = 'backendCapabilitiesByUrl';
export const MAX_STORED_CAPABILITIES = 4;

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

/** What is held for one API URL. */
interface HeldCapabilities {
  capabilities: BackendCapabilities;
  source: CapabilitiesSource;
  fetchedAt: number;
}

/** The one spelling of an API URL the manager keys on: no trailing slash. */
function apiUrlKey(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

/**
 * The backend's capabilities, per API URL.
 *
 * Capabilities describe ONE server, and the API URL is a runtime setting: the
 * user changes it in the extension's options, and the options page probes a
 * URL it has not saved yet. So everything here — what is held, the in-flight
 * probe, the persisted offline copy, the fallback warning — is keyed on the
 * URL it was read from, and every read names the URL it is about (#324: an
 * unkeyed singleton served the old server's limits and turn timing after a
 * switch, until the panel reloaded).
 */
export class CapabilitiesManager {
  private held = new Map<string, HeldCapabilities>();
  private inFlight = new Map<string, { probe: Promise<BackendCapabilities>; startedAt: number }>();
  /** The capabilities object (or per-URL "nothing held") the fallback-timing warning was last issued for. */
  private warnedFor: unknown = undefined;

  async fetch(apiUrl: string): Promise<BackendCapabilities> {
    const key = apiUrlKey(apiUrl);

    // Only an authoritative (network) result short-circuits future fetches.
    // A cached / fabricated fallback must NOT poison the cache: the backend may
    // be temporarily unreachable and then recover, so a degraded result has to
    // leave the door open for the next call to re-detect a live backend.
    const held = this.held.get(key);
    if (held && held.source === 'network' && !isStale(held)) {
      return held.capabilities;
    }

    // Prevent duplicate in-flight requests — for the SAME server only: a probe
    // of another URL answers nothing about this one.
    const running = this.inFlight.get(key);
    if (running) {
      return running.probe;
    }

    const startedAt = Date.now();
    let settled = false;
    const probe = (async () => {
      try {
        // UNDER `/api/v1`, like every other client route.
        //
        // This was the one exception, `/v1/meta/capabilities`, and the exception
        // was invisible until a host served the API from its own origin: the
        // Kubernetes ingress forwards `/api` and nothing else, so the request
        // fell through to the SPA's catch-all and came back as `200 text/html`.
        // `response.ok` was true, `json()` threw, and the panel quietly ran on
        // the fabricated fallback below.
        const capabilitiesPath = `${key}/api/v1/meta/capabilities`;
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
        this.held.set(key, { capabilities: caps, source: 'network', fetchedAt: Date.now() });

        // Cache for offline access, under the server it describes. No
        // availability guard: the host store throws when it is not installed,
        // and that is a wiring bug to surface rather than a condition to
        // tiptoe around.
        await storeOfflineCopy(key, caps);

        log.info('Connected to backend', { deploymentMode: caps.deploymentMode });
        return caps;

      } catch (error) {
        // A stale NETWORK read is better than any degraded one: keep it, and
        // the next call (still stale) tries the network again.
        const earlier = this.held.get(key);
        if (earlier && earlier.source === 'network') {
          log.warn('Capabilities re-read failed; keeping the earlier network read', error);
          return earlier.capabilities;
        }
        log.warn('Capabilities fetch failed; serving degraded capabilities', error);

        // Try the offline copy read from THIS server. The single untagged
        // `backendCapabilities` an older build wrote is from an unknown
        // server and is never read.
        const offline = (await readOfflineCopies())[key];
        if (offline) {
          this.held.set(key, { capabilities: offline, source: 'cache', fetchedAt: 0 });
          return offline;
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
            // Built without an answer from the core, so true, as contract 14.7.0 requires.
            multiTenant: true,
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

        this.held.set(key, { capabilities: fallback, source: 'fallback', fetchedAt: 0 });
        return fallback;
      } finally {
        settled = true;
        this.inFlight.delete(key);
      }
    })();

    // A probe that settled without suspending has already run its `finally`;
    // registering it now would leave a settled probe "in flight" for good.
    if (!settled) this.inFlight.set(key, { probe, startedAt });
    return probe;
  }

  /**
   * Re-read the capabilities of `apiUrl` before a turn when the network read
   * held for it is older than `CAPABILITIES_TTL_MS` (a panel can stay open for
   * days and the turn bound moves with an operator's provider switch), or when
   * nothing at all is held for it (the API URL changed since the app's load;
   * during that load this joins its probe). A degraded read held for it is
   * left alone: the app's own load already tried, and a turn must not wait on
   * a probe that keeps failing.
   */
  async refreshIfStale(apiUrl: string): Promise<void> {
    const key = apiUrlKey(apiUrl);
    const held = this.held.get(key);
    if (held && !(held.source === 'network' && isStale(held))) return;

    const probe = this.fetch(apiUrl);
    // A slow probe must not delay the send: it keeps running and a later read
    // takes its result. The wait is the PROBE's, REFRESH_WAIT_MS from its
    // start, not each caller's: a turn reads its timing more than once (the
    // hook, then `submitTurn` per attempt), and a fresh budget per read held
    // the first POST for two budgets and every retry for another.
    const startedAt = this.inFlight.get(key)?.startedAt;
    if (startedAt === undefined) return; // settled already (or never started)
    const remaining = startedAt + REFRESH_WAIT_MS - Date.now();
    if (remaining <= 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      probe,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remaining);
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * The turn request timeout and recovery deadline (`utils/turn-timing.ts`) for
   * a body of `bodyBytes` sent to `apiUrl`, from the bound that server
   * published on the capabilities held for it now (re-read when stale:
   * `refreshIfStale`). A payload without a usable bound (a cache written before
   * 12.4.0, a fallback, an out-of-range value) or nothing held for that URL
   * uses the policy constants — never another server's bound; that is logged
   * once per capabilities object, not on every attempt.
   */
  getTurnTiming(apiUrl: string, bodyBytes = 0): TurnTiming {
    const key = apiUrlKey(apiUrl);
    const held = this.held.get(key);
    const timing = deriveTurnTiming(held?.capabilities.limits?.turnResponseBoundSeconds, bodyBytes);
    const subject = held?.capabilities ?? `${NOTHING_HELD}${key}`;
    if (timing.source === 'fallback' && this.warnedFor !== subject) {
      this.warnedFor = subject;
      log.warn('No usable turnResponseBoundSeconds; using the fallback turn timing', {
        capabilitiesSource: held?.source ?? null,
        requestTimeoutMs: timing.requestTimeoutMs,
        deadlineMs: timing.deadlineMs,
      });
    }
    return timing;
  }
}

type OfflineCopies = Record<string, BackendCapabilities>;

async function readOfflineCopies(): Promise<OfflineCopies> {
  const stored = (await ownedStorage.get([STORED_CAPABILITIES_KEY]))[STORED_CAPABILITIES_KEY];
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as OfflineCopies) : {};
}

/**
 * Put `caps` as `key`'s offline copy, most recent last, keeping the
 * `MAX_STORED_CAPABILITIES` servers read last. Read-modify-write across
 * documents: a concurrent write from another document can lose one copy,
 * which costs only a degraded read while that server is unreachable.
 */
async function storeOfflineCopy(key: string, caps: BackendCapabilities): Promise<void> {
  const others = Object.entries(await readOfflineCopies()).filter(([url]) => url !== key);
  const kept = [...others, [key, caps] as const].slice(-MAX_STORED_CAPABILITIES);
  await ownedStorage.set({ [STORED_CAPABILITIES_KEY]: Object.fromEntries(kept) });
}

function isStale(held: HeldCapabilities): boolean {
  return Date.now() - held.fetchedAt >= CAPABILITIES_TTL_MS;
}

const NOTHING_HELD = 'nothing held for ';

export const capabilitiesManager = new CapabilitiesManager();
