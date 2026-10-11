# FaultMaven Copilot E2E Tests

This directoy contains the self-contained End-to-End (E2E) test suite for the browser extension.

These tests use **Playwright** running in **headed Chromium** (`headless: false`) because the Chrome Extension API (Service Workers, side panels) cannot currently be fully tested in a pure headless mode. We mock all API calls via a local Express server to ensure stability and isolation from backend deployments.

## How to Run Locally

1. Build the extension first:
   ```bash
   pnpm build
   ```

2. Run the tests:
   ```bash
   pnpm test:e2e
   ```
   *Note: If you are running on a headless Linux environment, you must use Xvfb.*
   ```bash
   xvfb-run pnpm test:e2e
   ```

3. Debug mode (opens a browser window and pauses on failure):
   ```bash
   pnpm test:e2e:debug
   ```

## How to Add Tests

Add tests directly to the `e2e/tests/` folder. Be sure to import from the `extension-context` fixture, which automatically boots a persistent Chromium profile and installs the built extension.

```typescript
import { test, expect } from '../setup/extension-context';

test('My new test', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);
  // Assertions here
});
```

## How to Update Fixtures

The tests run against a mock API server (`e2e/fixtures/mock-api/server.ts`),
started by Playwright for the run. Its bodies live in
`e2e/fixtures/mock-api/fixtures.ts`, typed by the generated contract
(`packages/copilot-ui/types/api.generated.ts`), and each route is registered
under the path the contract spells. `pnpm compile` typechecks the e2e tree
(`e2e/tsconfig.json`), so adopting a contract that moves a schema the mock
serves fails to compile until the fixture is updated.

1. **A route the client calls must be served.** The server records every request
   no route answered, and the shared fixture fails the test that made it,
   naming `METHOD /path`. Add the route with `serve(...)` in `server.ts` and its
   body in `fixtures.ts`. A 404 the test meant to see belongs in the test (for
   example `page.route(...)`), not in a missing route.

2. To handle unique status codes or simulated outages, use the `/__admin/state` endpoint within your tests:
   ```typescript
   await page.request.post(`${MOCK_API}/__admin/state`, {
     data: { shouldFail: true }
   });
   ```
   You do not need to clean up afterwards: the shared fixture (`mockApiState` in
   `e2e/setup/extension-context.ts`) resets the server before **every** test and
   asserts the result via `GET /__admin/state`. The server is the only state that
   outlives a test, so the reset lives where a failing test cannot skip it.

3. To start a test signed in, seed storage from the background worker with
   `seedExtensionStorage(context, signedInStorage())` **before** opening any panel
   page. Writing it from a panel page that has just loaded races the panel's
   startup session repair, which can sweep the credential you just wrote.

## The mock server's port

Always address the mock as `MOCK_API` (from `e2e/setup/extension-context.ts`),
never a literal port. `playwright.config.ts` picks the port once per run:

- **Locally**, a free port, and a fresh server every run. Parallel runs in
  separate worktrees each get their own server, so none can see another's
  `/__admin/state`.
- **In CI** (`CI` set), 8091, never reused.
- **`E2E_MOCK_PORT=<port>`** pins it. Outside CI, a server already listening there
  is reused, which is useful when you start one by hand to debug:
  ```bash
  PORT=8091 npx tsx e2e/fixtures/mock-api/server.ts &
  E2E_MOCK_PORT=8091 xvfb-run pnpm test:e2e
  ```

## When a test fails

Actions are bounded (`actionTimeout`, 10 s), so an element that never appears
fails as that action or assertion, naming its locator, not as a bare 30 s test
timeout. The `context` fixture bounds Chromium's launch (15 s) and the extension
service worker's registration (10 s), and names the step that stuck.

## CI/CD Pipeline

The tests run automatically via GitHub actions on push to `main` modifying extension code, and weekly. The CI environment uses `xvfb-run` to simulate a display so Chrome runs in headed mode.
