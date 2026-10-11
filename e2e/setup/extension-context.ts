import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The mock API for THIS run. The port is chosen once per run in
 * playwright.config.ts (a free one locally, so parallel worktrees never share a
 * server and its state) and inherited here through `E2E_MOCK_PORT`.
 */
export const MOCK_API = `http://localhost:${process.env.E2E_MOCK_PORT ?? '8091'}`;

/** What `POST /__admin/reset` restores (e2e/fixtures/mock-api/server.ts). */
export const DEFAULT_MOCK_STATE = {
    shouldFail: false,
    rateLimit: false,
    authExpired: false,
    responseDelayMs: 0,
};

// The `context` fixture's bounds (#343). Together they fit inside the 30 s test
// timeout, so a stuck step fails as that step, by name, before the test does.
/** How long Chromium may take to launch with the extension loaded. */
const LAUNCH_TIMEOUT_MS = 15_000;
/** How long the extension's service worker may take to register. */
const SERVICE_WORKER_TIMEOUT_MS = 10_000;
/** One wait for the `serviceworker` event before the list is read again. */
const SERVICE_WORKER_POLL_MS = 1_000;

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
        // Every request no mock route answered during the test (the context is
        // closed by now, so nothing more arrives). Each one is a route the
        // client calls and the mock does not serve: the test ran the client's
        // 404 fallback instead of the path it meant to (#343). Fails the test
        // naming the route.
        const unmatched = await (await request.get(`${MOCK_API}/__admin/unmatched`)).json();
        base.expect(
            unmatched,
            'requests the mock API has no route for: serve them in e2e/fixtures/mock-api/server.ts',
        ).toEqual([]);
    }, { auto: true }],
    context: async ({ }, use) => {
        // The extension is built to .output/chrome-mv3 by WXT
        const pathToExtension = path.join(__dirname, '../../.output/chrome-mv3');

        // Check if extension is built
        if (!fs.existsSync(pathToExtension) || !fs.existsSync(path.join(pathToExtension, 'manifest.json'))) {
            throw new Error(`Extension build not found at ${pathToExtension}. Run 'pnpm build' first.`);
        }

        // Bounded, and each step named: a hang here used to surface only as
        // "Test timeout of 30000ms exceeded while setting up context" (#343),
        // which does not say whether Chromium never launched or the extension's
        // worker never registered.
        const context = await chromium.launchPersistentContext('', {
            headless: false, // Required for extensions
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
            ],
            timeout: LAUNCH_TIMEOUT_MS,
        }).catch((error: Error) => {
            throw new Error(`context fixture: launchPersistentContext did not complete within ${LAUNCH_TIMEOUT_MS} ms: ${error.message}`);
        });

        // The extension's background service worker has registered.
        await backgroundWorker(context);

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

/**
 * The extension's background service worker, waited for with a bound.
 *
 * Reads `context.serviceWorkers()` and, while it is empty, waits for the
 * `serviceworker` event in short slices, re-reading the list after each. The
 * list is the source of truth: a worker whose event fired while nothing was
 * listening is still in it. The plain "list, else wait for the event" form
 * waited with no bound of its own if the registration landed in that gap,
 * which is one candidate for the rare `context` fixture hang (#343), so a
 * worker found only by a re-read is logged, to measure whether the gap is
 * ever hit.
 */
export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
    const startedAt = Date.now();
    for (;;) {
        const [listed] = context.serviceWorkers();
        if (listed) {
            const waited = Date.now() - startedAt;
            if (waited > SERVICE_WORKER_POLL_MS) {
                console.warn(`[e2e fixture] extension service worker found by re-reading the list after ${waited} ms (its registration event was not observed)`);
            }
            return listed;
        }
        const waited = Date.now() - startedAt;
        if (waited >= SERVICE_WORKER_TIMEOUT_MS) {
            throw new Error(
                `context fixture: the extension's service worker did not register within ${SERVICE_WORKER_TIMEOUT_MS} ms ` +
                `(Chromium launched; pages open: ${context.pages().length}).`,
            );
        }
        const slice = Math.min(SERVICE_WORKER_POLL_MS, SERVICE_WORKER_TIMEOUT_MS - waited);
        const worker = await context.waitForEvent('serviceworker', { timeout: slice }).catch(() => undefined);
        if (worker) return worker;
    }
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
