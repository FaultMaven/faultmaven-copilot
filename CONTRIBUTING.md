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

## Pull Request Process

1.  Create a new branch for your feature or fix.
2.  Make your changes and add tests if applicable.
3.  Run `pnpm test` to ensure everything is working.
4.  Commit your changes using a descriptive commit message.
    *   We follow [Conventional Commits](https://www.conventionalcommits.org/).
5.  Push your branch and open a Pull Request against `main`.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
