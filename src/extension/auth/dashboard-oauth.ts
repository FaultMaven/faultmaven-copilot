/**
 * Dashboard OAuth Flow
 *
 * Implements OAuth 2.0 Authorization Code Flow with PKCE for Dashboard-centric authentication.
 * The Dashboard acts as the Identity Provider (IdP) for the browser extension.
 *
 * Flow:
 * 1. Extension generates PKCE parameters
 * 2. Extension opens Dashboard /auth/authorize in the browser's own auth window
 *    (identity.launchWebAuthFlow)
 * 3. User logs into Dashboard and approves consent
 * 4. Dashboard navigates to https://{extension-id}.chromiumapp.org/ with the
 *    authorization code; the browser recognises that target, closes the auth
 *    window, and hands the URL back to launchWebAuthFlow
 * 5. Extension exchanges code for tokens using PKCE verifier
 *
 * ⚠️ Steps 2-4 require deployment-side support that does not exist yet — see
 * OAUTH_IMPLEMENTATION.md ("Redirect URI: pending cross-repo support"). The
 * backend's `oauth_redirect_uri_patterns` does not admit the chromiumapp.org
 * target, and the Dashboard's authorize page does not navigate to redirect_uri.
 */

import { browser } from 'wxt/browser';
import { getHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('DashboardOAuth');

/**
 * Dashboard OAuth initiation response
 */
export interface DashboardOAuthInitiateResponse {
  authorization_url: string;
  state: string;
  code_challenge: string;
}

/**
 * Get Dashboard URL from browser storage
 *
 * The extension stores Dashboard URL (not API URL) because:
 * - Users always interact with Dashboard first (for OAuth login)
 * - Dashboard knows how to reach the API backend
 * - Simpler architecture: no URL derivation needed
 *
 * Local deployment: http://127.0.0.1:3333
 * Cloud deployment: https://app.faultmaven.ai
 */
export async function getDashboardUrl(): Promise<string> {
  // Single source of truth is the host's endpoints (the explicit dashboardUrl
  // key with a legacy fallback, in the extension). This thin wrapper is kept
  // for existing call sites.
  return getHostEndpoints().dashboardUrl();
}

/**
 * Initiate Dashboard OAuth flow
 *
 * Generates PKCE parameters, stores them, and returns the Dashboard authorization URL.
 *
 * @returns Authorization URL to open in new tab + PKCE state
 */
export async function initiateDashboardOAuth(): Promise<DashboardOAuthInitiateResponse> {
  try {
    // Generate PKCE code verifier and challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Redirect target for identity.launchWebAuthFlow:
    // `https://<extension-id>.chromiumapp.org/` (Chrome) or
    // `https://<uuid>.extensions.allizom.org/` (Firefox). This is the ONLY
    // target launchWebAuthFlow recognises: it watches the auth window for a
    // navigation matching this URL, and that match is what closes the window
    // and resolves the call. `runtime.getURL('/callback.html')` would never
    // resolve it, which is why the old flow needed a real page plus a
    // tabs.onUpdated watcher to notice the redirect at all.
    //
    // NOT an anti-impersonation measure, despite what this change's commit
    // message claims. A hostile extension requests its OWN redirect target —
    // `https://<their-id>.chromiumapp.org/` — exactly as it previously
    // requested `chrome-extension://<their-id>/callback.html`, so any server
    // pattern wildcarding the id admits both equally. What closes that gap is
    // pinning this extension's real id in `oauth_redirect_uri_patterns`, and
    // that works the same for either redirect style.
    const redirectUri = browser.identity.getRedirectURL();

    log.info('Initiating Dashboard OAuth flow', { redirectUri });

    // Store PKCE parameters for later verification
    await browser.storage.local.set({
      pkce_verifier: codeVerifier,
      auth_state: state,
      redirect_uri: redirectUri,
      auth_initiated_at: Date.now()
    });

    // Build Dashboard authorization URL
    const dashboardUrl = await getDashboardUrl();
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: 'faultmaven-copilot',
      redirect_uri: redirectUri,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'openid profile email cases:read cases:write knowledge:read evidence:read'
    });

    const authorizationUrl = `${dashboardUrl}/auth/authorize?${authParams.toString()}`;

    log.info('Dashboard OAuth initiated', { dashboardUrl, state });

    return {
      authorization_url: authorizationUrl,
      state: state,
      code_challenge: codeChallenge
    };

  } catch (error) {
    log.error('Failed to initiate Dashboard OAuth:', error);
    throw error;
  }
}

/**
 * Clean up OAuth state after completion or error
 */
export async function cleanupOAuthState(): Promise<void> {
  await browser.storage.local.remove([
    'pkce_verifier',
    'auth_state',
    'redirect_uri',
    'auth_initiated_at',
    'oauth_pending'
  ]);
  log.info('OAuth state cleaned up');
}

// ============================================================================
// PKCE Helper Functions (OAuth 2.0 Security for Browser Extensions)
// ============================================================================

/**
 * Generate PKCE code verifier (random string, 43-128 characters)
 *
 * Base64url-encoded random bytes (RFC 7636)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32); // 32 bytes = 43 characters in base64url
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

/**
 * Generate PKCE code challenge from verifier (SHA-256 hash)
 *
 * challenge = BASE64URL(SHA256(verifier))
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(hash));
}

/**
 * Generate random state parameter for CSRF protection (32 characters)
 */
function generateState(): string {
  const array = new Uint8Array(16); // 16 bytes = 32 hex characters
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Base64 URL encoding (without padding)
 *
 * Converts binary data to base64url format (RFC 4648 Section 5)
 */
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
