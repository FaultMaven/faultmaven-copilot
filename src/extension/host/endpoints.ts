/**
 * Where this extension talks to, and how that is remembered.
 *
 * Split out of `src/config.ts`, which is now build-time constants only. These
 * are not constants: they are a user's choice, persisted, migrated from a legacy
 * key, and specific to a host that HAS a settings page. A web host is served by
 * the deployment it talks to and has nothing to choose, which is why this is the
 * extension's file and `HostEndpoints` is the shared question it answers.
 *
 * Storage goes through the host store rather than the extension API directly, so
 * this module carries no `browser` dependency of its own.
 */
import { getHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { extensionStore } from './extension-store';
import type { HostEndpoints } from '@faultmaven/copilot-ui/shared/host';

const log = createLogger('Endpoints');

// Default URLs (zero-config Cloud)
const CLOUD_DASHBOARD_URL = 'https://app.faultmaven.ai';
const CLOUD_API_URL = 'https://api.faultmaven.ai';

// The two endpoints are configured EXPLICITLY and independently — the API URL is
// no longer derived from the Dashboard URL (see docs/SELF_HOSTING.md).
export const API_BASE_URL_KEY = 'apiBaseUrl';
export const DASHBOARD_URL_KEY = 'dashboardUrl';
// Legacy key (pre-explicit config): held the Dashboard URL; the API was derived.
// Exported because `useConfiguredEndpoint` subscribes to it by name; it used to
// spell the same string inline, where a rename here would not have reached it.
export const LEGACY_ENDPOINT_KEY = 'apiEndpoint';

/** Trim and strip any trailing slash. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate an endpoint URL. Must be a valid http(s) URL.
 *
 * Plain http is allowed for ANY host (including LAN IPs / custom domains):
 * extension pages bypass CORS for granted host_permissions and are not subject
 * to mixed-content blocking, so the copilot can reach an http self-hosted
 * backend directly once the user grants host permission. https remains
 * advisable on untrusted networks (tokens travel in cleartext over http), but
 * that is a recommendation, not a hard requirement enforced here.
 *
 * @returns an error message, or null if valid.
 */
export function validateEndpointUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(normalizeUrl(url));
  } catch {
    return 'Enter a valid URL, e.g. https://fm.example.com';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL must start with http:// or https://';
  }
  return null;
}

/**
 * One-time migration helper: derive an API URL from a legacy Dashboard URL,
 * mirroring the old app.->api. / :3333->:8090 rule. Used only to seed the new
 * explicit keys for installs that predate explicit configuration.
 */
function deriveLegacyApiUrl(dashboardUrl: string): string {
  if (dashboardUrl.includes('localhost') ||
      dashboardUrl.includes('127.0.0.1') ||
      dashboardUrl.includes(':3333')) {
    return dashboardUrl.replace(':3333', ':8090');
  }
  // Anchor to the host label so e.g. "myapp.example.com" is not mangled into
  // "myapi.example.com". A custom domain with no "app." subdomain is returned
  // unchanged — the user corrects it explicitly on the Options page.
  return dashboardUrl.replace('://app.', '://api.');
}

/**
 * Persist the configured endpoint(s). Each is validated; values are normalized.
 * Pass only the field(s) you want to change.
 */
export async function setEndpoints(opts: { apiBaseUrl?: string; dashboardUrl?: string }): Promise<void> {
  const toWrite: Record<string, string> = {};
  if (opts.apiBaseUrl !== undefined) {
    const err = validateEndpointUrl(opts.apiBaseUrl);
    if (err) throw new Error(err);
    toWrite[API_BASE_URL_KEY] = normalizeUrl(opts.apiBaseUrl);
  }
  if (opts.dashboardUrl !== undefined) {
    const err = validateEndpointUrl(opts.dashboardUrl);
    if (err) throw new Error(err);
    toWrite[DASHBOARD_URL_KEY] = normalizeUrl(opts.dashboardUrl);
  }
  if (Object.keys(toWrite).length > 0) {
    await getHostStore().set(toWrite);
    // Changing the endpoint can change the auth mode (e.g. standalone→cloud).
    // Invalidate the cached auth config so TokenManager re-derives the refresh
    // endpoint instead of routing to the previous deployment's (#110). Dynamic
    // import avoids a static config↔auth-config cycle (auth-config imports
    // getApiUrl from here); it's runtime-only, so the cycle never materializes.
    try {
      const { clearAuthConfigCache } = await import('../auth/auth-config');
      await clearAuthConfigCache();
    } catch (err) {
      log.warn('Failed to invalidate auth config cache after endpoint change', err);
    }
  }
}

