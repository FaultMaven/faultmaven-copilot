import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, backgroundWorker, seedExtensionStorage, MOCK_API } from '../setup/extension-context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The Dashboard -> Copilot sign-in bridge, end to end (#265).
 *
 * The bridge content script is registered AT RUNTIME for the configured
 * Dashboard origin only, and only where the extension holds host permission
 * (src/extension/auth/auth-bridge-registration.ts). A localhost Dashboard would
 * need the OPTIONAL `http://localhost/*` grant, which `permissions.request`
 * gives only behind a user gesture and a browser prompt that Playwright cannot
 * answer. The Cloud Dashboard origin is a REQUIRED host permission and the
 * default `dashboardUrl`, so the bridge is registered for it on install; the
 * page itself is served by `context.route`, so nothing leaves the machine.
 */
const CLOUD_DASHBOARD_ORIGIN = 'https://app.faultmaven.ai';

const signedInDashboardHtml = fs.readFileSync(
    path.join(__dirname, '../fixtures/target-pages/dashboard-signed-in.html'),
    'utf-8',
);

test.describe('Dashboard bridge sign-in', () => {
    test('Dashboard signed in -> Copilot opened cold renders the chat UI, not the sign-in screen', async ({ context, extensionId }) => {
        const background = await backgroundWorker(context);

        // A configured install talking to the mock API. `dashboardUrl` is left
        // UNSET on purpose so the Cloud default — the origin the bridge is
        // registered for — stays the Dashboard. Seeded from the worker, before
        // any panel document exists, so no panel startup can interleave with it.
        await seedExtensionStorage(context, { apiBaseUrl: MOCK_API, hasCompletedFirstRun: true });

        // The worker registers the bridge at startup; wait for it rather than
        // racing the first navigation against `registerContentScripts`.
        await expect.poll(async () => background.evaluate(async () => {
            const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ['auth-bridge'] });
            return scripts[0]?.matches ?? [];
        })).toEqual([`${CLOUD_DASHBOARD_ORIGIN}/*`]);

        await context.route(`${CLOUD_DASHBOARD_ORIGIN}/**`, (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: signedInDashboardHtml }),
        );

        // 1. The Dashboard is signed in. Loading it is what hands the session
        //    to the extension: the bridge forwards `fm_auth_state` to
        //    `handleStoreAuth`, which writes it in one `storage.set`.
        const dashboard = await context.newPage();
        await dashboard.goto(`${CLOUD_DASHBOARD_ORIGIN}/cases`);
        await expect(dashboard.locator('h1')).toContainText('Dashboard Mock');

        await expect.poll(async () => background.evaluate(async () => {
            const stored = await chrome.storage.local.get(['authState', 'access_token', 'refresh_token']);
            return {
                user: (stored.authState as { user?: { user_id?: string } } | undefined)?.user?.user_id ?? null,
                accessToken: stored.access_token ?? null,
                refreshToken: stored.refresh_token ?? null,
            };
        })).toEqual({
            user: 'e2e-bridge-user',
            accessToken: 'e2e-bridge-access-token',
            refreshToken: 'e2e-bridge-refresh-token',
        });

        // 2. Open the Copilot cold: the first panel document of this profile.
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // 3. The chat UI, not the sign-in screen.
        await expect(panel.getByText(/New Case/i).first()).toBeVisible();
        await expect(panel.getByText('Sign in to get started')).toHaveCount(0);

        // And the panel's startup repair (`reconcileSession`) kept the
        // credential the bridge wrote — the original symptom was a mount that
        // swept it and bounced the user to the sign-in screen.
        const after = await background.evaluate(async () => {
            const stored = await chrome.storage.local.get(['authState', 'access_token']);
            return { hasRow: !!stored.authState, accessToken: stored.access_token ?? null };
        });
        expect(after).toEqual({ hasRow: true, accessToken: 'e2e-bridge-access-token' });
    });
});
