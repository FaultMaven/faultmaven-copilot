# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **FaultMaven Copilot** browser extension - an AI-powered troubleshooting copilot built with WXT framework. The extension provides in-context help, analyzes web content, and enables interaction with the FaultMaven AI to diagnose and resolve issues efficiently.

**Key Technologies**: WXT v0.20.6, React 19.x, TypeScript 5.x, Tailwind CSS, Vitest, TanStack Query 5.x.

## Common Commands

### Development
```bash
pnpm install                    # Install dependencies
pnpm dev                        # Chrome development with HMR
pnpm dev:firefox                # Firefox development
npm run compile                 # TypeScript compilation check
```

### Building and Packaging
```bash
pnpm build                      # Chrome production build
pnpm build:firefox              # Firefox production build
pnpm zip                        # Package for Chrome Web Store
pnpm zip:firefox                # Package for Firefox Add-ons
```

### Testing
```bash
npm run test                    # Run all tests (Vitest)
pnpm test --watch               # Run tests in watch mode
pnpm test:ui                    # Run tests with UI
pnpm test:coverage              # Generate coverage report
```

### Asset Generation
```bash
pnpm generate-icons             # Generate extension icons from SVG
```

## Configuration

### Environment Variables
All configuration is done via environment variables (set before build). Copy `.env.example` to `.env.local`.

**Core Variables:**
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_DASHBOARD_URL` | Dashboard URL for OAuth | `http://localhost:3333` |
| `VITE_API_URL` | Backend API endpoint (deprecated - derived from dashboard) | - |
| `VITE_DEBUG` | Enable debug logging | `false` |

**Polling Configuration:**
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_POLL_INITIAL_MS` | Initial polling interval | `1500` |
| `VITE_POLL_BACKOFF` | Polling backoff multiplier | `1.5` |
| `VITE_POLL_MAX_MS` | Maximum polling interval | `10000` |
| `VITE_POLL_MAX_TOTAL_MS` | Maximum total polling time | `600000` (10 min) |
| `VITE_HEARTBEAT_INTERVAL_MS` | Session keep-alive ping interval (keep below the server session TTL) | `600000` (10 min) |

**Input Limits:**
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_DATA_MODE_LINES` | Lines threshold for data upload mode | `100` |
| `VITE_MAX_QUERY_LENGTH` | Maximum query length (chars) | `200000` |
| `VITE_MAX_FILE_SIZE_MB` | Maximum file upload size | `10` |

**Configuration Files:**
- **`src/config.ts`** - Central runtime configuration
- **`.env.example`** - Documentation of all available variables

## High-Level Architecture