/**
 * Get the API base URL the copilot talks to.
 *
 * Priority: explicit apiBaseUrl → one-time migration from the legacy
 * apiEndpoint key → Cloud default (safe for zero-config distribution).
 */
export async function getApiUrl(): Promise<string> {
  // OUTSIDE the try, deliberately. A storage read that fails is a hiccup and the
  // Cloud default is a reasonable answer; a store that was never installed is a
  // WIRING BUG, and answering it with the Cloud default would point a
  // self-hosted deployment's background worker at api.faultmaven.ai and say
  // nothing. The two failures look identical from inside the catch, so they are
  // separated here.
  const store = getHostStore();
  try {
    {
      const stored = (await store.get([API_BASE_URL_KEY, LEGACY_ENDPOINT_KEY])) as
        Record<string, string | undefined>;
      if (stored[API_BASE_URL_KEY]) {
        return stored[API_BASE_URL_KEY];
      }
      // Legacy migration: the old apiEndpoint held the Dashboard URL. Seed the
      // new explicit keys once, then use them going forward.
      if (stored[LEGACY_ENDPOINT_KEY]) {
        const migratedApi = normalizeUrl(deriveLegacyApiUrl(stored[LEGACY_ENDPOINT_KEY]));
        // Seed the new keys, but never let a transient write failure drop the
        // already-computed endpoint — a self-hoster must not silently fall back
        // to Cloud just because storage.set hiccupped.
        try {
          await store.set({
            [API_BASE_URL_KEY]: migratedApi,
            [DASHBOARD_URL_KEY]: normalizeUrl(stored[LEGACY_ENDPOINT_KEY]),
          });
          log.info('Migrated legacy apiEndpoint to explicit apiBaseUrl/dashboardUrl');
        } catch (writeErr) {
          log.warn('Legacy migration seed-write failed; using derived value for this call', writeErr);
        }
        return migratedApi;
      }
    }
  } catch (error) {
    log.warn('Failed to read apiBaseUrl from storage:', error);
  }
  return CLOUD_API_URL;
}

/**
 * Get the Dashboard URL (OAuth redirect + dashboard deep-links).
 *
 * Priority: explicit dashboardUrl → legacy apiEndpoint → Cloud default.
 */
export async function getDashboardUrl(): Promise<string> {
  // Outside the try for the same reason as getApiUrl().
  const store = getHostStore();
  try {
    {
      const stored = (await store.get([DASHBOARD_URL_KEY, LEGACY_ENDPOINT_KEY])) as
        Record<string, string | undefined>;
      if (stored[DASHBOARD_URL_KEY]) {
        return stored[DASHBOARD_URL_KEY];
      }
      if (stored[LEGACY_ENDPOINT_KEY]) {
        return normalizeUrl(stored[LEGACY_ENDPOINT_KEY]);
      }
    }
  } catch (error) {
    log.warn('Failed to read dashboardUrl from storage:', error);
  }
  return CLOUD_DASHBOARD_URL;
}

/**
 * The extension's answer to `HostEndpoints`.
 *
 * `subscribe` watches the keys that hold the choice, so an Options-page save
 * reaches the panel while it is open. A web host is served BY its deployment
 * and answers fixed values whose subscription never fires — the shared UI needs
 * no branch for the difference.
 */
export const extensionEndpoints: HostEndpoints = {
  apiUrl: () => getApiUrl(),
  dashboardUrl: () => getDashboardUrl(),
  subscribe: (onChange) =>
    extensionStore.subscribe([API_BASE_URL_KEY, DASHBOARD_URL_KEY, LEGACY_ENDPOINT_KEY], onChange),
};
