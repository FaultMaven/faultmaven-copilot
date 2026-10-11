import { test, expect, MOCK_API, seedExtensionStorage, signedInStorage } from '../setup/extension-context';

// Mock API state is reset and asserted before every test by the shared
// fixture (`mockApiState` in e2e/setup/extension-context.ts), so no test here
// has to clean up after itself.
test.describe('UI Rendering', () => {
    test.beforeEach(async ({ context }) => {
        // Signed in BEFORE any panel page exists. Writing this from a panel page
        // that had just loaded raced the panel's startup repair and signed out
        // roughly every other test in this file — see seedExtensionStorage.
        await seedExtensionStorage(context, signedInStorage());
    });

    test('Empty/welcome state renders on first open', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        const newCase = page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first();
        await expect(newCase).toBeVisible();
        await newCase.click();

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

        // Slow down the turns response so the loading indicator stays visible
        await page.request.post(`${MOCK_API}/__admin/state`, {
            data: { responseDelayMs: 5000 }
        });

        const newCase = page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first();
        await expect(newCase).toBeVisible();
        await newCase.click();

        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();

        await input.fill('Simulate long load');
        const sendBtn2 = page.getByRole('button', { name: /Send/i });
        await expect(sendBtn2).toBeEnabled();
        await sendBtn2.click();

        // Verify the agent response area shows the in-flight indicator
        await expect(page.getByText('Working...')).toBeVisible();
    });

    test('Error response (500) shows user-friendly error message after sending', async ({ context, extensionId }) => {
        const page = await context.newPage();

        // First, set the server state to return a 500
        await page.request.post(`${MOCK_API}/__admin/state`, {
            data: { shouldFail: true }
        });

        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        const newCase = page.getByText(/(New Case|E2E Empty Case|E2E Full Case)/i).first();
        await expect(newCase).toBeVisible();
        await newCase.click();

        const input = page.locator('textarea').first();
        await input.waitFor({ state: 'visible' });
        await expect(input).toBeEnabled();
        await input.fill('Trigger error');
        const sendBtn3 = page.getByRole('button', { name: /Send/i });
        await expect(sendBtn3).toBeEnabled();
        await sendBtn3.click();

        // Check for an error message indicating failure
        // The exact text will depend on ErrorClassifier output
        const body = page.locator('body');
        await expect(body).toContainText(/(fail|error|wrong)/i);
    });

    test('Rate limited (429) shows retry message', async ({ context, extensionId }) => {
        // Limit the server BEFORE the first navigation, via `context.request` so
        // it needs no page. Setting it afterwards let the initial healthy load
        // populate the case cache; the reload then served cases from that cache
        // and never reached the rate-limited endpoint, so no banner rendered and
        // the assertion failed against a perfectly working panel.
        await context.request.post(`${MOCK_API}/__admin/state`, {
            data: { rateLimit: true }
        });

        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);

        // Drop any case cache, then reload so the render is driven by a live
        // (rate-limited) request rather than stale cases.
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                // @ts-ignore
                chrome.storage.local.remove(['faultmaven_case_cache'], resolve);
            });
        });
        await page.reload();

        const body = page.locator('body');
        await expect(body).toContainText(/(limit|exceeded|try again|rate limit)/i);
    });
});
