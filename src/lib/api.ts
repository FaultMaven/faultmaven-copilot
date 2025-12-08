// Re-export types
export * from './api/types';

// Re-export Auth
export { authManager } from './auth/auth-manager';
export type { AuthState } from './api/types';

// Re-export Client
export { authenticatedFetch, authenticatedFetchWithRetry } from './api/client';
export { createFreshSession } from './api/fetch-utils';
export { createSession } from './api/session-core';

// Re-export Services
export * from './api/services/auth-service';
export * from './api/services/session-service';
export * from './api/services/case-service';
export * from './api/services/report-service';
export * from './api/services/knowledge-service';

// Re-export Formatters
export * from './api/formatters';

// Re-export Errors
export { SessionExpiredError, AuthenticationError } from './errors/types';
