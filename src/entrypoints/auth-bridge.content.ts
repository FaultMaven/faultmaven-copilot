// src/entrypoints/auth-bridge.content.ts
import { browser } from 'wxt/browser';

/**
 * Auth Bridge Content Script
 * 
 * Bridges the gap between the Dashboard web app and the Extension background script.
 * Listens for successful login events from the dashboard and forwards the token.
 */

export default defineContentScript({
  matches: ["*://app.faultmaven.ai/*", "*://localhost/*"],
  runAt: "document_end",
  main() {
    console.log("[FaultMaven Bridge] Auth bridge initialized");

    // Listen for window messages from the web app
    window.addEventListener("message", async (event) => {
      // Security check: Ensure message is from trusted origin
      // In production, this should be stricter
      if (event.source !== window) return;

      const message = event.data;

      // Handle login success message from dashboard
      if (message && message.type === "FM_AUTH_SUCCESS") {
        console.log("[FaultMaven Bridge] Auth success detected", message.payload);

        try {
          // Forward to background script
          await browser.runtime.sendMessage({
            action: "storeAuth",
            payload: message.payload
          });
          console.log("[FaultMaven Bridge] Auth data forwarded to extension");
        } catch (error) {
          console.error("[FaultMaven Bridge] Failed to forward auth data:", error);
        }
      }
    });

    // Fallback: Poll localStorage for token if message event is missed
    // This helps if extension is installed AFTER login
    const checkLocalStorage = () => {
      try {
        const authStateStr = localStorage.getItem("fm_auth_state");
        if (authStateStr) {
          const authState = JSON.parse(authStateStr);
          // Only send if it looks valid and recent
          if (authState?.access_token && authState.expires_at > Date.now()) {
            browser.runtime.sendMessage({
              action: "storeAuth",
              payload: authState
            }).catch(() => {
              // Ignore errors (e.g. if background script is not ready)
            });
          }
        }
      } catch (e) {
        // Ignore storage errors
      }
    };

    // Check on load
    checkLocalStorage();
  }
});

