// src/config.ts


interface InputLimitsConfig {
  /**
   * A paste EVENT of at least this many lines into the chat box goes to the
   * textpad as data (#327). Typing never triggers it. Never below 2.
   */
  pasteToTextpadLines: number;
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
 * - VITE_PASTE_TO_TEXTPAD_LINES: A paste of this many lines or more goes to the textpad (default: 3, minimum: 2)
 * - VITE_MAX_QUERY_LENGTH: Max input characters (default: 200000 = 200KB, matches backend)
 * - VITE_MAX_FILE_SIZE_MB: Max file size in MB (default: 10, matches backend MAX_UPLOAD_SIZE_MB)
 * - VITE_SESSION_TIMEOUT_MINUTES: Session timeout in minutes (default: 180 = 3 hours)
 */
/**
 * An integer build-time knob, or `fallback` when it is unset OR unparseable.
 *
 * Not `parseInt(value || default)`: that only covers the empty string, and
 * `parseInt('abc')` is NaN — which then slips through every Math.min/Math.max
 * clamp downstream (the session timeout went out as `timeout_minutes: null`).
 */
function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const sessionTimeoutMinutes = intFromEnv(import.meta.env.VITE_SESSION_TIMEOUT_MINUTES, 180);

const config: Config = {
  // Input Limits Configuration (build-time only, rarely changed)
  inputLimits: {
    // One line would send every pasted word or URL to the textpad.
    pasteToTextpadLines: Math.max(2, intFromEnv(import.meta.env.VITE_PASTE_TO_TEXTPAD_LINES, 3)),
    // Match backend query max_length=200000 (200KB)
    maxQueryLength: intFromEnv(import.meta.env.VITE_MAX_QUERY_LENGTH, 200000),
    textareaMinRows: 2,
    textareaMaxRows: 8,
    // Match backend MAX_UPLOAD_SIZE_MB=10
    maxFileSize: intFromEnv(import.meta.env.VITE_MAX_FILE_SIZE_MB, 10) * 1024 * 1024,
    allowedFileExtensions: ['.txt', '.log', '.json', '.csv', '.md'],
    allowedMimeTypes: ['text/plain', 'text/markdown', 'application/json', 'text/csv'],
  },
  session: {
    timeoutMinutes: sessionTimeoutMinutes,
    timeoutMs: sessionTimeoutMinutes * 60 * 1000,
  }
};

export default config;
