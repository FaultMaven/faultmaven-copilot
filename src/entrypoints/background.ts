// src/entrypoints/background.ts
import { createSession, deleteSession } from '../lib/api';

export default defineBackground({
  main() {
    console.log("[background.ts] Init (Fixed: Backend Session Logic)");

    const generateUUID = () =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

    // === Backend Session Logic Functions ===
    async function handleGetSessionId(requestAction: string, sendResponse: (response?: any) => void) {
      console.log(`[background.ts] handleGetSessionId called for action: ${requestAction}`);
      
      try {
        // Check if we have a valid session stored locally
        chrome.storage.local.get(["sessionId", "sessionCreatedAt"], async (result) => {
          if (chrome.runtime.lastError) {
            console.error("[background.ts] Error getting stored session:", chrome.runtime.lastError.message);
            sendResponse({ status: "error", message: "Failed to get session ID" });
            return;
          }

          // If we have a recent session (less than 30 minutes old), use it
          const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
          const now = Date.now();
          const sessionAge = result.sessionCreatedAt ? (now - result.sessionCreatedAt) : SESSION_TIMEOUT + 1;

          if (result.sessionId && sessionAge < SESSION_TIMEOUT) {
            console.log("[background.ts] Using existing valid session:", result.sessionId);
            sendResponse({ sessionId: result.sessionId, status: "success" });
            return;
          }

          // Create new backend session
          console.log("[background.ts] Creating new backend session...");
          try {
            const session = await createSession();
            console.log("[background.ts] Backend session created:", session.session_id);
            
            // Store the session locally with timestamp
            chrome.storage.local.set({ 
              sessionId: session.session_id, 
              sessionCreatedAt: now 
            }, () => {
              if (chrome.runtime.lastError) {
                console.error("[background.ts] Error storing session:", chrome.runtime.lastError.message);
                sendResponse({ status: "error", message: "Failed to store session ID" });
              } else {
                console.log("[background.ts] Session stored locally:", session.session_id);
                sendResponse({ sessionId: session.session_id, status: "success" });
              }
            });
          } catch (apiError) {
            console.error("[background.ts] Failed to create backend session:", apiError);
            sendResponse({ status: "error", message: `Failed to create session: ${apiError.message}` });
          }
        });
      } catch (error) {
        console.error("[background.ts] Error in handleGetSessionId:", error);
        sendResponse({ status: "error", message: "Session creation failed" });
      }
    }

    async function handleClearSession(requestAction: string, sendResponse: (response?: any) => void) {
      console.log(`[background.ts] handleClearSession called for action: ${requestAction}`);
      
      try {
        // Get current session to delete from backend
        chrome.storage.local.get(["sessionId"], async (result) => {
          if (chrome.runtime.lastError) {
            console.error("[background.ts] Error getting session for deletion:", chrome.runtime.lastError.message);
            sendResponse({ status: "error", message: "Failed to get session for deletion" });
            return;
          }

          // Try to delete from backend if we have a session ID
          if (result.sessionId) {
            try {
              console.log("[background.ts] Deleting backend session:", result.sessionId);
              await deleteSession(result.sessionId);
              console.log("[background.ts] Backend session deleted successfully");
            } catch (apiError) {
              console.warn("[background.ts] Failed to delete backend session (continuing anyway):", apiError);
              // Continue with local cleanup even if backend deletion fails
            }
          }

          // Clear local storage
          chrome.storage.local.remove(["sessionId", "sessionCreatedAt"], () => {
            if (chrome.runtime.lastError) {
              console.error("[background.ts] Error clearing local session:", chrome.runtime.lastError.message);
              sendResponse({ status: "error", message: "Failed to clear local session." });
            } else {
              console.log("[background.ts] Session cleared (local and backend).");
              sendResponse({ status: "success" });
            }
          });
        });
      } catch (error) {
        console.error("[background.ts] Error in handleClearSession:", error);
        sendResponse({ status: "error", message: "Session clearing failed" });
      }
    }

    // Expose test functions to globalThis for console testing
    (globalThis as any).testBgGetSessionId = (callback: (response: any) => void) => {
      console.log("[background.ts] testBgGetSessionId (via globalThis) invoked.");
      handleGetSessionId("getSessionId (via globalThis)", callback);
    };
    (globalThis as any).testBgClearSession = (callback: (response: any) => void) => {
      console.log("[background.ts] testBgClearSession (via globalThis) invoked.");
      handleClearSession("clearSession (via globalThis)", callback);
    };

    // Existing onMessage listener now calls these refactored handlers
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!request || !request.action) {
        console.warn("[background.ts] onMessage: Received message without action:", request);
        return false;
      }
      console.log(`[background.ts] onMessage: Received action '${request.action}' from`, sender.tab ? `tab ${sender.tab.id}` : "internal extension context");

      if (request.action === "getSessionId") {
        handleGetSessionId(request.action, sendResponse);
        return true;
      }
      if (request.action === "clearSession") {
        handleClearSession(request.action, sendResponse);
        return true;
      }
      // Note: getPageContent logic is no longer here as per your architecture
      console.warn(`[background.ts] onMessage: Unhandled action: ${request.action}`);
      return false;
    });

    // Keep your onClicked listener for opening the side panel (it also tests getPageContent from content script)
    chrome.action.onClicked.addListener(async (tab) => {
      console.log(`[background.ts] Action clicked. Tab ID: ${tab.id}, URL: ${tab.url}`);
      if (tab.id && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        console.log(`[background.ts] onClicked: Sending 'getPageContent' message to content script in tab ${tab.id}`);
        chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => { /* ... same as before ... */ });
      } else { /* ... same as before ... */ }
      // Attempt to open side panel (still expect "No active side panel" error for now)
      try { if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId }); }
      catch (e) { console.error("[background.ts] Error opening side panel on click:", e); }
    });

    chrome.runtime.onInstalled.addListener((details) => {
      console.log('[background.ts] Extension installed or updated:', details);
    });

    console.log("[background.ts] All background listeners active. Test functions (testBgGetSessionId, testBgClearSession) exposed to globalThis.");
  }
});
