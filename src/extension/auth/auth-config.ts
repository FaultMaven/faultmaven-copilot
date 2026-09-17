/**
 * Auth Configuration API Client
 *
 * Queries the backend to determine which authentication mode is active.
 * Enables deployment-neutral authentication (local vs OIDC/SAML).
 */

import type { components } from '@faultmaven/copilot-ui/types/api.generated';
import { getHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { fetchWithTimeout } from '@faultmaven/copilot-ui/lib/utils/fetch-timeout';

const log = createLogger('AuthConfig');

// Bound the /auth/config fetch: getAuthConfig() is called from TokenManager while
// it holds the 'faultmaven-token-refresh' Web Lock, so a hung request here would
// pin that mutex and stall every other context's refresh. On timeout/failure the
// caller falls back to the last-known-good cached config.
const AUTH_CONFIG_TIMEOUT_MS = 10_000;

type AuthConfigSchema = components['schemas']['AuthConfigResponse'];

/**
 * `GET /api/v1/auth/config` as it arrives on the wire.
 *
 * Derived from the generated contract, not hand-written. It was hand-written,
 * and that is the blind spot faultmaven-dashboard#163 was filed about: a field
 * renamed or removed upstream compiles clean here, because `api-types-drift`
 * only diffs the generated file and this module never imported it. Concretely,
 * a rename of `auth_mode` or of the `oauth` block would leave
 * `backendConfig.auth_mode === 'local' ? 'local' : 'oidc'` silently answering
 * `oidc`, and `TokenManager` would pick the wrong refresh endpoint — the #110
 * failure, with nothing red.
 *
 * Every field OPTIONAL, because this is an unvalidated body from a server of
 * unknown version: `openapi-typescript` renders a defaulted field as required,
 * which is a promise about a conformant server rather than about this
 * response. And `oauth` is bound by INDEXED ACCESS — `Omit<T, 'oauth'>`
 * no-ops once the key is gone, so an independently-named arm would supply it
 * back and the rename would compile.
 */
type BackendAuthConfig = Partial<Omit<AuthConfigSchema, 'oauth'>> & {
  oauth?: Partial<NonNullable<AuthConfigSchema['oauth']>> | null;
};

/**
 * Auth provider configuration (internal format)
 */
export interface AuthConfig {
  provider: 'local' | 'oidc' | 'saml';
  login_url?: string;
  features: {
    supports_registration: boolean;
    supports_password_reset: boolean;
    supports_email_verification: boolean;
    requires_redirect: boolean;  // True for OIDC/SAML
  };
}

/**
 * Cached auth config (avoid repeated API calls)
 */
let cachedAuthConfig: AuthConfig | null = null;

/**
 * Config cache version (increment to force cache invalidation on updates)
 */
const CONFIG_CACHE_VERSION = 2;  // Incremented for local auth implementation

/** Storage key for the last-known-good auth config (survives SW restarts). */
const AUTH_CONFIG_CACHE_KEY = 'auth_config_cache';

/**
 * Get authentication configuration from backend
 *
 * This tells the extension which authentication mode is active:
 * - local: Show username/password form
 * - oidc: Show "Sign in with Organization" button
 * - saml: Show SAML SSO button
 *
 * @returns Auth configuration
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  // Check cache version in storage and clear if outdated
  if (typeof browser !== 'undefined' && browser.storage) {
    try {
      const stored = await browser.storage.local.get(['auth_config_version']);
      const storedVersion = stored.auth_config_version || 0;

      if (storedVersion < CONFIG_CACHE_VERSION) {
        log.info(`Cache version mismatch (${storedVersion} < ${CONFIG_CACHE_VERSION}), clearing cache`);
        cachedAuthConfig = null;
        await browser.storage.local.set({ auth_config_version: CONFIG_CACHE_VERSION });
        await browser.storage.local.remove([AUTH_CONFIG_CACHE_KEY]);
      }
    } catch (err) {
      log.warn('Failed to check cache version:', err);
    }
  }

  // Return cached config if available
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  try {
    const apiUrl = await getHostEndpoints().apiUrl();
    const response = await fetchWithTimeout(`${apiUrl}/api/v1/auth/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    }, AUTH_CONFIG_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`Auth config failed: ${response.status}`);
    }

    const backendConfig: BackendAuthConfig = await response.json();

    // Transform backend response to AuthConfig format
    const config: AuthConfig = {
      provider: backendConfig.auth_mode === 'local' ? 'local' : 'oidc',
      // `?? undefined`: the contract types this `string | null`, and the
      // internal shape wants `string | undefined`. The hand-written type used
      // to claim it was never null, so this coercion was invisible — binding
      // to the contract is what surfaced it.
      login_url: backendConfig.login_endpoint ?? undefined,
      features: {
        // Absent reads as NO. An older or partial response that omits the
        // field must not be read as "registration is supported"; the
        // hand-written type declared it required, so this could not be
        // considered before.
        supports_registration: backendConfig.supports_registration === true,
        supports_password_reset: false,  // Not supported yet
        supports_email_verification: false,  // Not supported yet
        requires_redirect: backendConfig.auth_mode === 'oauth'  // OAuth requires redirect to Dashboard
      }
    };

    // Cache the config (in-memory + persisted, so a later transient failure
    // can fall back to the real config instead of defaulting to local).
    cachedAuthConfig = config;
    try {
      await browser.storage.local.set({ [AUTH_CONFIG_CACHE_KEY]: config });
    } catch (persistErr) {
      log.warn('Failed to persist auth config:', persistErr);
    }

    log.info('Retrieved auth configuration:', config.provider);
    return config;

  } catch (error) {
    log.error('Failed to get auth config:', error);

    // Prefer the last-known-good config over silently switching the user to a
    // local username/password form — that would be wrong for a cloud/OAuth
    // deployment hit by a transient config-fetch failure.
    try {
      const stored = await browser.storage.local.get([AUTH_CONFIG_CACHE_KEY]);
      const lastKnown = stored?.[AUTH_CONFIG_CACHE_KEY] as AuthConfig | undefined;
      if (lastKnown?.provider) {
        log.warn('Using last-known-good auth config after fetch failure', { provider: lastKnown.provider });
        cachedAuthConfig = lastKnown;
        return lastKnown;
      }
    } catch (cacheErr) {
      log.warn('Failed to read cached auth config:', cacheErr);
    }

    // No prior config (e.g. first run while offline) — fall back to local.
    const fallbackConfig: AuthConfig = {
      provider: 'local',
      features: {
        supports_registration: true,
        supports_password_reset: true,
        supports_email_verification: false,
        requires_redirect: false
      }
    };

    return fallbackConfig;
  }
}

/**
 * Clear the cached auth config (force a fresh fetch on the next call).
 *
 * Clears BOTH the in-memory cache and the persisted `auth_config_cache` key —
 * the latter is the stale-fallback getAuthConfig reads when a live fetch fails,
 * so leaving it behind would let a superseded auth mode survive an endpoint
 * change and route TokenManager's refresh to the wrong endpoint (#110).
 */
export async function clearAuthConfigCache(): Promise<void> {
  cachedAuthConfig = null;
  if (typeof browser !== 'undefined' && browser.storage) {
    await browser.storage.local.remove([AUTH_CONFIG_CACHE_KEY]);
  }
}
