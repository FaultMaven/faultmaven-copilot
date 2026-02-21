import { test, expect } from '../setup/extension-context';

test.describe('UI Rendering', () => {
    test.beforeEach(async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Inject auth state to skip to the case/chat view
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                // @ts-ignore
                chrome.storage.local.set({
                    authState: {
                        access_token: 'e2e-mock-token',
                        expires_at: Date.now() + 86400000,
                        refresh_token: 'e2e-refresh-token',
                        refresh_expires_at: Date.now() + 86400000 * 7,
                        user: { user_id: 'e2e-user', username: 'test_user', roles: ['user'] }
                    },
                    access_token: 'e2e-mock-token',
                    expires_at: Date.now() + 86400000,
                    refresh_token: 'e2e-refresh-token',
                    refresh_expires_at: Date.now() + 86400000 * 7,
                    user: { user_id: 'e2e-user', username: 'test_user', roles: ['user'] },
                    apiEndpoint: 'http://localhost:8091',
                    hasCompletedFirstRun: true
                }, () => {
                    chrome.storage.local.get(null, (res) => console.log('INJECT SUCCESS: ', res));
                    resolve();
                });
            });
        });

        await page.reload();

        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                // @ts-ignore
                chrome.storage.local.get(null, (res) => {
                    console.log('AFTER RELOAD: ', res);
                    resolve();
                });
            });
        });
    });

    test('Empty/welcome state renders on first open', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        await page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first().click().catch(() => { });

        await page.evaluate(() => {
            return new Promise<void>((resolve) => chrome.storage.local.clear(resolve));
        });
        await page.reload();

        const body = page.locator('body');
        await expect(body).toContainText(/(Welcome|Cloud|Local)/i);
    });

    test('User message appears in chat after typing and submitting', async ({ context, extensionId }) => {
        const page = await context.newPage();
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Wait for input to be ready
        const newCaseBtn = page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first();
        await newCaseBtn.waitFor({ state: 'visible' });
        await newCaseBtn.click();

        // Wait for the active case to load before selecting the textarea
        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();

        // Type and send
        await input.fill('Hello, this is a test query');
        const sendBtn = page.getByRole('button', { name: 'Send' });
        await expect(sendBtn).toBeEnabled();
        await sendBtn.click();

        // Message should visibly appear (matches the optimistic user chunk)
        await expect(page.locator('#conversation-history')).toContainText('Hello, this is a test query');
    });

    test('Loading indicator shows during API call', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        await page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first().click().catch(() => { });

        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();

        await input.fill('Simulate long load');
        const sendBtn2 = page.locator('button:has-text("Send")');
        await expect(sendBtn2).toBeEnabled();
        await sendBtn2.click();

        // Verify our unified input bar has a submitting/loading indicator
        await expect(page.getByText('Sending...')).toBeVisible();
    });

    test('Error response (500) shows user-friendly error message after sending', async ({ context, extensionId }) => {
        const page = await context.newPage();

        // First, set the server state to return a 500
        await page.request.post('http://localhost:8091/__admin/state', {
            data: { shouldFail: true }
        });

        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        await page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first().click().catch(() => { });

        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();
        await input.fill('Trigger error');
        const sendBtn3 = page.locator('button:has-text("Send")');
        await expect(sendBtn3).toBeEnabled();
        await sendBtn3.click();

        // Check for an error message indicating failure
        // The exact text will depend on ErrorClassifier output
        const body = page.locator('body');
        await expect(body).toContainText(/(fail|error|wrong)/i);

        // Reset server state
        await page.request.post('http://localhost:8091/__admin/reset');
    });

    test('Rate limited (429) shows retry message', async ({ context, extensionId }) => {
        const page = await context.newPage();

        await page.request.post('http://localhost:8091/__admin/state', {
            data: { rateLimit: true }
        });

        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // This could trigger on login or listing cases depending on the API calls on startup
        const body = page.locator('body');
        await expect(body).toContainText(/(limit|exceeded|try again)/i);

        await page.request.post('http://localhost:8091/__admin/reset');
    });
});
