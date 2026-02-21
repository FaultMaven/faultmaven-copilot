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

The tests rely on a Mock API server that intercepts `http://localhost:8091`. This server serves responses directly from `e2e/fixtures/mock-api/responses/*.json`.

1. To regenerate the baseline JSON fixtures:
   ```bash
   npx tsx e2e/fixtures/mock-api/generate-fixtures.ts
   ```

2. To handle unique status codes or simulated outages, use the `/__admin/state` endpoint within your tests:
   ```typescript
   await page.request.post('http://localhost:8091/__admin/state', {
     data: { shouldFail: true }
   });
   ```

## Handling Port Conflicts

If you encounter `ERR_CONNECTION_REFUSED` or port `8091` is already in use, you can force a fresh server start by setting the `CI=1` environment variable. This prevents Playwright from attempting to reuse an existing detached mock server:
```bash
CI=1 xvfb-run pnpm test:e2e
```

## CI/CD Pipeline

The tests run automatically via GitHub actions on push to `main` modifying extension code, and weekly. The CI environment uses `xvfb-run` to simulate a display so Chrome runs in headed mode.
