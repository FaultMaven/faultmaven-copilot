import { test, expect } from '../setup/extension-context';

test.describe('Extension Lifecycle', () => {
    test('Extension loads and service worker registers', async ({ context }) => {
        let [background] = context.serviceWorkers();
        if (!background) {
            background = await context.waitForEvent('serviceworker');
        }
        expect(background).toBeTruthy();
        expect(background.url()).toContain('background.js');
    });

    test('Side panel opens and renders correctly', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Check that we don't have a blank screen
        await expect(page.locator('#root')).toBeVisible();

        // Check for some text or element that indicates it rendered
        const bodyText = await page.locator('body').textContent();
        expect(bodyText?.trim().length).toBeGreaterThan(0);
    });

    test('Extension survives page navigation', async ({ context, extensionId }) => {
        const page = await context.newPage();

        // Go to a dummy page
        await page.goto('about:blank');

        // Verify service worker is still alive
        let [background] = context.serviceWorkers();
        expect(background).toBeTruthy();

        // Navigate away
        await page.goto('chrome://version/');

        // Verify it's still alive
        [background] = context.serviceWorkers();
        expect(background).toBeTruthy();
    });
});
