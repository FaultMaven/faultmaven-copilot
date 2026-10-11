import { test, expect, backgroundWorker, seedExtensionStorage, MOCK_API } from '../setup/extension-context';

/**
 * A sign-in that lands while the panel is starting up must survive the panel's
 * startup repair (copilot#342).
 *
 * The panel runs `authManager.reconcileSession()` once on mount. It used to
 * look at storage and then act on it in separate steps, so a sign-in written
 * in between looked like credentials with no session row and was swept as
 * debris: the user signed in on the Dashboard and the Copilot showed the
 * sign-in screen. Measured before #344: 28 of 48 runs of this test ended
 * signed out, and every one checked for the cause had logged the sweep. After
 * it: 96 of 96 passed.
 *
 * WHAT THIS PINS, precisely: storage starts EMPTY here, so the repair's
 * one-snapshot read is what this test exercises — it passed 24 of 24 with the
 * repair's lock removed (#346). The window only the session-write LOCK closes
 * (a snapshot that finds real debris, then a sign-in before the sweep acts) is
 * pinned by the unit tests in src/test/lib/auth/reconcile-sign-in-race.test.ts
 * and teardown-stale-verdict.test.ts, which fail with the lock removed.
 *
 * The sign-in is the SHIPPED bridge writer: `storeAuth` is the exact message
 * the Dashboard bridge content script sends, handled by the worker's
 * `handleStoreAuth`. It is sent the moment the panel document has loaded,
 * which is when the repair is in flight.
 */
test.describe('Sign-in during panel startup', () => {
    test('a bridge sign-in landing while the panel starts leaves the panel signed in', async ({ context, extensionId }) => {
        const worker = await backgroundWorker(context);

        // A configured install, written before any panel exists.
        await seedExtensionStorage(context, { apiBaseUrl: MOCK_API, hasCompletedFirstRun: true });

        const sweeps: string[] = [];
        context.on('console', (msg) => {
            if (/outlived their session row|no live credential behind it/.test(msg.text())) {
                sweeps.push(msg.text());
            }
        });

        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Immediately — the panel's startup repair is running now.
        const response = await panel.evaluate(() => chrome.runtime.sendMessage({
            action: 'storeAuth',
            payload: {
                access_token: 'race-access-token',
                token_type: 'bearer',
                expires_at: Date.now() + 3600000,
                refresh_token: 'race-refresh-token',
                user: { user_id: 'race-user', username: 'race_user', roles: ['user'] },
            },
        }));
        expect(response).toEqual({ status: 'success' });

        // Wait until the panel has decided, either way, then check the cause
        // before the symptom so a failure names the sweep.
        await expect(panel.getByText(/New Case|Sign in to get started/).first()).toBeVisible();
        expect(sweeps).toEqual([]);

        const stored = await worker.evaluate(async () => {
            const s = await chrome.storage.local.get(['authState', 'access_token', 'refresh_token']);
            return {
                user: (s.authState as { user?: { user_id?: string } } | undefined)?.user?.user_id ?? null,
                accessToken: s.access_token ?? null,
                refreshToken: s.refresh_token ?? null,
            };
        });
        expect(stored).toEqual({
            user: 'race-user',
            accessToken: 'race-access-token',
            refreshToken: 'race-refresh-token',
        });

        await expect(panel.getByText(/New Case/i).first()).toBeVisible();
        await expect(panel.getByText('Sign in to get started')).toHaveCount(0);
    });
});