### Directory Structure
```
src/
├── entrypoints/               # WXT entry points
│   ├── background.ts                    # Service worker (auth, sessions, messages)
│   ├── auth-bridge.content.ts           # OAuth bridge content script
│   ├── sidepanel_manual/main.tsx        # React side panel entry
│   └── options/main.tsx                 # Extension options page
│
├── lib/                       # Core business logic
│   ├── api/                             # API layer
│   │   ├── client.ts                    # Authenticated fetch with retry + prepareBody
│   │   ├── fetch-utils.ts               # Auth header utilities
│   │   ├── query-client.ts              # TanStack Query configuration
│   │   ├── session-core.ts              # Session lifecycle management
│   │   ├── services/                    # Service modules
│   │   │   ├── auth-service.ts          # Authentication endpoints
│   │   │   ├── case-service.ts          # Case CRUD & conversations
│   │   │   ├── session-service.ts       # Session lifecycle
│   │   │   ├── report-service.ts        # Report generation
│   │   │   └── knowledge-service.ts     # Knowledge base queries
│   │   └── types/                       # API type definitions
│   │
│   ├── auth/                            # Authentication
│   │   ├── auth-manager.ts              # Centralized auth state
│   │   ├── auth-config.ts               # Auth mode detection (local/oauth)
│   │   ├── dashboard-oauth.ts           # OAuth flow (PKCE)
│   │   ├── local-auth-client.ts         # Local username/password auth
│   │   ├── trusted-origin.ts            # Dashboard-origin validation for the auth bridge
│   │   └── token-manager.ts             # Token storage & mode-aware refresh
│   │
│   ├── errors/                          # Error handling
│   │   ├── types.ts                     # UserFacingError class hierarchy
│   │   ├── classifier.ts                # Error classification
│   │   ├── recovery-strategies.ts       # Recovery implementations
│   │   ├── index.ts                     # Exports
│   │   └── useErrorHandler.tsx          # React error hook
│   │
│   ├── optimistic/                      # Optimistic update system
│   │   ├── OptimisticIdGenerator.ts     # Generate optimistic IDs (opt_*)
│   │   ├── IdMappingManager.ts          # Map optimistic → real IDs
│   │   ├── PendingOperationsManager.ts  # Track pending operations
│   │   ├── IdUtils.ts                   # ID utilities
│   │   └── types.ts                     # Optimistic type definitions
│   │
│   ├── session/                         # Session management
│   │   └── client-session-manager.ts    # Client-side session handling
│   │
│   └── utils/                           # Utilities
│       ├── logger.ts                    # Centralized logging (createLogger)
│       ├── messaging.ts                 # EventBus for cross-context
│       ├── resilient-operation.ts       # Retry wrapper
│       ├── persistence-manager.ts       # Data persistence
│       ├── data-integrity.ts            # Strict data separation utilities
│       ├── network-status.ts            # Network connectivity detection
│       ├── memory-manager.ts            # Memory management
│       └── api-error-handler.ts         # API error handling utilities
│
├── shared/ui/                 # React UI layer
│   ├── SidePanelApp.tsx                 # Main app component
│   ├── components/                      # React components
│   │   ├── ChatWindow.tsx               # Conversation display
│   │   ├── ResolutionActionsCard.tsx    # Post-terminal actions (report gen + knowledge nudge)
│   │   ├── ConversationsList.tsx        # Case list sidebar
│   │   ├── AuthScreen.tsx               # Login screen
│   │   ├── LocalLoginForm.tsx           # Local auth form
│   │   ├── case-header/                 # Case header components (incl. hypothesis rows in CaseDetails.tsx)
│   │   │   ├── shared.tsx               # SVG icons, DetailRow, SeverityChip, helpers
│   │   │   ├── EnhancedCaseHeader.tsx   # Wrapper: HeaderSummary + CaseDetails + modal
│   │   │   ├── HeaderSummary.tsx        # Collapsed 2-line status bar
│   │   │   ├── CaseDetails.tsx          # Unified expandable rows (all phases)
│   │   │   ├── EvidenceDetailsModal.tsx # Evidence detail modal
│   │   │   └── StatusChangeRequestModal.tsx # Status change confirmation
│   │   └── ...                          # Many more components
│   ├── hooks/                           # Custom hooks
│   │   ├── useAuth.ts                   # Authentication hook
│   │   ├── useSessionManagement.ts      # Session hook
│   │   ├── useCaseManagement.ts         # Case management hook
│   │   ├── useMessageSubmission.ts      # Message submission hook
│   │   └── usePendingOperations.ts      # Pending operations hook
│   └── layouts/                         # Layout components
│       ├── CollapsibleNavigation.tsx    # Navigation layout
│       └── ContentArea.tsx              # Content area layout
│
├── types/                     # Shared TypeScript types
│   ├── api.generated.ts                 # Auto-generated API types
│   └── case.ts                          # Case type definitions
│
└── test/                      # Test files (mirror src structure)
    ├── setup.ts                         # Test environment setup
    ├── api/                             # API tests
    ├── components/                      # Component tests
    ├── hooks/                           # Hook tests
    ├── integration/                     # Integration tests
    ├── lib/auth/                        # Auth tests
    ├── session/                         # Session tests
    └── utils/                           # Utility tests
```

### Path Aliases
Configured in `tsconfig.json` and `wxt.config.ts`:
- `~` → `src/`
- `~lib` → `src/lib/`

Example: `import { createLogger } from '~/lib/utils/logger'`

### Key Patterns

1. **State Management**: Global state lives in a **Zustand** store (`lib/state/store.ts`, slices: `app`/`auth`/`session`/`cases`/`pending-ops`); `SidePanelApp.tsx` reads it via `useAppStore` selectors (no local `useState`). The `shared/ui/hooks/*` family (`useCaseManagement`, `useSessionManagement`, `useMessageSubmission`, `useDataUpload`, `usePendingOperations`) wraps the store + lifecycle. Server state via TanStack Query
2. **Optimistic UI**: Immediate feedback with background reconciliation and rollback
3. **Data Integrity**: Strict separation between optimistic (`opt_*`) and real IDs
4. **Event Bus**: Typed `EventBus` for Background ↔ Sidepanel ↔ Content script communication
5. **Resilience**: `resilientOperation` pattern for retries and offline handling
6. **Logging**: Centralized `createLogger` utility (replaces console.log)
7. **Error Handling**: `UserFacingError` hierarchy with recovery strategies

