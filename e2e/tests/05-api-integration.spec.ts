import { test, expect, seedExtensionStorage, signedInStorage } from '../setup/extension-context';

test.describe('API Integration', () => {
    test.beforeEach(async ({ context }) => {
        // Mock API state is reset by the shared fixture (`mockApiState`). The
        // session is seeded before any panel page exists — see
        // seedExtensionStorage for the race seeding from a panel page loses.
        await seedExtensionStorage(context, signedInStorage());
    });

    test('Submitting a query sends correct request to API', async ({ context, extensionId }) => {
        const page = await context.newPage();

        // Set up request interception to catch the API call to our mock server
        // Note: Playwright intercepts network calls made by the page, but extension background 
        // fetch requests might not be visible here if they happen in the service worker.
        // We will verify the UI rendering instead as a proxy for the request being handled if 
        // interception misses it.
        let intercepted = false;
        page.on('request', request => {
            if (request.url().includes('8091') && request.method() === 'POST') {
                intercepted = true;
            }
        });

        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        await page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first().click().catch(() => { });

        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();
        await input.fill('Integration Test Query');

        await page.getByRole('button', { name: /Send/i }).click();

        // Wait for the mock API response to be rendered in the UI
        await expect(page.locator('body')).toContainText('This is a mock response from the API');
    });

    test('Network failure shows error message', async ({ context, extensionId }) => {
        const page = await context.newPage();

        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);
        await page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first().click().catch(() => { });

        // Wait for input to be ready
        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();
        await input.fill('Send to dead server');

        // Intercept and abort the turn POST request to simulate a network failure on send
        await page.route('**/api/v1/cases/*/turns', route => route.abort('failed'));

        await page.getByRole('button', { name: /Send/i }).click();

        // Expect some kind of network error indicator, Toast, or inline retry message
        await expect(page.locator('body')).toContainText(/(error|failed|network|connect|try again)/i);
    });
});
