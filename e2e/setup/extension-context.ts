import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MOCK_API = 'http://localhost:8091';

/** What `POST /__admin/reset` restores (e2e/fixtures/mock-api/server.ts). */
export const DEFAULT_MOCK_STATE = {
    shouldFail: false,
    rateLimit: false,
    authExpired: false,
    responseDelayMs: 0,
};

export const test = base.extend<{
    context: BrowserContext;
    extensionId: string;
    mockApiState: void;
}>({
    // The mock API server is the ONLY mutable state shared between tests: the
    // browser context below is test-scoped (a fresh profile per test), but the
    // server process lives for the whole run (`workers: 1`, one `webServer`).
    // A test that sets a flag and dies before clearing it hands the flag to the
    // next test, in this file or the next one.
    //
    // So it is reset HERE, before every test, rather than in an `afterEach`:
    // cleanup that runs after a failure can be skipped (no page left to post
    // from, or a swallowed error), and skipping it is the wrong direction.
    // Then it is READ BACK and asserted, so a reset that did not take — a
    // reused server from an older checkout that lacks the route, say — fails
    // loudly at the top of the test instead of as a 500 in its middle.
    mockApiState: [async ({ request }, use) => {
        const reset = await request.post(`${MOCK_API}/__admin/reset`);
        base.expect(reset.ok(), 'mock API reset failed').toBe(true);
        const state = await (await request.get(`${MOCK_API}/__admin/state`)).json();
        base.expect(state, 'mock API state at the start of the test').toEqual(DEFAULT_MOCK_STATE);
        await use();
    }, { auto: true }],
    context: async ({ }, use) => {
        // The extension is built to .output/chrome-mv3 by WXT
        const pathToExtension = path.join(__dirname, '../../.output/chrome-mv3');

        // Check if extension is built
        if (!fs.existsSync(pathToExtension) || !fs.existsSync(path.join(pathToExtension, 'manifest.json'))) {
            throw new Error(`Extension build not found at ${pathToExtension}. Run 'pnpm build' first.`);
        }

        const context = await chromium.launchPersistentContext('', {
            headless: false, // Required for extensions
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
            ],
        });

        // Wait for the background service worker to register
        let [background] = context.serviceWorkers();
        if (!background) {
            background = await context.waitForEvent('serviceworker');
        }

        await use(context);

        await context.close();
    },
    extensionId: async ({ context }, use) => {
        const background = await backgroundWorker(context);
        const extensionId = background.url().split('/')[2];
        await use(extensionId);
    },
});

export const expect = test.expect;

export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
    const [background] = context.serviceWorkers();
    return background ?? context.waitForEvent('serviceworker');
}

/**
 * Write `chrome.storage.local` from the background worker.
 *
 * Call it BEFORE the test opens any panel page. Seeding from a panel page that
 * has just loaded races the panel's own startup: `authManager.reconcileSession`
 * reads `authState`, then separately asks whether any credential exists, and a
 * write landing between the two reads looks to it like credentials that
 * outlived their row — it clears them, and the next load clears the row. That
 * interleaving signed out roughly every other test in 03-ui-rendering (#265).
 */
export async function seedExtensionStorage(context: BrowserContext, items: Record<string, unknown>): Promise<void> {
    const background = await backgroundWorker(context);
    await background.evaluate(async (toWrite) => {
        // @ts-ignore — the worker's global, not this file's
        await chrome.storage.local.set(toWrite);
    }, items);
}

/** A signed-in, configured install pointed at the mock API. */
export function signedInStorage(): Record<string, unknown> {
    const user = { user_id: 'e2e-user', username: 'test_user', roles: ['user'] };
    const expiresAt = Date.now() + 86400000;
    const refreshExpiresAt = Date.now() + 86400000 * 7;
    return {
        authState: {
            access_token: 'e2e-mock-token',
            expires_at: expiresAt,
            refresh_token: 'e2e-refresh-token',
            refresh_expires_at: refreshExpiresAt,
            user,
        },
        access_token: 'e2e-mock-token',
        expires_at: expiresAt,
        refresh_token: 'e2e-refresh-token',
        refresh_expires_at: refreshExpiresAt,
        user,
        apiEndpoint: MOCK_API,
        hasCompletedFirstRun: true,
    };
}