### Authentication Modes

The extension supports two authentication modes, determined by backend configuration:

**1. Local Auth (`AUTH_MODE=local`)**
- Direct username/password authentication
- Used for self-hosted deployments
- Implemented in `src/lib/auth/local-auth-client.ts`
- Endpoints: `POST /api/v1/auth/login`, `POST /api/v1/auth/register`

**2. OAuth (`AUTH_MODE=oauth`)**
- PKCE-based OAuth flow via Dashboard
- Used for cloud deployments
- Implemented in `src/lib/auth/dashboard-oauth.ts`
- Endpoints: `POST /api/v1/auth/login/initiate`, `GET /api/v1/auth/callback`

Auth mode is auto-detected via `GET /api/v1/auth/config`.

**Token refresh is mode-aware.** `TokenManager.performRefreshOnce` picks the refresh endpoint by auth mode (from the cached `getAuthConfig()`):

- **Local mode** (standalone / dashboard-bridge sessions): `POST /api/v1/auth/refresh` with `{ refresh_token }` → `{ access_token, token_type, expires_in, refresh_token }` (rotated; **no** `refresh_expires_in`). The OAuth `/oauth/token` endpoint is **not mounted** in local mode, so refreshing there 404s and forces a re-login — don't hardcode it.
- **OAuth/cloud mode**: `POST /api/v1/auth/oauth/token` (RFC 6749 refresh grant) → includes `refresh_expires_in`.

`refresh_expires_in` is OAuth-only, so it is **not** part of the well-formed-payload check; when absent, `refresh_expires_at` is cleared (an undefined refresh window means "refresh until the backend definitively rejects").

**Dashboard-bridge sessions** (`handleStoreAuth`) persist the TokenManager keys — including `refresh_token` — from the dashboard's `fm_auth_state` payload, not just the composite `authState`; otherwise a bridge session has no refresh material and silently logs out at access-token expiry.

**Auth teardown — two variants (do not confuse):**

- `authManager.clearAuthState()` — **token-preserving**. Clears only the composite `authState` key (+ case cache). Used inside the normal access-token-expiry path (`getAuthState()`), where the `refresh_token` managed by `TokenManager` must survive so the session can be silently refreshed.
- `authManager.clearAllAuthData()` — **full teardown**. Clears `authState` **and** every `TokenManager` key (`access_token`, `refresh_token`, `refresh_expires_at`, …). Use for logout and hard (401) auth failures. `clearAuthState()` alone is NOT a valid logout: it leaves the token keys, so `getAuthHeaders` keeps attaching a live Bearer and `TokenManager` silently re-mints a session from the surviving `refresh_token`. Real logout sites — `logoutAuth()`, `client.ts handleAuthError()` (hard 401), options `handleSignOut()` — all route through `clearAllAuthData()`.

