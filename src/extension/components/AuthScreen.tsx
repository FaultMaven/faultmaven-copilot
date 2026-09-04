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
import { getAuthConfig, AuthConfig } from '../auth/auth-config';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { LocalLoginForm } from './LocalLoginForm';
import { EventBus, type AuthStateChangedEvent } from '../messaging';

const log = createLogger('AuthScreen');

/**
 * How long the panel waits for an SSO flow to report back before restoring the
 * sign-in button.
 *
 * Deliberately shorter than the background's 5-minute pending-flow deadline: a
 * late success is still honoured (the auth_state_changed listener does not check
 * this state), so the only cost of erring short is offering the user a retry
 * they may not need. The only cost of erring long is a disabled button and a
 * spinner with no way out — which is the defect this exists to close.
 */
const SSO_WAIT_TIMEOUT_MS = 3 * 60 * 1000;

interface AuthScreenProps {
  onAuthSuccess: () => void;
  /**
   * What the last sign-out could not confirm, if anything.
   *
   * A prop rather than shared state: the sign-out that produces it and the
   * screen that shows it are both the extension's, and the shared store is what
   * the OTHER host would have to carry it in for no reader.
   */
  signOutNotice?: string | null;
  onDismissSignOutNotice?: () => void;
}

export function AuthScreen({
  onAuthSuccess,
  signOutNotice = null,
  onDismissSignOutNotice,
}: AuthScreenProps) {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // Deliberately NOT `error`: that renders the full-screen "Authentication
  // Error" block whose only affordance is reloading the panel. A stalled
  // sign-in wants the sign-in button back and an explanation beside it.
  const [waitTimedOut, setWaitTimedOut] = useState(false);

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

  // Stop waiting for a sign-in that is never going to report back.
  //
  // `isAuthenticating` is cleared in exactly one other place: the catch below,
  // which fires when the background reports the flow failed. Once the auth
  // window opens, the sole exit is an `auth_state_changed` broadcast — so
  // anything that ends the flow without one (the consent page erroring, a
  // dropped network) left the panel spinning "Authenticating…" forever, with the
  // button disabled and no way back but reloading the panel.
  //
  // Nothing in the background covers this on its own. identity.launchWebAuthFlow
  // settles only on a redirect back or on the user closing the window; a window
  // that simply stops navigating leaves that promise pending indefinitely, and a
  // pending promise notifies the panel of nothing.
  //
  // This only restores the affordance — it cancels nothing. A late success still
  // arrives on the listener below and still calls onAuthSuccess, so erring short
  // costs the user nothing.
  useEffect(() => {
    if (!isAuthenticating) return;

    const timer = setTimeout(() => {
      log.warn('SSO sign-in did not report back before the wait timeout');
      setIsAuthenticating(false);
      setWaitTimedOut(true);
    }, SSO_WAIT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isAuthenticating]);

  // Listen for auth state changes
  useEffect(() => {
    return EventBus.on<AuthStateChangedEvent>('auth_state_changed', (event) => {
      if (event.authState) {
        log.info('Auth state changed, triggering success');
        onAuthSuccess();
      }
    });
  }, [onAuthSuccess]);

  // Handle OIDC/SAML login button click
  async function handleSSOLogin() {
    setIsAuthenticating(true);
    setError(null);
    setWaitTimedOut(false);

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
          <div className="flex justify-center mb-4">
            <img
              src="/icon/design-transparent.svg"
              alt="FaultMaven"
              className="h-12 w-auto"
            />
          </div>
          <p className="text-lg text-fm-text-tertiary">
            Sign in to get started
          </p>
        </div>

        {/* An unconfirmed account-wide sign-out. Rendered above the sign-in
            control, not as an error: signing out here DID work, and the only
            action it asks for concerns a different client. role="status"
            rather than "alert" for the same reason — this is information, not
            a failure to recover from. */}
        {signOutNotice && (
          <div
            role="status"
            className="mb-4 flex items-start gap-3 rounded-lg border border-fm-warning-border bg-fm-warning-bg p-3"
          >
            <p className="text-sm text-fm-text-secondary flex-1">{signOutNotice}</p>
            <button
              onClick={onDismissSignOutNotice}
              aria-label="Dismiss"
              className="shrink-0 text-fm-text-tertiary hover:text-fm-text-primary transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* Authentication UI */}
        <div className="bg-fm-surface rounded-xl border border-fm-border p-6">
          {authConfig.provider === 'local' && (
            <LocalLoginForm authConfig={authConfig} onAuthSuccess={onAuthSuccess} />
          )}

          {(authConfig.provider === 'oidc' || authConfig.provider === 'saml') && (
            <>
              <p className="text-fm-text-tertiary mb-4 text-center">
                {"Sign in using your organization's SSO"}
              </p>
              {waitTimedOut && (
                <p role="status" className="text-fm-text-tertiary text-sm mb-4 text-center">
                  Sign-in has not completed yet. Finish signing in on the other tab, or try again.
                </p>
              )}
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
