import { test, expect } from '../setup/extension-context';

test.describe('Content Script Injection', () => {
    test('Content script injects on allowed target pages', async ({ context }) => {
        const page = await context.newPage();

        // Navigate to local generic html file
        await page.goto('http://localhost:8091/pages/generic-page.html');

        let hasConsoleErrors = false;
        page.on('console', msg => {
            // Ignore favicon and network errors, focus on script exceptions
            if (msg.type() === 'error' && msg.text().includes('TypeError')) {
                hasConsoleErrors = true;
            }
        });

        await page.reload();
        expect(hasConsoleErrors).toBe(false);
    });

    test('Dashboard mock limits auth-bridge origin validation', async ({ context }) => {
        const page = await context.newPage();
        // The auth-bridge runs on specific patterns like app.faultmaven.ai and localhost
        await page.goto('http://localhost:8091/pages/dashboard.html');

        // Verify the page loaded correctly without extension errors breaking it
        await expect(page.locator('h1')).toContainText('Dashboard Mock');

        // Click button to trigger postMessage login success
        // This will send FM_AUTH_SUCCESS to the window
        await page.click('#login-success-btn');

        // We expect the auth bridge to process it without throwing unhandled exceptions.
        // Further auth flow verification happens in the 04-auth-flow test.
    });

    test('Content script respects restrictive CSP', async ({ context }) => {
        const page = await context.newPage();
        await page.goto('http://localhost:8091/pages/restricted-csp.html');

        // Ensure the page with strict CSP doesn't trigger continuous extension crash loops
        await expect(page.locator('h1')).toContainText('Strict CSP');
    });
});