> Note: `logoutAuth()` POSTs `/api/v1/auth/logout`, which revokes the **access** token server-side. In OAuth (cloud) mode it *also* best-effort POSTs `/api/v1/auth/oauth/revoke` (`token_type_hint: refresh_token`, RFC 7009) to revoke the **refresh** token server-side before local teardown — wrapped so any failure never blocks logout, and skipped in local mode (where `/oauth/revoke` isn't mounted). The in-browser copy is destroyed by `clearAllAuthData()` regardless.

### Deployment Modes

**Cloud Deployment** (default):
- Dashboard: `https://app.faultmaven.ai`
- API: `https://api.faultmaven.ai` (derived from dashboard URL)
- OAuth authentication

**Self-Hosted Deployment**:
- Dashboard: `http://localhost:3333` (or configured URL)
- API: Derived by replacing port 3333 → 8090
- Local authentication support

URL configuration is done via the Settings page and stored in `browser.storage.local`.

### Testing Infrastructure

- **Vitest**: Fast testing with jsdom environment
- **React Testing Library**: Component testing
- **Coverage**: 20 test files covering API, hooks, components, and integration
- **Mocks**: Browser API and Fetch mocked in `src/test/setup.ts`

## Development Guidelines

### Code Patterns

**Logging** - ALWAYS use the logger instead of console.log:
```typescript
import { createLogger } from '~/lib/utils/logger';
const log = createLogger('ComponentName');

log.debug('Debug message', data);   // Dev only
log.info('Info message', data);     // Dev only
log.warn('Warning', data);          // Always logged
log.error('Error', error);          // Always logged
```

**Structured Logging Best Practices** (gold standard from ConversationsList):
```typescript
// ✅ GOOD: Use structured data objects
log.debug('Fetched cases', { count: list.length, hasOptimistic: pending.length > 0 });

// ❌ BAD: JSON.stringify (computationally expensive)
log.debug('Fetched cases', JSON.stringify(list));

// ✅ GOOD: Single consolidated log
log.info('Case renamed', { caseId, newTitle });

// ❌ BAD: Multiple logs for same operation
log.info('Renaming case...');
log.info(`Case ID: ${caseId}`);
log.info(`New title: ${newTitle}`);
```

**State Access** - Use the custom hooks for state and lifecycle:
```typescript
const { isAuthenticated, user, login, logout } = useAuth();
const { sessionId, refreshSession } = useSessionManagement(shouldInit);
const { currentCaseId, setActiveCase } = useCaseManagement(sessionId);
```

**Async** - Prefer `async/await` over `.then()`.

**Pre-commit Hooks** - Husky enforces `npm run compile` and `npm run test` before commits.

### API Integration

**Authenticated Fetch:**
```typescript
import { authenticatedFetch, authenticatedFetchWithRetry } from '~/lib/api/client';

// Basic authenticated request
const response = await authenticatedFetch('/api/endpoint');

// With automatic session refresh on 401
const response = await authenticatedFetchWithRetry('/api/endpoint');
```

On a `401 SESSION_EXPIRED`, `authenticatedFetchWithRetry` calls `refreshSession()` (in `session-core.ts`). That refresh is **single-flighted** — N parallel failing requests trigger **one** `/sessions` POST, not a herd — via the Web Locks API (cross-context, matching `TokenManager`) with an in-context promise fallback, and it **persists the new `session_id`** to `browser.storage.local` so the retried request (and everything after) attaches `X-Session-Id`. Do not go back to calling `createSession()` directly on this path: it returns a session but does not persist it, so the retry would go out session-less.

**Services** - Define API services in `src/lib/api/services/`.

### Error Handling

Use the `UserFacingError` class hierarchy for consistent error handling:

| Error Class | Category | Recovery Strategy |
|-------------|----------|-------------------|
| `SessionExpiredError` | authentication | auto_retry_with_delay |
| `AuthenticationError` | authentication | show_modal |
| `PermissionError` | authorization | graceful_degradation |
| `NetworkError` | network | retry_with_backoff |
| `TimeoutError` | timeout | manual_retry |
| `ServerError` | server | manual_retry |
| `ValidationError` | validation | user_fix_required |
| `RateLimitError` | rate_limit | auto_retry_with_delay |
| `QuotaExhaustedError` | billing | graceful_degradation |
| `OptimisticUpdateError` | optimistic_rollback | rollback_and_retry |
| `UnknownError` | unknown | manual_retry |

`QuotaExhaustedError` is raised for **HTTP 402 / `x-error-code: QUOTA_EXHAUSTED`** — the AI provider is out of quota/credits. Recovery is `graceful_degradation` (no auto-retry, no retry button); the chat surfaces an operator-actionable "add credits / update billing" message and preserves the user's input so they can resend once billing is fixed.

Each error provides:
- `userTitle`, `userMessage`, `userAction` - User-facing strings
- `category` - For classification
- `recovery` - Strategy for handling
- `getDisplayOptions()` - Toast/modal/inline configuration

### Data Integrity for Optimistic Updates

The `src/lib/utils/data-integrity.ts` module enforces strict separation between optimistic and real data:

**ID Format Rules:**
- Optimistic IDs: Always start with `opt_` (e.g., `opt_case_abc123`)
- Real IDs: Never start with `opt_` (UUIDs from backend)

**Key Functions:**
```typescript
import {
  isOptimisticId,        // Check if ID is optimistic
  isRealId,              // Check if ID is real
  sanitizeBackendCases,  // Extract only real cases from mixed backend data
  validateStateIntegrity // Validate conversations/titles have no opt_ leakage
} from '~/lib/utils/data-integrity';

// Backend case lists carry only real ids; sanitize defensively.
const realCases = sanitizeBackendCases(backendCases, 'ComponentName');
```

> The case list is real-only: a transient `opt_case_*` exists solely while a
> lazy case-create is in flight (`handleQuerySubmit`), where it is set as the
> active-case id and reconciled to the real id via `idMappingManager`. It is
> never surfaced as a separate "pending case" in the sidebar. If a create fails,
> the optimistic active-case id is rolled back; both submit paths also guard
> against a stale `opt_case_*` before POSTing a turn (resolve via the mapping, or
> create a fresh real case) so a turn never targets an unreconciled id.

### Optimistic Updates Pattern

Three-step process for immediate UI feedback:

1. **Immediate UI update** - Show optimistic data instantly
2. **Track pending operation** - Store retry/rollback functions
3. **Background sync** - Send to backend, reconcile on response

```typescript
// 1. Generate optimistic ID and update UI
const optimisticId = OptimisticIdGenerator.generateCaseId();
set(state => ({
  conversations: {
    ...state.conversations,
    [caseId]: [...existing, { id: optimisticId, optimistic: true, ... }]
  }
}));

// 2. Create pending operation with retry/rollback
const operation: PendingOperation = {
  id: operationId,
  type: 'submit_query',
  status: 'pending',
  retryFn: async () => { /* retry logic */ },
  rollbackFn: () => { /* undo optimistic update */ }
};

// 3. Send to backend and reconcile
try {
  const realId = await submitToBackend();
  IdMappingManager.set(optimisticId, realId);
} catch (error) {
  operation.rollbackFn();
}
```

### Persistence Contract (what reaches `browser.storage.local`)

The Zustand store persists via a debounced subscribe in `lib/state/store.ts`. Two rules keep a reload from corrupting state:

1. **Committed conversation data only.** Conversations are run through `memoryManager.sanitizeAndCapForPersistence()` before writing: transient items (`optimistic` / `loading` / `failed` / `error` — see `isCommittedMessage`) are dropped, and empty conversations are removed. A reload therefore never rehydrates a stuck "thinking" spinner or an optimistic turn that would duplicate once the real turn is delta-fetched. In-flight/failed turns are reconciled from the backend on case open, not from storage.
2. **`pendingOperations` is never persisted.** Its `retryFn`/`rollbackFn` are closures that can't survive JSON serialization, so a restored pending op could never function. `pendingOpsManager` is the single in-session source of truth.

Growth is bounded by dropping transient items and capping the **number** of conversations. The message count *within* a conversation is deliberately **not** capped: `cases-slice.handleCaseSelect` delta-fetches using the local committed-message count as a head offset and assumes the local copy is the backend **prefix** — trimming to a most-recent suffix would make the offset skip real messages and re-append overlapping ones as duplicates. Bounding a single very long conversation requires an id/turn-based delta fetch (tracked separately).

### API Request Serialization (prepareBody)

All API service functions use `prepareBody()` for JSON serialization. This utility converts `undefined` → `null` to ensure consistent backend behavior:

```typescript
import { prepareBody } from '~/lib/api/client';

// prepareBody converts undefined values to null
prepareBody({ title: undefined, priority: 'medium' });
// Returns: '{"title":null,"priority":"medium"}'

// This addresses the TypeScript-to-REST semantic mismatch where
// JSON.stringify silently strips undefined values
```

**Design rationale:**
- `undefined` → `null`: Explicitly tells backend "this field is empty"
- Field not in object: Truly missing (use for partial updates)
- Use explicit types (`field: string | null`) to force conscious decisions

### Case Title Generation

Backend auto-generates case titles in `Case-MMDD-N` format (e.g., `Case-0127-1`). The `CreateCaseRequest` type enforces explicit intent:

```typescript
interface CreateCaseRequest {
  title: string | null;  // Required - must explicitly choose
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

// ✅ CORRECT: Explicit null triggers auto-generation
createCase({ title: null, priority: 'medium' });
// Sends: {"title":null,"priority":"medium"}

// ✅ CORRECT: Provide explicit title
createCase({ title: 'My Case', priority: 'medium' });
// Sends: {"title":"My Case","priority":"medium"}
```

**Three title scenarios:**
1. **New case creation**: `title: null` → Backend generates `Case-MMDD-N`
2. **Manual rename**: `PUT /api/v1/cases/{id}` with explicit title string
3. **LLM auto-generate**: `POST /api/v1/cases/{id}/title` triggers AI summarization

### Case Status Lifecycle

Cases follow a defined status lifecycle with specific transitions:

| Status | Description | Valid Transitions |
|--------|-------------|-------------------|
| `inquiry` | Q&A mode - exploring the issue | `investigating`, `closed` |
| `investigating` | Active troubleshooting | `resolved`, `closed` |
| `resolved` | Issue resolved (terminal) | - |
| `closed` | Closed without resolution (terminal) | - |

```typescript
import {
  normalizeStatus,
  getValidTransitions,
  isTerminalStatus,
  getStatusChangeMessage
} from '~/lib/api/services/case-service';

// Get valid transitions for current status
const transitions = getValidTransitions('inquiry'); // ['investigating', 'closed']

// Get predefined message for status change
const msg = getStatusChangeMessage('inquiry', 'investigating');
// "I want to start a formal investigation to find the root cause."
```

### Post-Terminal Actions (ResolutionActionsCard)

When a case reaches terminal state (resolved/closed), `ResolutionActionsCard` is rendered above the chat history. It's a small status banner — not a navigation surface. It shows:

**Resolved cases:**

- "Case Resolved" label, root cause summary (if available), duration / turn stats
- One-line affordance hint: *"Ask questions or request a runbook from this case."*

**Closed cases:**

- "Case Closed" + closure reason label (Abandoned, Escalated, Mitigated, Inquiry Only)
- `mitigation_sufficient` uses distinct warm styling (warning-tinted background) and the affordance line mentions runbook generation; other closure reasons use neutral styling and a simpler "Ask questions about this case." line
- Duration / turn stats on their own line

**No Dashboard link.** The card deliberately does not link to the Dashboard's Report tab. Closure summaries are rendered inline in the chat reply at the moment of generation (a backend-side design decision: the chat is now the primary surface for the summary; the Dashboard is the persistent view). A chat-side card linking to the Dashboard for a summary the user can already see in chat above would be redundant noise.

**Auto-generated summaries vs runbooks:**

- **Summaries** (Resolution Summary, Closure Summary) are auto-generated synchronously at terminal transition and embedded directly into the closure-turn chat reply.
- **Runbooks** are user-requested knowledge artifacts generated from RESOLVED cases or CLOSED(mitigation_sufficient) cases. The agent offers them as DECIDE suggestions in chat on terminal Q&A turns; the user accepts or ignores. The backend uses different readiness criteria and templates based on case type, but to the user it's always a "runbook."

**Key files:**

- `src/shared/ui/components/ResolutionActionsCard.tsx` — Post-terminal card component
- `src/lib/api/services/report-service.ts` — Report generation API (`generateReports`, `getCaseReports`, `getReportRecommendations`)

### API Response Polling

For async operations returning 202 Accepted:
```typescript
const POLL_INITIAL_MS = 1500;    // Initial delay
const POLL_BACKOFF = 1.5;        // Exponential multiplier
const POLL_MAX_MS = 10000;       // Max interval cap
const POLL_MAX_TOTAL_MS = 600000; // 10 min timeout
```

`POLL_MAX_TOTAL_MS` is a **wall-clock** budget measured with `Date.now()` from the
first poll — it counts both the time spent inside each poll request and the
backoff sleeps. (Do not re-introduce the old `elapsed += delay` accounting: it
counted only sleeps, so a poll stalled up to the client timeout contributed
nothing and the real ceiling became effectively unbounded.)

`submitTurn(caseId, request, { signal })` accepts an optional `AbortSignal`.
Passing it lets a caller cancel an in-flight turn — including its async polling —
so a detached poll loop stops instead of hammering the job endpoint. The
side-panel hooks (`useMessageSubmission`, `useDataUpload`) abort their in-flight
turns on unmount; abort surfaces as an `AbortError` (non-retryable) and is
treated as a **silent cancellation**, not a failed turn.

### Cross-Context Communication

Use EventBus for Background ↔ Sidepanel communication:
```typescript
// Emit event
EventBus.emit({ type: 'auth_state_changed', authState });

// Listen for events
EventBus.on('auth_state_changed', (event) => {
  // Handle auth state change
});
```

## Extension Manifest

Key permissions (Manifest v3):
- `storage` - Local data persistence
- `sidePanel` - Side panel UI
- `activeTab`, `tabs` - Tab access for content capture
- `scripting` - Content script injection

Host permissions (see `wxt.config.ts` for the authoritative list):
- Static `host_permissions`: `https://app.faultmaven.ai/*`, `https://api.faultmaven.ai/*`
- `optional_host_permissions`: `http://localhost/*`, `http://127.0.0.1/*`, **and `http://*/*`, `https://*/*`** (user-granted at runtime — needed for page capture on arbitrary sites and self-hosted backends on any origin; justification in `docs/cws/PERMISSION_JUSTIFICATION.md`)
- CSP `connect-src 'self' http: https:` — the side panel can connect to any origin (self-hosted backend URLs)
