// src/config.ts

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
    // Match backend QueryRequest.query max_length=200000 (200KB)
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

/**
 * Runtime Configuration: Get API URL derived from Dashboard URL
 *
 * IMPORTANT: Extension stores Dashboard URL (not API URL) because users
 * always interact with Dashboard first (for OAuth login).
 *
 * This function derives the API URL from the Dashboard URL:
 * - Local: http://127.0.0.1:3333 → http://127.0.0.1:8090
 * - Cloud: https://app.faultmaven.ai → https://api.faultmaven.ai
 *
 * Priority order:
 * 1. Derive from user-configured Dashboard URL (stored in apiEndpoint key)
 * 2. Build-time environment variable (VITE_API_URL)
 * 3. Hardcoded default (https://api.faultmaven.ai)
 *
 * Performance: Uses browser.storage.local (NOT sync) for fast access
 *
 * @returns API endpoint URL
 */
export async function getApiUrl(): Promise<string> {
  try {
    // Check if running in browser extension environment
    if (typeof browser !== 'undefined' && browser.storage) {
      const stored = await browser.storage.local.get(['apiEndpoint']);
      if (stored.apiEndpoint) {
        const dashboardUrl = stored.apiEndpoint;

        // Derive API URL from Dashboard URL
        // Local deployment: Replace Dashboard port (3333) with API port (8090)
        if (dashboardUrl.includes('localhost') || dashboardUrl.includes('127.0.0.1')) {
          return dashboardUrl.replace(':3333', ':8090');
        }

        // Cloud deployment: Replace app subdomain with api subdomain
        // https://app.faultmaven.ai → https://api.faultmaven.ai
        return dashboardUrl.replace('app.', 'api.');
      }
    }
  } catch (error) {
    log.warn('Failed to read apiEndpoint from storage:', error);
  }

  // Fallback 1: Build-time environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Fallback 2: Production default
  return 'https://api.faultmaven.ai';
}

export default config;
