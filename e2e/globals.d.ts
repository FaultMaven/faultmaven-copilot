/**
 * The specs run callbacks INSIDE extension contexts (`page.evaluate` on a panel
 * page, `worker.evaluate` on the service worker), where Chromium's `chrome` is
 * a global. Declared for e2e only (e2e/tsconfig.json): the extension source
 * reaches the browser through `browser` and must not see this.
 */
declare const chrome: typeof import('wxt/browser').browser;
