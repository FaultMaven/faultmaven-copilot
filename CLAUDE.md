# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **FaultMaven Copilot** browser extension - an AI-powered troubleshooting assistant built with WXT framework. The extension provides engineers (especially in SRE and DevOps roles) with in-context help, analyzes web content, and enables interaction with the FaultMaven AI to diagnose and resolve issues efficiently.

**Key Technologies**: WXT v0.20.6, React 19+, TypeScript, Tailwind CSS, Vitest, Zustand, TanStack Query.

## Common Commands

### Development
```bash
pnpm install                    # Install dependencies
pnpm dev                        # Chrome development with HMR
pnpm dev:firefox                # Firefox development
npm run compile                 # TypeScript compilation check (configured in package.json)
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
All configuration is done via environment variables (set before build). Copy `.env.example` to `.env`.

**Available Variables:**
- `VITE_DASHBOARD_URL` - URL for the main dashboard (default: `http://localhost:5173`)
- `VITE_API_URL` - Backend API endpoint
- `VITE_DEBUG` - Enable debug logging (`true`/`false`)
- `VITE_POLL_INITIAL_MS` - Initial polling interval
- `VITE_POLL_MAX_TOTAL_MS` - Max polling duration

**Configuration Files:**
- **`src/config.ts`** - Central configuration
- **`.env.example`** - Documentation of available variables

## High-Level Architecture

### Directory Structure
```
src/
├── entrypoints/              # WXT entry points (background, sidepanel, content scripts)
├── lib/                      # Core logic
│   ├── api/                  # API Services & Client
│   ├── auth/                 # Auth logic
│   ├── state/                # Zustand Stores (Auth, Session, Cases)
│   ├── utils/                # Utilities (Logger, EventBus)
│   └── errors/               # Error handling
├── shared/ui/                # React components & Hooks
└── config.ts                 # Environment configuration
```

### Key Patterns

1.  **State Management**: **Zustand** stores for global state (`AuthSlice`, `SessionSlice`, `CasesSlice`).
2.  **Optimistic UI**: Immediate feedback for user actions with background reconciliation.
3.  **Event Bus**: Typed `EventBus` for communication between Background, Sidepanel, and Content scripts.
4.  **Resilience**: `resilientOperation` pattern for retries and offline handling.
5.  **Logging**: Centralized `logger` utility (replaces console.log).

### Testing Infrastructure

- **Vitest**: Fast testing with jsdom environment.
- **React Testing Library**: Component testing.
- **Coverage**: ~100% pass rate (133+ tests).
- **Mocks**: Extensive mocking of Browser API and Fetch in `src/test/setup.ts`.

## Development Guidelines

### Code Patterns
- **Logging**: ALWAYS use `import { createLogger } from '~/lib/utils/logger'` instead of `console.log`.
- **State**: Use custom hooks (`useAuth`, `useCaseManagement`) to access Zustand stores.
- **Async**: Prefer `async/await` over `.then()`.
- **Commits**: Pre-commit hooks enforce `npm run compile` and `npm run test`.

### API Integration
- Use `authenticatedFetch` or `authenticatedFetchWithRetry` from `src/lib/api/client.ts`.
- Define services in `src/lib/api/services/`.
- Handle errors using the `UserFacingError` hierarchy.
