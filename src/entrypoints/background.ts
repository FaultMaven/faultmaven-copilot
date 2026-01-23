// src/entrypoints/background.ts
import { createSession, deleteSession, authManager } from '../lib/api';
import { PersistenceManager } from '../lib/utils/persistence-manager';
import { browser } from 'wxt/browser';
import config from '../config';
import { initiateDashboardOAuth, cleanupOAuthState } from '../lib/auth/dashboard-oauth';
import { createLogger } from '../lib/utils/logger';

export default defineBackground({
  main() {
    const log = createLogger('Background');
    log.info("Init (Fixed: Backend Session Logic)");

    // === Auth Handler ===
    async function handleStoreAuth(payload: any, sendResponse: (response?: any) => void) {
      log.info("storing auth state from bridge", payload);
      try {
        // Use AuthManager to save state
        await authManager.saveAuthState(payload);
        
        // Also broadcast to side panel if open
        try {
          await browser.runtime.sendMessage({
            type: "auth_state_changed",
            authState: payload
          });
        } catch (e) {
          // Ignore if no listener
        }
        
        sendResponse({ status: "success" });
      } catch (error) {
        log.error("Failed to store auth:", error);
        sendResponse({ status: "error", message: String(error) });
      }
    }

    // === Backend Session Logic Functions ===
    async function handleGetSessionId(requestAction: string, sendResponse: (response?: any) => void) {
      log.info(`handleGetSessionId called for action: ${requestAction}`);

      try {
        // Check if we have a valid session stored locally
        const result = await browser.storage.local.get(["sessionId", "sessionCreatedAt", "sessionResumed"]);

        // If we have a recent session (less than configured timeout), use it
        const SESSION_TIMEOUT = config.session.timeoutMs;
        const now = Date.now();
        const sessionAge = result.sessionCreatedAt ? (now - result.sessionCreatedAt) : SESSION_TIMEOUT + 1;

        if (result.sessionId && sessionAge < SESSION_TIMEOUT) {
          log.info("Using existing valid session:", result.sessionId);
          sendResponse({
            sessionId: result.sessionId,
            status: "success",
            sessionResumed: result.sessionResumed || false
          });
          return;
        }

        // Create new backend session using ClientSessionManager
        log.info("Creating new backend session with client-based management...");
        try {
          const session = await createSession();
          log.info("Backend session created/resumed:", session.session_id);
          log.info("Session resumed?", session.session_resumed || false);
          log.info("Client ID:", session.client_id?.slice(0, 8) + '...');

          // Store the session locally with timestamp and resumption info
          await browser.storage.local.set({
            sessionId: session.session_id,
            sessionCreatedAt: now,
            sessionResumed: session.session_resumed || false,
            clientId: session.client_id
          });

          log.info("Session stored locally:", session.session_id);
          sendResponse({
            sessionId: session.session_id,
            status: "success",
            sessionResumed: session.session_resumed || false,
            message: session.message
          });
        } catch (apiError: any) {
          log.error("Failed to create backend session:", apiError);
          sendResponse({ status: "error", message: `Failed to create session: ${apiError.message}` });
        }
      } catch (error) {
        log.error("Error in handleGetSessionId:", error);
        sendResponse({ status: "error", message: "Session creation failed" });
      }
    }

    async function handleClearSession(requestAction: string, sendResponse: (response?: any) => void) {
      log.info(`handleClearSession called for action: ${requestAction}`);

      try {
        // Get current session to delete from backend
        const result = await browser.storage.local.get(["sessionId"]);

        // Try to delete from backend if we have a session ID
        if (result.sessionId) {
          try {
            log.info("Deleting backend session:", result.sessionId);
            await deleteSession(result.sessionId);
            log.info("Backend session deleted successfully");
          } catch (apiError) {
            log.warn("Failed to delete backend session (continuing anyway):", apiError);
            // Continue with local cleanup even if backend deletion fails
          }
        }

        // Clear local storage
        await browser.storage.local.remove(["sessionId", "sessionCreatedAt", "sessionResumed", "clientId"]);
        log.info("Session cleared (local and backend).");
        sendResponse({ status: "success" });
      } catch (error) {
        log.error("Error in handleClearSession:", error);
        sendResponse({ status: "error", message: "Failed to clear session" });
      }
    }

    // === Dashboard OAuth Login Handler ===
    async function handleInitiateDashboardOAuth(sendResponse: (response?: any) => void) {
      log.info('Initiating Dashboard OAuth flow');

      try {
        // Initiate Dashboard OAuth flow (generates PKCE parameters and stores them)
        const oauthResponse = await initiateDashboardOAuth();

        log.info('Dashboard OAuth URL:', oauthResponse.authorization_url);

        // Open Dashboard authorization page in new tab
        await browser.tabs.create({
          url: oauthResponse.authorization_url,
          active: true
        });

        log.info('Dashboard OAuth initiated, authorization tab opened');
        sendResponse({ status: 'success', state: oauthResponse.state });
      } catch (error: any) {
        log.error('Failed to initiate Dashboard OAuth:', error);

        // Clean up on error
        await cleanupOAuthState();

        sendResponse({ status: 'error', message: error.message || 'Failed to initiate Dashboard OAuth' });
      }
    }

    // === OAuth Callback Handler ===
    async function handleAuthCallback(payload: { code: string; state: string }, sendResponse: (response?: any) => void) {
      log.info('Handling OAuth callback', { state: payload.state });

      try {
        // Retrieve stored PKCE verifier and state
        const storage = await browser.storage.local.get(['pkce_verifier', 'auth_state', 'redirect_uri']);

        if (!storage.pkce_verifier || !storage.auth_state) {
          throw new Error('No pending authorization request found');
        }

        // Verify state parameter (CSRF protection)
        if (payload.state !== storage.auth_state) {
          throw new Error('State parameter mismatch - possible CSRF attack');
        }

        log.info('State verified, exchanging authorization code for tokens');

        // Exchange authorization code for access token
        const { getApiUrl } = await import('../config');
        const apiUrl = await getApiUrl();
        const tokenResponse = await fetch(`${apiUrl}/auth/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code: payload.code,
            code_verifier: storage.pkce_verifier,
            client_id: 'faultmaven-copilot',
            redirect_uri: storage.redirect_uri || `chrome-extension://${browser.runtime.id}/callback`
          })
        });

        if (!tokenResponse.ok) {
          const error = await tokenResponse.json();
          throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
        }

        const tokens = await tokenResponse.json();
        log.info('Tokens received successfully');

        // Store tokens and user info
        await browser.storage.local.set({
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_at: Date.now() + (tokens.expires_in * 1000),
          refresh_token: tokens.refresh_token,
          refresh_expires_at: Date.now() + (tokens.refresh_expires_in * 1000),
          session_id: tokens.session_id,
          user: tokens.user
        });

        // Create auth state for compatibility with existing auth system
        const authState = {
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_at: Date.now() + (tokens.expires_in * 1000),
          session_id: tokens.session_id,
          user: tokens.user
        };

        // Use AuthManager to save state
        await authManager.saveAuthState(authState);

        // Clean up PKCE data
        await cleanupOAuthState();

        log.info('OAuth authentication completed successfully');

        // Broadcast auth state change
        try {
          await browser.runtime.sendMessage({
            type: "auth_state_changed",
            authState: authState
          });
        } catch (e) {
          // Ignore if no listener
        }

        sendResponse({ success: true, user: tokens.user });
      } catch (error: any) {
        log.error('OAuth callback failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    }

    // === OAuth Error Handler ===
    async function handleAuthError(payload: { error: string; error_description?: string }) {
      log.error('OAuth error received:', payload);

      // Clean up PKCE data
      await cleanupOAuthState();

      // Could show notification to user or trigger error state in UI
      // For now, just log it
    }

    // === Message Handler ===
    browser.runtime.onMessage.addListener((request: any, _sender: any, sendResponse: any) => {
      log.info("Message received:", request);

      if (request.action === "storeAuth") {
        handleStoreAuth(request.payload, sendResponse);
        return true; // Indicate async response
      }

      if (request.action === "getSessionId") {
        handleGetSessionId(request.action, sendResponse);
        return true; // Indicate async response
      }

      if (request.action === "clearSession") {
        handleClearSession(request.action, sendResponse);
        return true; // Indicate async response
      }

      if (request.action === "initiateOIDCLogin") {
        // Note: Action name kept for backward compatibility with UI
        // But now uses Dashboard OAuth flow instead of OIDC
        handleInitiateDashboardOAuth(sendResponse);
        return true; // Indicate async response
      }

      // OAuth callback from callback.html
      if (request.type === "AUTH_CALLBACK") {
        handleAuthCallback({ code: request.code, state: request.state }, sendResponse);
        return true; // Indicate async response
      }

      // OAuth error from callback.html
      if (request.type === "AUTH_ERROR") {
        handleAuthError({ error: request.error, error_description: request.error_description });
        sendResponse({ status: "received" });
        return false;
      }

      // Handle other actions...
      sendResponse({ status: "error", message: "Unknown action" });
    });

    // === Action Click Handler ===
    browser.action.onClicked.addListener(async (tab: any) => {
      log.info("Action clicked, opening side panel...");
      
      try {
        if (tab.windowId) {
          await browser.sidePanel.open({ windowId: tab.windowId });
        }
      } catch (error) {
        log.error("Error opening side panel:", error);
      }
    });

    // === Installation Handler ===
    browser.runtime.onInstalled.addListener(async (details: any) => {
      log.info("Extension installed/updated:", details);

      // Set reload flag for conversation recovery
      // This triggers recovery on next app load if user had existing conversations
      if (details.reason === 'install' || details.reason === 'update') {
        await PersistenceManager.markReloadDetected();
        log.info("Reload flag set - will trigger recovery on next load");
      }
    });
  }
});
