// src/entrypoints/auth-bridge.content.ts
import { browser } from 'wxt/browser';
import { createLogger } from '../lib/utils/logger';
import { isTrustedDashboardOrigin } from '../lib/auth/trusted-origin';
import {
  announceCopilotPresence,
  dashboardAdvertisesPanel,
  DASHBOARD_PANEL_MESSAGE,
} from '../lib/auth/presence-marker';

/**
 * Auth Bridge Content Script
 *
 * Bridges the gap between the Dashboard web app and the Extension background script.
 * Listens for successful login events from the dashboard and forwards the token.
 *
 * Security: Validates message origins against the CONFIGURED Dashboard origin
 * (Cloud default + the user's `dashboardUrl`), not a hardcoded port allowlist.
 * Token Rotation: Listens for storage events to detect token refreshes.
 * Panel handshake: also carries the page's claim that it hosts the built-in
 * copilot panel, so the extension's side panel can stand down on this tab. The
 * claim rides the SAME origin-validated channel as the auth payload — see the
 * contract next to announceCopilotPresence in lib/auth/presence-marker.ts.
 */

export default defineContentScript({
  // Registered at RUNTIME by the background worker for the configured Dashboard
  // origin only (see registerAuthBridge in background.ts). It is therefore NOT
  // in the manifest, so it no longer injects on every localhost page, and it
  // supports custom self-hosted OAuth dashboard domains. matches is supplied at
  // registration time.
  registration: 'runtime',
  runAt: "document_end",
  main() {
    const log = createLogger('AuthBridge');
    log.info("Auth bridge initialized");

    // Tell the dashboard page the copilot is installed (it reads this to show
    // an "open from your toolbar" hint instead of an install CTA).
    announceCopilotPresence(browser.runtime.getManifest().version);

    /**
     * Forward auth state to extension background script
     */
    async function forwardAuthState(authState: any) {
      try {
        // Validate auth state structure
        if (!authState?.access_token || !authState?.expires_at) {
          log.warn('Invalid auth state structure, skipping forward');
          return;
        }

        // Check if token is expired
        if (authState.expires_at <= Date.now()) {
          log.warn('Token is expired, skipping forward');
          return;
        }

        // Forward to background script
        await browser.runtime.sendMessage({
          action: "storeAuth",
          payload: authState
        });
        log.info("Auth data forwarded to extension");
      } catch (error) {
        log.error("Failed to forward auth data:", error);
      }
    }

    /**
     * Tell the background worker this Dashboard hosts its own copilot panel.
     *
     * Deliberately carries NO origin in the payload: a page cannot be trusted
     * to name itself, so the background re-derives the sender's origin from
     * what the browser attributes to this content script and validates that.
     * The check here is the near guard, not the only one.
     */
    async function reportDashboardPanelAvailable() {
      try {
        await browser.runtime.sendMessage({ action: 'dashboardPanelAvailable' });
        log.info('Reported the dashboard\'s built-in panel to the background');
      } catch (error) {
        // Background not ready — the next advertisement (or the next page load)
        // reports again. Failing here just leaves the extension panel showing,
        // which is the safe direction.
        log.debug('Could not report the dashboard panel:', error);
      }
    }

    /**
     * Listen for window messages from the web app (postMessage)
     * CRITICAL: Validates origin to prevent malicious injection
     */
    window.addEventListener("message", async (event) => {
      // Security check: Ensure message is from same window
      if (event.source !== window) {
        log.warn('Rejected message from different source');
        return;
      }

      // Security check: Validate origin against the configured Dashboard origin
      if (!(await isTrustedDashboardOrigin(event.origin))) {
        log.warn('Rejected message from untrusted origin:', event.origin);
        return;
      }

      const message = event.data;

      // Handle login success message from dashboard
      if (message && message.type === "FM_AUTH_SUCCESS") {
        log.info("Auth success detected via postMessage", { origin: event.origin });
        await forwardAuthState(message.payload);
        return;
      }

      // The page telling us its built-in copilot panel is available. This is
      // the channel for a dashboard that only mounts the panel after the
      // document loaded; a dashboard that knows at render time should carry
      // DASHBOARD_PANEL_ATTR in its initial HTML instead, which the
      // document_end check below picks up with no window in between.
      if (message && message.type === DASHBOARD_PANEL_MESSAGE) {
        log.info("Dashboard advertises its built-in panel", { origin: event.origin });
        await reportDashboardPanelAvailable();
      }
    });

    /**
     * Listen for storage events to detect token rotation
     * When dashboard refreshes token, it updates localStorage
     * This listener catches that update and forwards new token
     */
    window.addEventListener('storage', (event) => {
      // Only handle our auth state key
      if (event.key !== 'fm_auth_state') return;

      // Only handle updates (not deletions)
      if (!event.newValue) return;

      try {
        const authState = JSON.parse(event.newValue);
        log.info("Token rotation detected via storage event");
        forwardAuthState(authState).catch((error) => {
          log.error("Failed to forward rotated token:", error);
        });
      } catch (e) {
        log.warn("Failed to parse auth state from storage event:", e);
      }
    });

    /**
     * Fallback: Poll localStorage for token if message event is missed
     * This helps if extension is installed AFTER login
     */
    const checkLocalStorage = () => {
      try {
        const authStateStr = localStorage.getItem("fm_auth_state");
        if (authStateStr) {
          const authState = JSON.parse(authStateStr);
          // Only send if it looks valid and recent
          if (authState?.access_token && authState.expires_at > Date.now()) {
            log.info("Found existing auth state in localStorage, forwarding");
            forwardAuthState(authState).catch(() => {
              // Ignore errors (e.g. if background script is not ready)
            });
          }
        }
      } catch (e) {
        // Ignore storage errors
        log.debug("Error checking localStorage:", e);
      }
    };

    // Check on load (for extension installed after login)
    checkLocalStorage();

    // And read the panel claim the page rendered into its initial HTML. Same
    // shape as checkLocalStorage above: the live listener catches what happens
    // from here on, this catches what was already true when we were injected.
    if (dashboardAdvertisesPanel()) {
      reportDashboardPanelAvailable();
    }
  }
});

