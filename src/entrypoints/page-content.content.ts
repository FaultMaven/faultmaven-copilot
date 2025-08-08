// src/entrypoints/page-content.content.ts
// NO import for defineContentScript
import { browser } from 'wxt/browser';

export default defineContentScript({
  matches: ["<all_urls>"], // Allow content script on all HTTPS pages
  runAt: "document_idle",
  main() {
    console.log(
      `%c[page-content.content.ts] MAIN FUNCTION EXECUTED on: ${window.location.href}`,
      "color: orange; font-weight:bold;"
    );

    browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
      console.log("[page-content.content.ts] Message received in listener. Message:", message, "Sender ID:", sender.id); // Log sender ID

      if (message && message.action === "getPageContent") {
        console.log("[page-content.content.ts] 'getPageContent' action matched.");
        try {
          const pageContent = document.documentElement.outerHTML;
          console.log("[page-content.content.ts] Extracted outerHTML (snippet):", pageContent.substring(0, 100) + "...");
          sendResponse({
            status: "success",
            data: pageContent,
            url: window.location.href
          });
        } catch (e: any) {
          console.error("[page-content.content.ts] Error getting page content:", e);
          sendResponse({ status: "error", message: e.message || "Failed to get page content" });
        }
        return true; // Indicate that sendResponse will be called
      }
      
      console.log("[page-content.content.ts] Action not matched or message malformed for this listener. Request action:", message?.action);
      return false; 
    });

    console.log("[page-content.content.ts] Listener added. Script ready.");
  }
});
