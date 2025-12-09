/**
 * Auth Configuration API Client
 *
 * Queries the backend to determine which authentication mode is active.
 * Enables deployment-neutral authentication (local vs OIDC/SAML).
 */

import { getApiUrl } from '../../config';
import { createLogger } from '../utils/logger';

const log = createLogger('AuthConfig');

/**
 * Auth provider configuration from backend
 */
export interface AuthConfig {
  provider: 'local' | 'oidc' | 'saml';
  login_url?: string;
  features: {
    supports_registration: boolean;
    supports_password_reset: boolean;
    supports_email_verification: boolean;
    requires_redirect: boolean;  // True for OIDC/SAML
  };
}

/**
 * OIDC login initiation response
 */
export interface OIDCInitiateResponse {
  authorization_url: string;
  state: string;
  code_challenge?: string;
}

/**
 * Cached auth config (avoid repeated API calls)
 */
let cachedAuthConfig: AuthConfig | null = null;

/**
 * Get authentication configuration from backend
 *
 * This tells the extension which authentication mode is active:
 * - local: Show username/password form
 * - oidc: Show "Sign in with Organization" button
 * - saml: Show SAML SSO button
 *
 * @returns Auth configuration
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  // Return cached config if available
  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  try {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/api/v1/auth/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Auth config failed: ${response.status}`);
    }

    const config: AuthConfig = await response.json();

    // Cache the config
    cachedAuthConfig = config;

    log.info('Retrieved auth configuration:', config.provider);
    return config;
  
  } catch (error) {
    log.error('Failed to get auth config:', error);

    // Fallback to local auth if backend is unreachable
    const fallbackConfig: AuthConfig = {
      provider: 'local',
      features: {
        supports_registration: true,
        supports_password_reset: true,
        supports_email_verification: false,
        requires_redirect: false
      }
    };

    return fallbackConfig;
  }
}

/**
 * Initiate OIDC/SAML login flow
 *
 * Opens a new browser tab for SSO authentication.
 *
 * @param redirectUri - Callback URL after authentication
 * @returns Authorization URL to open in new tab
 */
export async function initiateOIDCLogin(redirectUri: string): Promise<OIDCInitiateResponse> {
  try {
    const apiUrl = getApiUrl();

    // Generate PKCE code verifier and challenge (for browser extension security)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Store code verifier for later use in callback
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.set({ oidc_code_verifier: codeVerifier });
    }

    // Call backend to initiate OIDC flow
    const response = await fetch(`${apiUrl}/api/v1/auth/login/initiate?` + new URLSearchParams({
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    }), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'OIDC initiation failed' }));
      throw new Error(error.detail || `OIDC initiation failed: ${response.status}`);
    }

    const result: OIDCInitiateResponse = await response.json();
    log.info('OIDC login initiated');

    return result;

  } catch (error) {
    log.error('OIDC initiation failed:', error);
    throw error;
  }
}

/**
 * Handle OIDC callback (exchange code for tokens)
 *
 * Called after user completes SSO authentication.
 *
 * @param code - Authorization code from OIDC provider
 * @param state - CSRF state parameter
 * @returns Auth tokens and user info
 */
export async function handleOIDCCallback(code: string, state: string): Promise<any> {
  try {
    const apiUrl = getApiUrl();

    // Retrieve code verifier from storage
    let codeVerifier: string | undefined;
    if (typeof browser !== 'undefined' && browser.storage) {
      const result = await browser.storage.local.get(['oidc_code_verifier']);
      codeVerifier = result.oidc_code_verifier;

      // Clean up code verifier
      await browser.storage.local.remove(['oidc_code_verifier']);
    }

    // Exchange code for tokens
    const response = await fetch(`${apiUrl}/api/v1/auth/callback?` + new URLSearchParams({
      code,
      state,
      ...(codeVerifier && { code_verifier: codeVerifier })
    }), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'OIDC callback failed' }));
      throw new Error(error.detail || `OIDC callback failed: ${response.status}`);
    }

    const result = await response.json();
    log.info('OIDC callback successful');

    return result;

  } catch (error) {
    log.error('OIDC callback failed:', error);
    throw error;
  }
}

/**
 * Clear cached auth config (force reload on next call)
 */
export function clearAuthConfigCache(): void {
  cachedAuthConfig = null;
}

// ============================================================================
// PKCE Helper Functions (for OIDC security in browser extensions)
// ============================================================================

/**
 * Generate PKCE code verifier (random string)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

/**
 * Generate PKCE code challenge from verifier (SHA-256 hash)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(hash));
}

/**
 * Base64 URL encoding (without padding)
 */
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
