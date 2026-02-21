import { test, expect } from '../setup/extension-context';

test('debug render', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            // @ts-ignore
            chrome.storage.local.set({
                authState: {
                    access_token: 'e2e-mock-token',
                    expires_at: Date.now() + 86400000,
                    refresh_token: 'e2e-refresh-token',
                    refresh_expires_at: Date.now() + 86400000 * 7,
                    user: {
                        user_id: 'e2e-user',
                        username: 'test_user',
                        roles: ['user']
                    }
                },
                apiEndpoint: 'http://localhost:8090',
                hasCompletedFirstRun: true
            }, resolve);
        });
    });
    await page.reload();
    await page.waitForTimeout(2000);

    const storage = await page.evaluate(() => {
        return new Promise((resolve) => {
            // @ts-ignore
            chrome.storage.local.get(null, resolve);
        });
    });
    console.log("Storage contents:", JSON.stringify(storage, null, 2));

    const authState = await page.evaluate(() => {
        return window.localStorage.getItem('authState') || 'none';
    });
    console.log("localStorage authState:", authState);

    const html = await page.content();
    console.log("Is Login Screen?", html.includes('Sign in to get started'));
});
