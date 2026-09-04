// Re-export types
export * from './api/types';

// The CREDENTIAL stack is deliberately absent.
//
// `authManager` and the auth service used to be re-exported here, and this
// barrel is imported by most of the shared UI — for TYPES, mostly, but an import
// is an import — so every component pulled in the token manager, the refresh
// lock and the storage key behind them. That is the whole route by which a
// second host would have inherited a second auth stack. The extension imports
// them from their own modules; the shared tree cannot reach them at all.
export type { AuthState } from './api/types';

// Re-export Client
export { authenticatedFetch, authenticatedFetchWithRetry } from './api/client';
export { createSession } from './api/session-core';

// Re-export Services
export * from './api/services/session-service';
export * from './api/services/case-service';
export * from './api/services/knowledge-service';

// Re-export Formatters
export * from './api/formatters';

// Re-export Errors
export { SessionExpiredError, AuthenticationError } from './errors/types';
