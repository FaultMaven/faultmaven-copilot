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
│       └── html-to-structured-text.ts  # Semantic DOM → markdown extraction
├── shared/                   # UI Components & Hooks
│   ├── ui/
│   │   ├── components/       # Reusable UI atoms/molecules
│   │   ├── hooks/            # Custom React Hooks (useAuth, useMessageSubmission)
│   │   └── SidePanelApp.tsx  # Root Application Component
│   └── assets/               # Static assets
└── config.ts                 # Environment configuration
```

---

## Page Capture Pipeline

The copilot captures web page content (dashboards, alert pages, status pages) and converts it to structured markdown for the FaultMaven backend.

### Two Capture Paths

1. **Content script import** (primary): `page-content.content.ts` imports `htmlToStructuredText(document)` from `lib/utils/html-to-structured-text.ts`. Used when the content script is already injected on the page.
2. **Programmatic injection** (fallback): `usePageContent.ts` uses `browser.scripting.executeScript()` with a fully inlined version of the extraction logic. Used when the content script isn't responding (e.g., page loaded before extension install). The function must be self-contained — `scripting.executeScript` serializes it, so no imports are allowed.

### Extraction: `htmlToStructuredText`

Converts live DOM to structured markdown. Key features:

*   **Visibility-aware**: Uses `getComputedStyle()` on the live DOM to skip hidden elements (`display: none`, `visibility: hidden`, `opacity: 0`, `aria-hidden`)
*   **`tryKeyValue` heuristic**: Detects label + value patterns in child elements (e.g., `<div><span>CPU Usage</span><span>92%</span></div>` → `CPU Usage: 92%`)
*   **`tryStatValue` heuristic**: Detects large-font stat panels (fontSize >= 24px) with monitoring units (`%`, `ms`, `req/s`, `p99`, etc.) — catches Grafana stat panels, Datadog big number widgets
*   **ARIA alert promotion**: Elements with `role="alert"` or `aria-live="assertive"` get wrapped in a `## Alert` heading so they're promoted by the priority pass
*   **Error-first priority pass**: Splits output into sections on `##` headings, sorts sections containing error keywords (`firing`, `critical`, `error`, `down`, `failed`, `timeout`, etc.) to the top
*   **Form value extraction**: Reads `.value` property directly from inputs/selects/textareas (not lost like with `outerHTML` or `textContent`)
*   **Preamble**: `[captured_at: ISO timestamp]` and page title/meta description
*   **Cap**: MAX_CHARS = 12,000

### Permission Handling

`activeTab` permission only activates on toolbar icon clicks, NOT side-panel button clicks. When capture is initiated from the side panel, `usePageContent.ts` requests host permission via `browser.permissions.request()` for the tab's origin before injecting the script.

### Backend Integration

Content is submitted as `pasted_content` with `source_metadata.source_type = "page_capture"` and filename `page-capture-{ts}.txt`. The backend passes it through without re-processing (see [Data Preprocessing v5.1](../faultmaven/docs/architecture/data-processing/data-preprocessing-design-specification.md)).

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
