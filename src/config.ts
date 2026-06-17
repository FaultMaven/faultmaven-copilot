// src/config.ts

import { browser } from 'wxt/browser';
import { createLogger } from './lib/utils/logger';

const log = createLogger('Config');

interface InputLimitsConfig {
  /** Smart detection threshold: text >= this many lines is treated as data upload */
  dataModeLinesThreshold: number;
  /** Maximum character length for input */
  maxQueryLength: number;
  /** Textarea auto-sizing minimum rows */
  textareaMinRows: number;
  /** Textarea auto-sizing maximum rows */
  textareaMaxRows: number;
  /** Maximum file upload size in bytes */
  maxFileSize: number;
  /** Allowed file extensions for upload */
  allowedFileExtensions: readonly string[];
  /** Allowed MIME types for uploaded files */
  allowedMimeTypes: readonly string[];
}

interface SessionConfig {
  /** Session timeout in milliseconds */
  timeoutMs: number;
  /** Session timeout in minutes */
  timeoutMinutes: number;
}

interface Config {
  inputLimits: InputLimitsConfig;
  session: SessionConfig;
}

/**
 * Application Configuration
 *
 * RUNTIME CONFIGURATION:
 * API URL is now configured at runtime via Settings page (stored in browser.storage.local)
 * Use getApiUrl() to retrieve the current API endpoint
 *
 * Environment Variables (set before build):
 * - VITE_DATA_MODE_LINES: Lines threshold for data mode (default: 100)
 * - VITE_MAX_QUERY_LENGTH: Max input characters (default: 200000 = 200KB, matches backend)
 * - VITE_MAX_FILE_SIZE_MB: Max file size in MB (default: 10, matches backend MAX_UPLOAD_SIZE_MB)
 * - VITE_SESSION_TIMEOUT_MINUTES: Session timeout in minutes (default: 180 = 3 hours)
 */
const sessionTimeoutMinutes = parseInt(import.meta.env.VITE_SESSION_TIMEOUT_MINUTES || '180', 10);

const config: Config = {
  // Input Limits Configuration (build-time only, rarely changed)
  inputLimits: {
    dataModeLinesThreshold: parseInt(import.meta.env.VITE_DATA_MODE_LINES || '100', 10),
    // Match backend query max_length=200000 (200KB)
    maxQueryLength: parseInt(import.meta.env.VITE_MAX_QUERY_LENGTH || '200000', 10),
    textareaMinRows: 2,
    textareaMaxRows: 8,
    // Match backend MAX_UPLOAD_SIZE_MB=10
    maxFileSize: (parseInt(import.meta.env.VITE_MAX_FILE_SIZE_MB || '10', 10)) * 1024 * 1024,
    allowedFileExtensions: ['.txt', '.log', '.json', '.csv', '.md'],
    allowedMimeTypes: ['text/plain', 'text/markdown', 'application/json', 'text/csv'],
  },
  session: {
    timeoutMinutes: sessionTimeoutMinutes,
    timeoutMs: sessionTimeoutMinutes * 60 * 1000,
  }
};

// Default URLs (zero-config Cloud)
const CLOUD_DASHBOARD_URL = 'https://app.faultmaven.ai';
const CLOUD_API_URL = 'https://api.faultmaven.ai';

// The two endpoints are configured EXPLICITLY and independently — the API URL is
// no longer derived from the Dashboard URL (see docs/SELF_HOSTING.md).
export const API_BASE_URL_KEY = 'apiBaseUrl';
export const DASHBOARD_URL_KEY = 'dashboardUrl';
// Legacy key (pre-explicit config): held the Dashboard URL; the API was derived.
const LEGACY_ENDPOINT_KEY = 'apiEndpoint';

/** Trim and strip any trailing slash. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate an endpoint URL against the deployment-tier rules:
 * - must be a valid http(s) URL
 * - non-localhost hosts must use https (browser secure-context requirement)
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
  const isLoopback = parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '0.0.0.0';
  if (parsed.protocol === 'http:' && !isLoopback) {
    return 'Non-localhost endpoints must use https:// (browser secure-context requirement)';
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
    await browser.storage.local.set(toWrite);
  }
}

/**
 * Get the API base URL the copilot talks to.
 *
 * Priority: explicit apiBaseUrl → one-time migration from the legacy
 * apiEndpoint key → Cloud default (safe for zero-config distribution).
 */
export async function getApiUrl(): Promise<string> {
  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const stored = await browser.storage.local.get([API_BASE_URL_KEY, LEGACY_ENDPOINT_KEY]);
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
          await browser.storage.local.set({
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
  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const stored = await browser.storage.local.get([DASHBOARD_URL_KEY, LEGACY_ENDPOINT_KEY]);
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

export default config;
