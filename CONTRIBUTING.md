# Contributing to FaultMaven Copilot

Thank you for your interest in contributing to FaultMaven Copilot! This guide will help you set up your development environment and understand our contribution workflow.

## Development Setup

1.  **Prerequisites**:
    *   Node.js 18+
    *   pnpm (recommended) or npm

2.  **Clone the repository**:
    ```bash
    git clone https://github.com/FaultMaven/faultmaven-copilot.git
    cd faultmaven-copilot
    ```

3.  **Install dependencies**:
    ```bash
    pnpm install
    ```

4.  **Configuration**:
    Copy `.env.example` to `.env` and adjust the values:
    ```bash
    cp .env.example .env
    ```

5.  **Run in Development Mode**:
    ```bash
    pnpm dev
    # or for Firefox
    pnpm dev:firefox
    ```

## Project Structure

*   `src/entrypoints`: WXT entry points (background, content scripts, sidepanel, popup).
*   `src/lib`: Shared libraries (API, state, utils).
    *   `src/lib/api`: API client and services.
    *   `src/lib/state`: Zustand state slices.
    *   `src/lib/optimistic`: Optimistic UI updates logic.
*   `src/shared`: Shared UI components and hooks.
*   `src/test`: Tests (unit, integration, e2e).

## Testing

We use Vitest for testing. Please ensure all tests pass before submitting a PR.

```bash
# Run all tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests in watch mode
pnpm test --watch
```

## Code Style

*   We use TypeScript for all code.
*   Pre-commit hooks are configured to run `npm run compile` and `npm run test` before committing.
*   Please ensure your code has no linting or type errors.
*   Run `pnpm lint` to check for ESLint warnings (including console.log usage).

## Logging Best Practices

We use a structured logging system to maintain clean, production-ready code. **Never use `console.log` directly**.

### Quick Start

```typescript
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('MyComponent');

// Use appropriate log levels
log.debug('Detailed state', { count: items.length });  // DEV only
log.info('User action completed', { action: 'save' }); // DEV only
log.warn('Recoverable issue', { retryCount: 2 });      // Always logged
log.error('Operation failed', error);                  // Always logged
```

### Log Level Criteria

Choose the appropriate log level based on these criteria:

| Level | When to Use | Examples | Production |
|-------|-------------|----------|------------|
| `debug` | High-frequency data, verbose debugging | Raw API payloads, state dumps, loop iterations | Stripped |
| `info` | Key lifecycle events, normal operations | "Session Started", "Case Selected", "Auth Refreshed" | Stripped |
| `warn` | Recoverable issues needing attention | "API retry 2/3", "Falling back to cache", "Rate limit approaching" | Logged |
| `error` | Action-required failures | "OAuth Token Expired", "Network Unavailable", "Data Corruption" | Logged |

### Anti-Patterns to Avoid

**Don't log full objects in production:**
```typescript
// BAD - Exposes sensitive data, performance cost
log.info('API response', fullResponseObject);

// GOOD - Log summary only
log.debug('API response received', { status: res.status, itemCount: res.data.length });
```

**Don't use multiple logs for one action:**
```typescript
// BAD - Creates noise
log.info('Starting operation...');
log.info('Operation in progress', state);
log.info('Operation complete', result);

// GOOD - One meaningful log
log.info('Operation completed', { duration: endTime - startTime, itemsProcessed: result.length });
```

**Don't use emojis in logs:**
```typescript
// BAD - Harder to grep/search
log.info('Searching cases...');

// GOOD - Clear text
log.info('Searching cases', { query });
```

### Migration from console.log

Our ESLint configuration warns when `console.log` is used. To migrate:

1. **Add logger import:**
   ```typescript
   import { createLogger } from '~/lib/utils/logger';
   const log = createLogger('ComponentName');
   ```

2. **Replace console calls:**
   ```typescript
   // Before
   console.log('[MyComponent] User clicked', userId);

   // After
   log.info('User clicked', { userId });
   ```

3. **Classify correctly:**
   - Debug details → `log.debug()`
   - Normal operations → `log.info()`
   - Issues → `log.warn()`
   - Errors → `log.error()`

### Environment Variables

Control logging verbosity:

```bash
# Development (default)
VITE_DEBUG=false  # info/warn/error only

# Verbose debugging
VITE_DEBUG=true   # All levels including debug

# Production build
# Only warn/error logged (debug/info completely stripped)
```

## Pull Request Process

1.  Create a new branch for your feature or fix.
2.  Make your changes and add tests if applicable.
3.  Run `pnpm test` to ensure everything is working.
4.  Commit your changes using a descriptive commit message.
    *   We follow [Conventional Commits](https://www.conventionalcommits.org/).
5.  Push your branch and open a Pull Request against `main`.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
