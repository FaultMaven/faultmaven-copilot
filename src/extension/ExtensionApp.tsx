/**
 * The extension host's entry into the Copilot UI.
 *
 * Everything above the shared panel lives here, because everything above the
 * shared panel is host-specific: the first-run endpoint choice, the OAuth and
 * local sign-in screens, and the decision that somebody is now signed in.
 *
 * The gate is the point of the file. `CopilotPanel` takes a host whose session
 * is non-nullable, so it cannot be mounted until one exists — which means the
 * shared UI has no sign-in screen to render and no `isAuthenticated` branch to
 * get wrong. The screens below are the extension's answer to "how does a
 * session come to exist"; the Dashboard will have a different one, and neither
 * answer reaches the panel.
 */
import React, { useEffect, useMemo } from 'react';
import { extensionHost } from './host';
import type { HostSession, WiredHost } from '../shared/host';
import CopilotPanel from '../shared/ui/CopilotPanel';
import { ErrorBoundary } from '../shared/ui/components/ErrorBoundary';
import { LoadingScreen } from '../shared/ui/components/LoadingScreen';
import { useAuth } from '../shared/ui/hooks/useAuth';
import { useAppStore } from '../lib/state/store';
import { markSessionEnding } from '../lib/state/session-epoch';
import { tokenManager } from '../lib/auth/token-manager';
import { authManager } from '../lib/auth/auth-manager';
import { installExtensionTransport } from './host';
import { createLogger } from '../lib/utils/logger';
import { AuthScreen } from './components/AuthScreen';
import { WelcomeScreen } from './components/WelcomeScreen';

const log = createLogger('ExtensionApp');

export function ExtensionApp() {
  const hasCompletedFirstRun = useAppStore((state) => state.hasCompletedFirstRun);
  const setHasCompletedFirstRun = useAppStore((state) => state.setHasCompletedFirstRun);
  const initializingCapabilities = useAppStore((state) => state.initializingCapabilities);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const { isAuthenticated, currentUser, logout } = useAuth();

  // Bootstrap moved up with the gate that consumes it: first-run status and
  // backend capabilities are what this component branches on.
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  /**
   * The extension's session, assembled from the identity the auth stack already
   * holds.
   *
   * Memoised on the fields it reads rather than on `currentUser`: the store
   * hands back a fresh object on some updates, and a new host identity would
   * re-run every effect in the panel that depends on the host.
   */
  const session: HostSession | null = useMemo(() => {
    if (!isAuthenticated || !currentUser) return null;
    return {
      user: {
        id: currentUser.user_id,
        username: currentUser.username,
        displayName: currentUser.display_name,
        email: currentUser.email,
        roles: currentUser.roles ?? [],
      },
      // The panel never holds a refresh token; it asks for a bearer and the
      // host answers. TokenManager owns the rotation and its lock.
      //
      // Throws rather than resolving null: a null would put the panel back in
      // the business of deciding what an absent credential means, which is the
      // decision this boundary exists to keep on the host's side.
      accessToken: async () => {
        const token = await tokenManager.getValidAccessToken();
        if (!token) throw new Error('No valid access token; the session has ended.');
        return token;
      },
      // The extension owns sign-out because it owns the credential. The panel
      // still tears down its own state; this is only the credential half.
      signOut: logout,
      // A hard 401. Clearing ALL local auth data — the token keys included — is
      // what stops a stale refresh_token silently re-authenticating, and it is
      // the extension's call to make because the extension owns that chain.
      // Awaited by the client, so the next request cannot read a credential on
      // its way out.
      onUnauthorized: () => authManager.clearAllAuthData(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    currentUser?.user_id,
    currentUser?.username,
    currentUser?.display_name,
    currentUser?.email,
    currentUser?.roles?.join(','),
    logout,
  ]);

  const host: WiredHost | null = useMemo(
    () => (session ? { ...extensionHost, session } : null),
    [session],
  );

  // The API layer is free functions, so the host installs its transport rather
  // than the panel threading it down. Installed before the panel renders, and
  // re-installed when the session changes, so a request can never go out with
  // the previous account's bearer.
  useEffect(() => {
    if (session) installExtensionTransport(session);
  }, [session]);

  const handleAuthSuccess = async () => {
    log.info('Authentication successful, checking auth state');
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Mark teardown BEFORE reloading so the store's beforeunload handler cancels
    // the pending debounced persist instead of flushing a prior user's
    // just-purged residue back to storage (#164). Same discipline as the
    // auth-slice reload path.
    markSessionEnding();
    window.location.reload();
  };

  // Order preserved from the single component this was split out of: first run,
  // then bootstrap, then sign-in. Checking capabilities before authentication is
  // what stops the sign-in screen flashing during startup.
  if (hasCompletedFirstRun === false) {
    return (
      <ErrorBoundary>
        <WelcomeScreen onComplete={() => setHasCompletedFirstRun(true)} />
      </ErrorBoundary>
    );
  }

  if (hasCompletedFirstRun === null || initializingCapabilities) {
    return (
      <ErrorBoundary>
        <LoadingScreen message="Connecting to FaultMaven..." />
      </ErrorBoundary>
    );
  }

  if (!host) {
    return (
      <ErrorBoundary>
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      </ErrorBoundary>
    );
  }

  return <CopilotPanel host={host} />;
}

export default ExtensionApp;
