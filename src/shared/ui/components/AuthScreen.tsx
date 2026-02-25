/**
 * Authentication Screen — ADR 003 Dark Theme
 *
 * Dynamically renders authentication UI based on backend auth configuration:
 * - Local: Username/password form
 * - OIDC: "Sign in with Organization" button
 * - SAML: SAML SSO button
 *
 * Queries GET /api/v1/auth/config to determine which mode is active.
 */

import React, { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getAuthConfig, AuthConfig } from '../../../lib/auth/auth-config';
import { createLogger } from '../../../lib/utils/logger';
import { LocalLoginForm } from './LocalLoginForm';

const log = createLogger('AuthScreen');

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Fetch auth configuration on mount
  useEffect(() => {
    async function loadAuthConfig() {
      try {
        const config = await getAuthConfig();
        setAuthConfig(config);
        setLoading(false);
      } catch (err: any) {
        log.error('Failed to load auth config:', err);
        setError(err.message || 'Failed to load authentication configuration');
        setLoading(false);
      }
    }

    loadAuthConfig();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const handleAuthChange = (message: any) => {
      if (message.type === 'auth_state_changed' && message.authState) {
        log.info('Auth state changed, triggering success');
        onAuthSuccess();
      }
    };

    browser.runtime.onMessage.addListener(handleAuthChange);
    return () => {
      browser.runtime.onMessage.removeListener(handleAuthChange);
    };
  }, [onAuthSuccess]);

  // Handle OIDC/SAML login button click
  async function handleSSOLogin() {
    setIsAuthenticating(true);
    setError(null);

    try {
      // Send message to background script to initiate OIDC flow
      const response = await browser.runtime.sendMessage({ action: 'initiateOIDCLogin' });

      if (response?.status !== 'success') {
        throw new Error(response?.message || 'Failed to initiate SSO login');
      }

      // Background script will open authorization URL in new tab
      // User will complete SSO flow, callback will store auth state
      // auth_state_changed message will trigger onAuthSuccess
    } catch (err: any) {
      log.error('SSO login failed:', err);
      setError(err.message || 'Failed to initiate SSO login');
      setIsAuthenticating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-fm-bg">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-fm-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-fm-text-tertiary">Loading authentication...</p>
        </div>
      </div>
    );
  }

  if (error || !authConfig) {
    return (
      <div className="flex items-center justify-center h-screen bg-fm-bg">
        <div className="max-w-md mx-auto p-8 bg-fm-surface rounded-xl border border-fm-border">
          <div className="text-center mb-4">
            <svg className="w-16 h-16 text-fm-critical mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-bold text-white mb-2">Authentication Error</h2>
            <p className="text-fm-text-tertiary">{error || 'Failed to load authentication configuration'}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2 bg-fm-accent text-white rounded-lg hover:opacity-90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen bg-fm-bg">
      <div className="max-w-md mx-auto p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <img
              src="/icon/square-dark.svg"
              alt="FaultMaven Logo"
              className="h-16 w-auto"
            />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            FaultMaven Copilot
          </h1>
          <p className="text-lg text-fm-text-tertiary">
            Sign in to get started
          </p>
        </div>

        {/* Authentication UI */}
        <div className="bg-fm-surface rounded-xl border border-fm-border p-6">
          {authConfig.provider === 'local' && (
            <LocalLoginForm authConfig={authConfig} onAuthSuccess={onAuthSuccess} />
          )}

          {(authConfig.provider === 'oidc' || authConfig.provider === 'saml') && (
            <>
              <p className="text-fm-text-tertiary mb-4 text-center">
                Sign in using your organization's SSO
              </p>
              <button
                onClick={handleSSOLogin}
                disabled={isAuthenticating}
                className="w-full px-6 py-3 bg-fm-accent text-white font-medium rounded-lg hover:opacity-90 transition-colors disabled:bg-fm-elevated disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isAuthenticating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                    <span>Sign in with Organization</span>
                  </>
                )}
              </button>
            </>
          )}

          {error && (
            <div className="mt-4 p-3 bg-fm-critical-bg border border-fm-critical-border rounded-lg">
              <p className="text-sm text-fm-critical">{error}</p>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-fm-text-secondary mt-6">
          Powered by FaultMaven AI
        </p>
      </div>
    </div>
  );
}
