import { useState } from 'react';
import { browser } from 'wxt/browser';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('usePageContent');

export function usePageContent() {
  const [pageContent, setPageContent] = useState<string>("");
  const [injectionStatus, setInjectionStatus] = useState<{ message: string; type: 'success' | 'error' | '' }>({ message: "", type: "" });

  const getPageContent = async (): Promise<string> => {
    try {
      setInjectionStatus({ message: "🔄 Analyzing page content...", type: "" });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        throw new Error("No active tab found");
      }

      // Check if tab URL is valid for content script injection
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://'))) {
        throw new Error("Cannot analyze browser internal pages (chrome://, about:, etc.)");
      }

      let capturedContent = '';

      try {
        // Try sending message to existing content script
        const response = await browser.tabs.sendMessage(tab.id, { action: "getPageContent" });

        if (response && response.content) {
          capturedContent = response.content;
          setPageContent(capturedContent);
          setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
          return capturedContent;
        }
      } catch (messageError: any) {
        // If content script doesn't exist, try programmatic injection as fallback
        log.info("Content script not responding, attempting programmatic injection...");

        try {
          // Get the result from the injection (single call)
          const [result] = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
          });

          if (result && result.result) {
            capturedContent = result.result;
            setPageContent(capturedContent);
            setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
            return capturedContent;
          }
        } catch (injectionError: any) {
          log.error("Programmatic injection failed:", injectionError);

          // Check if it's a permission error
          const errorMsg = injectionError.message || "";
          if (errorMsg.includes("Cannot access contents") || errorMsg.includes("manifest must request permission")) {
            throw new Error("Cannot analyze this page. Please refresh the page first, then try again");
          }

          throw new Error(`Cannot inject script: ${injectionError.message}`);
        }
      }

      throw new Error("Failed to capture page content");
    } catch (err: any) {
      log.error("getPageContent error:", err);
      const errorMsg = err.message || "Unknown error occurred";
      setInjectionStatus({
        message: `⚠️ ${errorMsg}. Please try refreshing the page.`,
        type: "error"
      });
      throw err; // Re-throw so caller knows it failed
    }
  };

  const handlePageInject = async (): Promise<string> => {
    // Capture the page content and return it directly (not from state)
    const content = await getPageContent();
    return content;
  };

  return {
    pageContent,
    injectionStatus,
    setInjectionStatus,
    handlePageInject
  };
}
