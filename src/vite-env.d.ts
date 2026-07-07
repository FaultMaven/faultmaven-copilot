/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SESSION_TIMEOUT_MINUTES?: string;
  readonly VITE_DATA_MODE_LINES?: string;
  readonly VITE_MAX_QUERY_LENGTH?: string;
  readonly VITE_MAX_FILE_SIZE_MB?: string;
  readonly VITE_DASHBOARD_URL?: string;
  readonly VITE_DEBUG?: string;
  readonly VITE_POLL_INITIAL_MS?: string;
  readonly VITE_POLL_BACKOFF?: string;
  readonly VITE_POLL_MAX_MS?: string;
  readonly VITE_POLL_MAX_TOTAL_MS?: string;
  readonly VITE_HEARTBEAT_INTERVAL_MS?: string;
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
