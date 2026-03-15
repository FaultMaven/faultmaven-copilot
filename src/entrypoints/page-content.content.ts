// src/entrypoints/page-content.content.ts
// NO import for defineContentScript — WXT auto-injects it
import { browser } from 'wxt/browser';
import { createLogger } from '~/lib/utils/logger';
import { htmlToStructuredText } from '~/lib/utils/html-to-structured-text';

const log = createLogger('PageContent');

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    log.debug('Content script initialized', { url: window.location.href });

    browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
      log.debug('Message received', { action: message?.action, senderId: sender.id });

      if (message && message.action === "getPageContent") {
        log.debug('Processing getPageContent action');
        try {
          // Semantic text extraction — runs on the live DOM so
          // getComputedStyle works and .value is read directly.
          const pageContent = htmlToStructuredText(document);
          log.debug('Page content extracted', { contentLength: pageContent.length });
          sendResponse({
            status: "success",
            content: pageContent,
            url: window.location.href
          });
        } catch (e: any) {
          log.error('Error getting page content', e);
          sendResponse({ status: "error", message: e.message || "Failed to get page content" });
        }
        return true;
      }

      log.debug('Action not matched', { action: message?.action });
      return false;
    });

    log.debug('Listener added, script ready');
  }
});
