/**
 * Dashboard OAuth Flow
 *
 * Implements OAuth 2.0 Authorization Code Flow with PKCE for Dashboard-centric authentication.
 * The Dashboard acts as the Identity Provider (IdP) for the browser extension.
 *
 * Flow:
 * 1. Extension generates PKCE parameters
 * 2. Extension opens Dashboard /auth/authorize page
 * 3. User logs into Dashboard and approves consent
 * 4. Dashboard redirects to chrome-extension://{id}/callback with authorization code
 * 5. Extension exchanges code for tokens using PKCE verifier
 */

import { browser } from 'wxt/browser';
import { getApiUrl } from '../../config';
import { createLogger } from '../utils/logger';

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
 * Get Dashboard URL from API URL
 *
 * Local deployment: API at :8000, Dashboard at :3000
 * Cloud deployment: Same domain (both served from same host)
 */
export async function getDashboardUrl(): Promise<string> {
  const apiUrl = await getApiUrl();

  // Local deployment detection
  if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
    // Replace API port (8000) with Dashboard port (3000)
    return apiUrl.replace(':8000', ':3000');
  }

  // Cloud deployment: Dashboard is at root of same domain
  // Example: https://app.faultmaven.ai (both API and Dashboard)
  return apiUrl.replace('/api', '');
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

    // Get callback URL (extension's callback.html)
    const redirectUri = browser.runtime.getURL('/callback.html');

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
    'auth_initiated_at'
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
