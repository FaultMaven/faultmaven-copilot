# FaultMaven Copilot Architecture

## Overview

FaultMaven Copilot is a browser extension providing AI-powered troubleshooting assistance embedded directly in the browser. Built with WXT framework, React 19+, and TypeScript, it delivers an optimistic, responsive user experience with instant feedback and robust error handling.

### Core Design Principles

1.  **Optimistic UI & Zero Latency**: Instant feedback for all user actions (0ms response time).
    *   Messages appear immediately via `OptimisticIdGenerator`.
    *   Background synchronization handles API calls.
    *   Automatic reconciliation of optimistic IDs with real backend UUIDs.
2.  **Robust State Management**: Centralized Zustand stores for predictable state.
    *   Separation of concerns: UI components only render data; logic resides in Stores and Hooks.
    *   `AuthSlice`, `SessionSlice`, `CasesSlice`, `UISlice`.
3.  **Resilience & Offline Handling**: "Resilient Operation" pattern.
    *   Queues actions if the network is flaky.
    *   Automatic retries with exponential backoff.
    *   Conflict resolution strategies for concurrent data updates.
4.  **Session Persistence**: Client-based session management (`ClientSessionManager`).
    *   Recovers sessions automatically after browser crashes or reloads.
    *   Preserves chat history and user context.
5.  **Developer Experience**: Typed `EventBus` for cross-component communication and automated quality checks (`husky`, `lint-staged`).

### Technology Stack

*   **Framework**: WXT v0.20.6 (modern WebExtension toolkit)
*   **UI**: React 19+, TypeScript, Tailwind CSS
*   **State Management**: Zustand
*   **Data Fetching**: TanStack Query (React Query) + Custom `authenticatedFetch`
*   **Build**: Vite-based with hot module reloading
*   **Testing**: Vitest, React Testing Library (100% pass rate)
*   **Storage**: `browser.storage.local` with `BatchedStorage` optimization

---

## Directory Structure

The codebase follows a modular, domain-driven structure:

```
src/
├── entrypoints/              # WXT entry points
│   ├── background.ts         # Service worker (session, auth events)
│   ├── page-content.content.ts # Content script (page analysis)
│   ├── sidepanel_manual/     # Main Side Panel UI entry
│   └── auth-bridge.content.ts # Bridge for Dashboard authentication
├── lib/                      # Core Logic & Infrastructure
│   ├── api/                  # API Layer
│   │   ├── services/         # Domain services (auth, case, session, knowledge)
│   │   ├── client.ts         # Base HTTP client with interceptors
│   │   └── types.ts          # API type definitions
│   ├── auth/                 # Auth logic (OIDC, tokens)
│   ├── errors/               # Error handling system (classifiers, types)
│   ├── optimistic/           # Optimistic UI logic (ID generation, conflict resolution)
│   ├── session/              # Session management (ClientSessionManager)
│   ├── state/                # Zustand Stores (slices)
│   │   ├── store.ts          # Main store configuration
│   │   └── slices/           # Individual state slices
│   └── utils/                # Shared utilities (logger, messaging, retry)
├── shared/                   # UI Components & Hooks
│   ├── ui/
│   │   ├── components/       # Reusable UI atoms/molecules
│   │   ├── hooks/            # Custom React Hooks (useAuth, useMessageSubmission)
│   │   └── SidePanelApp.tsx  # Root Application Component
│   └── assets/               # Static assets
└── config.ts                 # Environment configuration
```

---

## State Management Architecture

We use **Zustand** for global state management, replacing complex prop drilling.

### Store Slices

1.  **AuthSlice**: Manages user authentication, tokens, and roles.
2.  **SessionSlice**: Handles session lifecycle, capabilities, and recovery.
3.  **CasesSlice**: Manages case lists, active conversations, and optimistic updates.
4.  **UISlice**: Controls UI state (sidebar collapse, modals, active tabs).

### Data Flow

1.  **Action**: User clicks "Send".
2.  **Hook**: `useMessageSubmission` calls `CasesSlice.submitQuery`.
3.  **Optimistic Update**: Store updates `conversations` state immediately with a temporary ID.
4.  **Background Operation**: `resilientOperation` triggers API call via `case-service`.
5.  **Reconciliation**: On success, Store updates the message with real ID and data. On failure, Store marks it as failed (red state).

---

## API Architecture

API logic is decoupled from UI components.

### Services (`src/lib/api/services/`)

*   `auth-service.ts`: Login, logout, token management.
*   `case-service.ts`: CRUD for cases, query submission, history fetching.
*   `session-service.ts`: Session creation and heartbeats.
*   `knowledge-service.ts`: Knowledge base operations.

### Event Bus (`src/lib/utils/messaging.ts`)

A typed **Event Bus** handles asynchronous communication between the Extension Background Script, Content Scripts, and the React UI.

*   `EventBus.emit('auth_state_changed', { ... })`
*   `EventBus.on('session_expired', handler)`

---

## Error Handling System

A comprehensive system transforms technical errors into user-friendly guidance.

*   **ErrorClassifier**: Maps HTTP 401, 500, Network Errors to `UserFacingError`.
*   **Recovery Strategies**:
    *   **Auto-Retry**: For network blips (exponential backoff).
    *   **Manual Retry**: UI button for user intervention.
    *   **Re-Auth**: Modal prompting login for 401s.
*   **UI Feedback**: Toasts, Modals, or Inline Error states depending on severity.

---

## Optimistic Updates & Resilience

### The "Resilient Operation" Pattern

We wrap critical actions (like sending a message) in a `resilientOperation` wrapper:

```typescript
await resilientOperation({
  operation: async () => api.submitQuery(...),
  context: { operation: 'send_message' },
  onFailure: (error) => {
    // Mark message as failed in UI
    pendingOpsManager.fail(optimisticId, error);
  }
});
```

### ID Reconciliation

1.  **Generate**: `opt_123` (Client)
2.  **Submit**: API receives query.
3.  **Respond**: API returns real ID `uuid_456`.
4.  **Reconcile**: Store swaps `opt_123` -> `uuid_456` transparently.

---

## Testing Strategy

The project maintains a high standard of code quality with **100% test pass rate**.

*   **Framework**: Vitest + React Testing Library.
*   **Unit Tests**: Logic in `lib/`, Stores, and Hooks.
*   **Integration Tests**: `auth-flow.test.ts`, `ChatWindow.e2e.test.tsx`.
*   **Automation**: `husky` runs `npm run test` and `npm run compile` before every commit.

To run tests:
```bash
npm run test
```
