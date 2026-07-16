// src/entrypoints/background.ts
import { createSession, deleteSession, authManager } from '../lib/api';
import { PersistenceManager } from '../lib/utils/persistence-manager';
import { browser } from 'wxt/browser';
import config from '../config';
import { reconcileAuthBridgeRegistration } from '../lib/auth/auth-bridge-registration';
import { initiateDashboardOAuth, cleanupOAuthState } from '../lib/auth/dashboard-oauth';
import { createLogger } from '../lib/utils/logger';

export default defineBackground({
  main() {
    const log = createLogger('Background');
    log.info("Init (Fixed: Backend Session Logic)");

    // === Auth Handler ===
    async function handleStoreAuth(payload: any, sendResponse: (response?: any) => void) {
      // Never log the token-bearing payload; record only non-secret fields.
      log.info("storing auth state from bridge", {
        hasToken: !!payload?.access_token,
        hasRefresh: !!payload?.refresh_token,
        expiresAt: payload?.expires_at,
      });
      try {
        // Persist the TokenManager keys (not just the composite authState) so a
        // bridge-established session can auto-refresh like an OAuth-established one.
        // Previously only saveAuthState() ran, which writes the `authState` key but
        // NOT `refresh_token`, so getAuthHeaders/TokenManager had no refresh material
        // and the session silently logged out at access-token expiry. The dashboard's
        // fm_auth_state payload carries `refresh_token` (verified against the
        // dashboard's AuthState); mirror the OAuth-callback storage format here.
        if (payload?.access_token) {
          const tokenData: Record<string, any> = {
            access_token: payload.access_token,
            token_type: payload.token_type ?? 'bearer',
            expires_at: payload.expires_at, // bridge payload carries an absolute epoch-ms expiry
            user: payload.user,
          };
          // storage.set MERGES — it never removes keys. Clear stale refresh material
          // from a previous session so it can't (a) log the user out via a past/null
          // refresh_expires_at (TokenManager treats `<= now` as an expired refresh
          // window and clears everything), or (b) pair a PREVIOUS user's refresh_token
          // with this login's access token.
          const keysToRemove: string[] = [];
          if (payload.refresh_token) {
            tokenData.refresh_token = payload.refresh_token;
            // The dashboard AuthState has no refresh expiry; derive one only if the
            // raw payload happens to carry it, else drop any stale value — an absent
            // refresh_expires_at makes TokenManager refresh until the backend
            // definitively rejects (identical to the OAuth-callback path).
            if (typeof payload.refresh_expires_at === 'number') {
              tokenData.refresh_expires_at = payload.refresh_expires_at;
            } else if (typeof payload.refresh_expires_in === 'number') {
              tokenData.refresh_expires_at = Date.now() + payload.refresh_expires_in * 1000;
            } else {
              keysToRemove.push('refresh_expires_at');
            }
          } else {
            keysToRemove.push('refresh_token', 'refresh_expires_at');
          }
          await browser.storage.local.set(tokenData);
          if (keysToRemove.length > 0) {
            await browser.storage.local.remove(keysToRemove);
          }
        }

        // Keep the composite authState for the getAuthHeaders fallback path.
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

    // === Monitor OAuth Tab for Success Page (MV3 service-worker resilient) ===
    // The listener is registered once at the top level of the worker (see
    // main() below) and reads the pending-OAuth context from storage on each
    // navigation. This survives service-worker eviction: the worker is woken by
    // the tab-update event and reconstructs context from storage. The old
    // implementation relied on an in-memory closure + setTimeout, both of which
    // were destroyed if the SW slept while the user was on the login page (the
    // common case), silently stranding the OAuth flow.
    const OAUTH_PENDING_KEY = 'oauth_pending';

    async function handleOAuthTabUpdate(tabId: number, changeInfo: any, tab: any) {
      // Only navigation events can carry the OAuth redirect; skip the frequent
      // status/title/favicon updates to avoid needless storage reads.
      const url = changeInfo?.url || (changeInfo?.status === 'complete' ? tab?.url : undefined);
      if (!url) return;

      let pending: any;
      try {
        const stored = await browser.storage.local.get([OAUTH_PENDING_KEY]);
        pending = stored[OAUTH_PENDING_KEY];
      } catch {
        return;
      }
      if (!pending || pending.tabId !== tabId) return;

      // Expire stale flows (replaces the old setTimeout-based cleanup).
      if (typeof pending.deadline === 'number' && Date.now() > pending.deadline) {
        log.warn('OAuth flow timed out; clearing pending state');
        await cleanupOAuthState();
        return;
      }

      let code: string | null = null;
      let state: string | null = null;
      try {
        const parsedUrl = new URL(url);
        code = parsedUrl.searchParams.get('code');
        state = parsedUrl.searchParams.get('state');
      } catch {
        return; // not a navigable URL yet
      }

      if (code && state && state === pending.expectedState) {
        log.info('OAuth authorization code detected in monitored tab');
        // Clear pending first so the parallel callback.html → AUTH_CALLBACK path
        // does not double-process the same authorization code.
        await browser.storage.local.remove(OAUTH_PENDING_KEY);

        await handleAuthCallback({ code, state }, (response) => {
          log.info('OAuth callback handled (tab monitor):', response);
        });

        try {
          await browser.tabs.remove(tabId);
        } catch (e) {
          log.warn('Could not close OAuth tab:', e);
        }
      }
    }

    // === Dashboard OAuth Login Handler ===
    async function handleInitiateDashboardOAuth(sendResponse: (response?: any) => void) {
      log.info('Initiating Dashboard OAuth flow');

      try {
        // Check if storage is available before proceeding
        if (typeof browser === 'undefined' || !browser.storage) {
          throw new Error('Browser storage not available');
        }

        // Initiate Dashboard OAuth flow (generates PKCE parameters and stores them)
        const oauthResponse = await initiateDashboardOAuth();

        log.info('Dashboard OAuth URL:', oauthResponse.authorization_url);

        // Open Dashboard authorization page in new tab
        const tab = await browser.tabs.create({
          url: oauthResponse.authorization_url,
          active: true
        });

        if (!tab.id) {
          throw new Error('Failed to create OAuth tab');
        }

        log.info('Dashboard OAuth initiated, authorization tab opened');

        // Persist pending-OAuth context so the top-level tab listener can
        // complete the flow even if the service worker is evicted during login.
        await browser.storage.local.set({
          [OAUTH_PENDING_KEY]: {
            tabId: tab.id,
            expectedState: oauthResponse.state,
            deadline: Date.now() + 5 * 60 * 1000
          }
        });

        sendResponse({ status: 'success', state: oauthResponse.state });
      } catch (error: any) {
        log.error('Failed to initiate Dashboard OAuth:', error);

        // Clean up on error
        try {
          await cleanupOAuthState();
        } catch (cleanupError) {
          log.warn('Failed to cleanup OAuth state:', cleanupError);
        }

        const errorMessage = error instanceof Error ? error.message : 'Failed to initiate Dashboard OAuth';
        sendResponse({ status: 'error', message: errorMessage });
      }
    }

    // === OAuth Callback Handler ===
    async function handleAuthCallback(payload: { code: string; state: string }, sendResponse: (response?: any) => void) {
      log.info('Handling OAuth callback', { state: payload.state });

      try {
        // Validate input
        if (!payload.code || !payload.state) {
          throw new Error('Invalid callback: missing code or state');
        }

        // Retrieve stored PKCE verifier and state
        const storage = await browser.storage.local.get(['pkce_verifier', 'auth_state', 'redirect_uri']);

        if (!storage.pkce_verifier || !storage.auth_state) {
          throw new Error('No pending authorization request found. Please try logging in again.');
        }

        // Verify state parameter (CSRF protection)
        if (payload.state !== storage.auth_state) {
          log.error('State mismatch', { expected: storage.auth_state, received: payload.state });
          throw new Error('State parameter mismatch - possible CSRF attack');
        }

        log.info('State verified, exchanging authorization code for tokens');

        // Exchange authorization code for access token
        const { getApiUrl } = await import('../config');
        const apiUrl = await getApiUrl();

        const tokenResponse = await fetch(`${apiUrl}/api/v1/auth/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code: payload.code,
            code_verifier: storage.pkce_verifier,
            client_id: 'faultmaven-copilot',
            redirect_uri: storage.redirect_uri || browser.runtime.getURL('/callback.html')
          })
        });

        if (!tokenResponse.ok) {
          const error = await tokenResponse.json().catch(() => ({ error: 'unknown', error_description: 'Failed to parse error response' }));
          throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
        }

        const tokens = await tokenResponse.json();

        // Validate token response (per AuthTokenResponse in backend)
        if (!tokens.access_token || !tokens.user) {
          throw new Error('Invalid token response: missing required fields');
        }

        log.info('Tokens received successfully');

        // Use complete user object from API response (per AuthTokenResponse.user: UserProfile)
        // Backend returns full user object with all required fields
        const user = {
          user_id: tokens.user.user_id,
          username: tokens.user.username,
          email: tokens.user.email,
          display_name: tokens.user.display_name,
          is_dev_user: tokens.user.is_dev_user,
          is_active: true,  // User is active if they successfully authenticated
          roles: tokens.user.roles || ['user']
        };

        // Store tokens and user info
        await browser.storage.local.set({
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_at: Date.now() + (tokens.expires_in * 1000),
          refresh_token: tokens.refresh_token,
          refresh_expires_at: tokens.refresh_expires_in ? Date.now() + (tokens.refresh_expires_in * 1000) : undefined,
          user: user
        });

        // Create auth state for compatibility with existing auth system
        const authState = {
          access_token: tokens.access_token,
          token_type: tokens.token_type,
          expires_at: Date.now() + (tokens.expires_in * 1000),
          user: user
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
          // Ignore if no listener (side panel may not be open)
          log.debug('Could not broadcast auth state change:', e);
        }

        sendResponse({ success: true, user: tokens.user });
      } catch (error: any) {
        log.error('OAuth callback failed:', error);

        // Clean up PKCE state on error
        try {
          await cleanupOAuthState();
        } catch (cleanupError) {
          log.warn('Failed to cleanup OAuth state after error:', cleanupError);
        }

        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        sendResponse({ success: false, error: errorMessage });
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
    browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
      // Defense-in-depth: only accept messages from this extension's own
      // contexts (our content scripts, side panel, options page). Messages from
      // other installed extensions carry a different sender.id and are rejected
      // before reaching any auth/session handler.
      if (sender?.id !== browser.runtime.id) {
        log.warn("Rejected runtime message from unexpected sender", { senderId: sender?.id });
        sendResponse({ status: "error", message: "Unauthorized sender" });
        return false;
      }
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

    // === Auth-bridge runtime registration ===
    // The auth bridge runs only on the CONFIGURED Dashboard origin (Cloud by
    // default, or a self-hosted/custom dashboard) — registered at runtime, not
    // via a static manifest match. Reconcile now, and whenever the configured
    // dashboard URL or granted host permissions change.
    reconcileAuthBridgeRegistration();
    browser.storage.onChanged.addListener((changes: any, area: string) => {
      // dashboardUrl is the explicit key; apiEndpoint is the legacy key
      // getDashboardUrl() still falls back to.
      if (area === 'local' && (changes.dashboardUrl || changes.apiEndpoint)) {
        reconcileAuthBridgeRegistration();
      }
    });
    // Re-reconcile on both grant and revoke of host permissions.
    if (browser.permissions?.onAdded) {
      browser.permissions.onAdded.addListener(() => reconcileAuthBridgeRegistration());
    }
    if (browser.permissions?.onRemoved) {
      browser.permissions.onRemoved.addListener(() => reconcileAuthBridgeRegistration());
    }

    // === OAuth Tab Monitor (registered top-level so it survives SW eviction) ===
    browser.tabs.onUpdated.addListener(handleOAuthTabUpdate);

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
