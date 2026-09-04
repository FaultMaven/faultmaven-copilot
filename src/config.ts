// src/config.ts


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
 * Endpoint configuration is NOT here: it is a host concern, and it lives with
 * the host that owns it (see extension/host/endpoints.ts and HostEndpoints).
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

export default config;
