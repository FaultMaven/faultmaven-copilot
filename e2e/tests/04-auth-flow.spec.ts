import { test, expect } from '../setup/extension-context';

test.describe('Auth Flow', () => {
    test('Unauthenticated state shows login prompt', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Clear storage to guarantee unauthenticated
        await page.evaluate(() => {
            return new Promise<void>((resolve) => chrome.storage.local.clear(resolve));
        });
        await page.reload();

        const body = page.locator('body');
        await expect(body).toContainText(/(login|sign in|welcome|local|cloud)/i);
    });

    test.fixme('OAuth/login flow completes successfully', async ({ context, extensionId }) => {
        // TODO: Intercept the new tab created for OAuth, extract the state from the URL,
        // hit the mock server's /callback endpoint or simulate the postMessage cascade, 
        // and verify that tokens are written to chrome.storage.
    });

    test.fixme('Authenticated requests include correct auth headers', async ({ context, extensionId }) => {
        // TODO: Validate Headers. Covered partially in api-integration.
    });

    test.fixme('Expired token triggers re-auth prompt', async ({ context, extensionId }) => {
        // TODO: Set token expiry to past, reload panel, verify login prompt appears.
    });

    test.fixme('Logout clears stored credentials', async ({ context, extensionId }) => {
        // TODO: Find the settings/logout button, click it, and read storage to ensure it's empty.
    });
});
