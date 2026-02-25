# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **FaultMaven Copilot** browser extension - an AI-powered troubleshooting assistant built with WXT framework. The extension provides engineers (especially in SRE and DevOps roles) with in-context help, analyzes web content, and enables interaction with the FaultMaven AI to diagnose and resolve issues efficiently.

**Key Technologies**: WXT v0.20.6, React 19.x, TypeScript 5.x, Tailwind CSS, Vitest, Zustand 5.x, TanStack Query 5.x.

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
| `VITE_POLL_MAX_TOTAL_MS` | Maximum total polling time | `300000` (5 min) |

**Input Limits:**
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_DATA_MODE_LINES` | Lines threshold for data upload mode | `100` |
| `VITE_MAX_QUERY_LENGTH` | Maximum query length (chars) | `200000` |
| `VITE_MAX_FILE_SIZE_MB` | Maximum file upload size | `10` |

**Feature Flags:**
| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_USE_NEW_HEADER` | Enable enhanced case header UI | `false` |

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
│   ├── page-content.content.ts          # Page content capture
│   ├── sidepanel_manual/main.tsx        # React side panel entry
│   ├── options/main.tsx                 # Extension options page
│   └── oidc-callback.html               # OIDC callback handler
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
│   │   ├── auth-config.ts               # Auth mode detection (local/OIDC)
│   │   ├── auth-client.ts               # Auth client interface
│   │   ├── dashboard-oauth.ts           # OAuth flow (PKCE)
│   │   ├── local-auth-client.ts         # Local username/password auth
│   │   ├── oauth-client.ts              # OAuth client implementation
│   │   ├── oidc-callback.ts             # OIDC callback handler
│   │   └── token-manager.ts             # Token storage & refresh
│   │
│   ├── state/                           # Zustand stores
│   │   ├── store.ts                     # Main store composition
│   │   └── slices/
│   │       ├── auth-slice.ts            # Auth state
│   │       ├── session-slice.ts         # Session state
│   │       ├── cases-slice.ts           # Cases & conversations
│   │       └── ui-slice.ts              # UI state (modals, sidebar)
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
│   │   ├── ConflictResolver.ts          # Conflict detection/resolution
│   │   ├── MergeStrategies.ts           # Data merge strategies
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
│   │   ├── ConversationsList.tsx        # Case list sidebar
│   │   ├── AuthScreen.tsx               # Login screen
│   │   ├── LocalLoginForm.tsx           # Local auth form
│   │   ├── HypothesisTracker.tsx        # Hypothesis tracking display
│   │   ├── case-header/                 # Case header components
│   │   │   ├── EnhancedCaseHeader.tsx   # Phase-adaptive header
│   │   │   ├── HeaderSummary.tsx        # Header summary
│   │   │   ├── ConsultingDetails.tsx    # Consulting phase details
│   │   │   ├── InvestigatingDetails.tsx # Investigation details
│   │   │   └── ResolvedDetails.tsx      # Resolved case details
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

1. **State Management**: Zustand stores with 4 slices (`AuthSlice`, `SessionSlice`, `CasesSlice`, `UISlice`)
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

**State Access** - Use custom hooks to access Zustand stores:
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

**Services** - Define API services in `src/lib/api/services/`.

### Error Handling

Use the `UserFacingError` class hierarchy for consistent error handling:

| Error Class | Category | Recovery Strategy |
|-------------|----------|-------------------|
| `SessionExpiredError` | authentication | auto_retry_with_delay |
| `AuthenticationError` | authentication | show_modal |
| `NetworkError` | network | retry_with_backoff |
| `TimeoutError` | timeout | manual_retry |
| `ServerError` | server | manual_retry |
| `ValidationError` | validation | user_fix_required |
| `RateLimitError` | rate_limit | auto_retry_with_delay |
| `OptimisticUpdateError` | optimistic_rollback | rollback_and_retry |
| `UnknownError` | unknown | manual_retry |

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
  isOptimisticId,          // Check if ID is optimistic
  isRealId,                // Check if ID is real
  sanitizeBackendCases,    // Extract only real cases from mixed data
  sanitizeOptimisticCases, // Extract only optimistic cases
  mergeOptimisticAndReal,  // Safely merge with conflict detection
  validateStateIntegrity   // Validate state has no mixed IDs
} from '~/lib/utils/data-integrity';

// Safe merging with violation tracking
const { cases, violations } = mergeOptimisticAndReal(
  backendCases,
  pendingCases,
  'ComponentName'
);

if (violations.length > 0) {
  log.error('Data integrity violations', { violations });
}
```

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
| `consulting` | Q&A mode - exploring the issue | `investigating`, `closed` |
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
const transitions = getValidTransitions('consulting'); // ['investigating', 'closed']

// Get predefined message for status change
const msg = getStatusChangeMessage('consulting', 'investigating');
// "I want to start a formal investigation to find the root cause."
```

### API Response Polling

For async operations returning 202 Accepted:
```typescript
const POLL_INITIAL_MS = 1500;    // Initial delay
const POLL_BACKOFF = 1.5;        // Exponential multiplier
const POLL_MAX_MS = 10000;       // Max interval cap
const POLL_MAX_TOTAL_MS = 300000; // 5 min timeout
```

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

Host permissions:
- Production: `https://app.faultmaven.ai/*`, `https://api.faultmaven.ai/*`
- Optional: `http://localhost/*` for local development
