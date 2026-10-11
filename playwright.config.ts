import { execFileSync } from 'child_process';
import { defineConfig, devices } from '@playwright/test';

/**
 * The mock API port, one per run (#343).
 *
 * The mock server holds mutable state (`/__admin/state`), so two runs sharing
 * one server — parallel worktrees, each with `reuseExistingServer` on a fixed
 * :8091 — read and reset each other's flags mid-test. So:
 *
 * - `E2E_MOCK_PORT` set: use it (and, outside CI, reuse a server already
 *   listening there — you named it, so you meant it).
 * - CI: 8091, never reused, as before. The runner is a fresh machine.
 * - Otherwise: a free port picked now, so a local run always starts its own
 *   server and no other checkout can be listening on it.
 *
 * Playwright loads this file again in every worker process. The choice is
 * written back to `process.env` before any worker is spawned, so the workers
 * (and `MOCK_API` in e2e/setup/extension-context.ts) inherit the SAME port
 * instead of each picking its own.
 */
const namedPort = process.env.E2E_MOCK_PORT;
const mockPort = namedPort ?? (process.env.CI ? '8091' : freePort());
process.env.E2E_MOCK_PORT = mockPort;

/** An OS-assigned free port. Synchronous, because the config is not async. */
function freePort(): string {
    return execFileSync(process.execPath, [
        '-e',
        "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});",
    ]).toString().trim();
}

export default defineConfig({
    testDir: './e2e/tests',
    /* Maximum time one test can run for. */
    timeout: 30000,
    expect: {
        /**
         * Maximum time expect() should wait for the condition to be met.
         */
        timeout: 10000
    },
    /* Run tests in files in parallel */
    fullyParallel: false,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 1 : 0,
    /* Opt out of parallel tests on CI. */
    workers: 1, // Extensions need sequential tests or separate profiles
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /*
         * Maximum time one action (`click()`, `fill()`, …) may take. Bounded, and
         * well under the test timeout, so an element that never appears fails
         * as THAT action naming its locator, not as a bare 30 s test timeout
         * (#343). Matches the expect timeout: an action waits as long as an
         * assertion would for the same element.
         */
        actionTimeout: 10000,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        /* Base URL to use in actions like `await page.goto('/')`. */
        // baseURL: 'http://127.0.0.1:3000',
        headless: false, // REQUIRED for extensions
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* Run your local dev server before starting the tests */
    webServer: {
        command: `PORT=${mockPort} npx tsx e2e/fixtures/mock-api/server.ts`,
        port: Number(mockPort),
        reuseExistingServer: !process.env.CI && namedPort !== undefined,
        timeout: 15000,
    },
});
