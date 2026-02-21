import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const test = base.extend<{
    context: BrowserContext;
    extensionId: string;
}>({
    context: async ({ }, use) => {
        // The extension is built to .output/chrome-mv3 by WXT
        const pathToExtension = path.join(__dirname, '../../.output/chrome-mv3');

        // Check if extension is built
        if (!fs.existsSync(pathToExtension) || !fs.existsSync(path.join(pathToExtension, 'manifest.json'))) {
            throw new Error(`Extension build not found at ${pathToExtension}. Run 'pnpm build' first.`);
        }

        const context = await chromium.launchPersistentContext('', {
            headless: false, // Required for extensions
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
            ],
        });

        // Wait for the background service worker to register
        let [background] = context.serviceWorkers();
        if (!background) {
            background = await context.waitForEvent('serviceworker');
        }

        await use(context);

        await context.close();
    },
    extensionId: async ({ context }, use) => {
        let [background] = context.serviceWorkers();
        if (!background) {
            background = await context.waitForEvent('serviceworker');
        }

        const extensionId = background.url().split('/')[2];
        await use(extensionId);
    },
});

export const expect = test.expect;
