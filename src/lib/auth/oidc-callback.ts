/**
 * OIDC Callback Handler
 *
 * Handles the OAuth2/OIDC callback after user completes SSO authentication.
 * Extracts authorization code and state from URL, exchanges for tokens via backend,
 * and stores authentication state in extension storage.
 */

import { browser } from 'wxt/browser';
import { handleOIDCCallback } from './auth-config';
import { authManager } from '../api';

async function handleCallback() {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');

  try {
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    // Handle OAuth error response
    if (error) {
      throw new Error(errorDescription || `OAuth error: ${error}`);
    }

    // Validate required parameters
    if (!code || !state) {
      throw new Error('Missing authorization code or state parameter');
    }

    console.log('[OIDC Callback] Processing callback with code and state');

    // Exchange authorization code for tokens
    const authResponse = await handleOIDCCallback(code, state);

    // Store authentication state
    await authManager.saveAuthState(authResponse);

    // Notify extension background script
    try {
      await browser.runtime.sendMessage({
        type: "auth_state_changed",
        authState: authResponse
      });
    } catch (e) {
      console.warn('[OIDC Callback] Could not notify background script:', e);
      // Not critical - auth state is saved
    }

    console.log('[OIDC Callback] Authentication successful');

    // Show success and close window
    if (loadingEl) {
      loadingEl.innerHTML = `
        <svg style="width: 48px; height: 48px; margin: 0 auto 1rem; color: #10b981;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <h2>Sign-in successful!</h2>
        <p>You can close this window.</p>
      `;
    }

    // Close window after 2 seconds
    setTimeout(() => {
      window.close();
    }, 2000);

  } catch (err: any) {
    console.error('[OIDC Callback] Authentication failed:', err);

    // Show error to user
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'block';
    if (errorMessageEl) {
      errorMessageEl.textContent = err.message || 'Authentication failed. Please try again.';
    }
  }
}

// Run callback handler when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleCallback);
} else {
  handleCallback();
}

