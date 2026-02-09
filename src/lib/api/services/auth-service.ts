import { browser } from 'wxt/browser';
import config, { getApiUrl } from "../../../config";
import { authManager } from "../../auth/auth-manager";
import { authenticatedFetch, prepareBody } from "../client";
import { APIError, AuthState, AuthTokenResponse, UserProfile } from "../types";
import { createHttpErrorFromResponse } from "../../errors/http-error";

export async function devLogin(
  username: string,
  email?: string,
  displayName?: string
): Promise<AuthTokenResponse> {
  try {
    const response = await fetch(`${await getApiUrl()}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: prepareBody({
        username,
        email,
        display_name: displayName
      }),
      credentials: 'include'
    });

    if (!response.ok) {
      throw await createHttpErrorFromResponse(response);
    }

    const authResponse = await response.json();

    // Store auth state using AuthManager
    const authState: AuthState = {
      access_token: authResponse.access_token,
      token_type: authResponse.token_type,
      expires_at: Date.now() + (authResponse.expires_in * 1000),
      user: authResponse.user
    };

    await authManager.saveAuthState(authState);

    return authResponse;
  } catch (error) {
    // Wrap network errors with better messaging
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError: any = new Error('Unable to connect to server');
      networkError.name = 'NetworkError';
      networkError.originalError = error;
      throw networkError;
    }
    throw error;
  }
}

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function logoutAuth(): Promise<void> {
  try {
    const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });

    if (!response.ok) {
      throw await createHttpErrorFromResponse(response);
    }
  } finally {
    // Clear auth state regardless of response status
    await authManager.clearAuthState();

    // Broadcast auth state change to other tabs
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          type: 'auth_state_changed',
          authState: null
        });
      } catch (error) {
        // Ignore messaging errors - not critical for logout
        console.warn('[API] Failed to broadcast logout:', error);
      }
    }
  }
}
