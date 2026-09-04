/**
 * The extension host's entry into the Copilot UI.
 *
 * Everything above the shared panel lives here, because everything above the
 * shared panel is host-specific: the first-run endpoint choice, the OAuth and
 * local sign-in screens, and the decision that somebody is now signed in.
 *
 * The gate is the point of the file. `CopilotPanel` takes a host whose session
 * is non-nullable, so it cannot be mounted until one exists — which means the
 * shared UI has no sign-in screen to render and no authenticated/not branch to
 * get wrong. The screens below are the extension's answer to "how does a
 * session come to exist"; the Dashboard will have a different one, and neither
 * answer reaches the panel.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { extensionHost } from './host';
import type { HostSession, HostUser, WiredHost } from '@faultmaven/copilot-ui/shared/host';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { ErrorBoundary } from '@faultmaven/copilot-ui/shared/ui/components/ErrorBoundary';
import { LoadingScreen } from '@faultmaven/copilot-ui/shared/ui/components/LoadingScreen';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { markSessionEnding } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { tokenManager } from './auth/token-manager';
import { authManager } from './auth/auth-manager';
import { logoutAuth } from './auth/auth-service';
import { installExtensionTransport } from './host';
import { EventBus, type AuthStateChangedEvent } from './messaging';
import { subscribeExtensionAuthState } from './host/auth-state';
import { useExtensionReloadRecovery } from './useExtensionReloadRecovery';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';
import { AuthScreen } from './components/AuthScreen';
import { WelcomeScreen } from './components/WelcomeScreen';

const log = createLogger('ExtensionApp');

/**
 * The identity the extension's credential carries, in the host's own shape.
 *
 * `HostUser` is what `HostSession` publishes and what the shared store holds,
 * so the mapping happens once, here, rather than the panel holding a second
 * copy of the same person under a second set of field names.
 */
function toHostUser(user: {
  user_id: string;
  username: string;
  display_name?: string;
  email?: string;
  roles?: string[];
  organization_id?: string;
} | null | undefined): HostUser | null {
  if (!user?.user_id) return null;
  return {
    id: user.user_id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    roles: user.roles ?? [],
    organizationId: user.organization_id,
  };
}

export function ExtensionApp() {
  const hasCompletedFirstRun = useAppStore((state) => state.hasCompletedFirstRun);
  const setHasCompletedFirstRun = useAppStore((state) => state.setHasCompletedFirstRun);
  const initializingCapabilities = useAppStore((state) => state.initializingCapabilities);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const currentUser = useAppStore((state) => state.currentUser);
  const setSignedInUser = useAppStore((state) => state.setSignedInUser);
  const applyHostAuthState = useAppStore((state) => state.applyHostAuthState);

  // Set when a deliberate sign-out could not be confirmed to have ended every
  // session for the account. Not an error — the local sign-out succeeded — but
  // the Dashboard runs on its own token chain and may still be signed in, so
  // saying nothing would report a reach this client never verified. It lives
  // here rather than in the shared store because the screen that renders it,
  // and the sign-out that produces it, are both the extension's.
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  // Bootstrap moved up with the gate that consumes it: first-run status and
  // backend capabilities are what this component branches on.
  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // WHO IS SIGNED IN is the host's question, because the host owns the
  // credential. Asked once at startup; `setSignedInUser` rather than
  // `applyHostAuthState` because there is no prior identity here for this to be
  // a change FROM, and treating startup as an identity switch would reload the
  // panel on every launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authenticated = await authManager.isAuthenticated();
        const user = authenticated ? await authManager.getCurrentUser() : null;
        if (!cancelled) setSignedInUser(toHostUser(user));
      } catch (error) {
        log.error('Auth check failed', error);
        if (!cancelled) setSignedInUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSignedInUser]);

  // A sign-in completed in ANOTHER context — the background's OAuth callback or
  // the dashboard bridge — while nobody is signed in here.
  //
  // Only while signed out: once the panel is mounted it subscribes through
  // `session.subscribeAuthState` and would otherwise see every change twice.
  // The sign-in screen has a listener of its own, but it is not mounted during
  // startup, which is the window this covers.
  useEffect(() => {
    if (currentUser) return;
    return EventBus.on<AuthStateChangedEvent>('auth_state_changed', (event) => {
      applyHostAuthState(event.authState?.isAuthenticated ? toHostUser(event.authState.user) : null);
    });
  }, [currentUser, applyHostAuthState]);

  /**
   * The extension's session, assembled from the identity above.
   *
   * Memoised on the fields it reads rather than on the object: the store hands
   * back a fresh object on some updates, and a new host identity would re-run
   * every effect in the panel that depends on the host.
   */
  const session: HostSession | null = useMemo(() => {
    if (!currentUser) return null;
    return {
      user: currentUser,
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
      // tears down its own state and asks for this; nothing about the token
      // chain, its storage key or its revocation reaches the panel.
      //
      // logoutAuth() ALWAYS destroys the local credential in its finally, so a
      // failed POST (offline, a 401) only means the best-effort server-side
      // revocation did not land. It also broadcasts, which is what tells the
      // OTHER contexts; this one is told by the call returning.
      signOut: async () => {
        let allSessionsEnded = false;
        try {
          ({ allSessionsEnded } = await logoutAuth());
          log.info('Logout successful', { allSessionsEnded });
        } catch (error) {
          log.warn('Backend logout failed; completing local sign-out anyway', error);
        } finally {
          // Pessimistic: a throw, or an unconfirmed outcome, leaves the notice
          // set. The local sign-out succeeded either way; what is unknown is
          // whether it reached the user's other client.
          setSignOutNotice(
            allSessionsEnded
              ? null
              : 'Signed out here. We could not confirm your other FaultMaven sessions ended — if you were signed in to the Dashboard, sign out there too.',
          );
          applyHostAuthState(null);
        }
      },
      // A hard 401. Clearing ALL local auth data — the token keys included — is
      // what stops a stale refresh_token silently re-authenticating, and it is
      // the extension's call to make because the extension owns that chain.
      // Awaited by the client, so the next request cannot read a credential on
      // its way out.
      onUnauthorized: () => authManager.clearAllAuthData(),
      // Runtime messaging and the credential key disappearing — both the
      // extension's own transports, both meaning the same thing, and neither
      // named on the other side of the boundary. What crosses is the fact: who
      // is signed in now, or nobody.
      subscribeAuthState: (onChange) => subscribeExtensionAuthState(toHostUser, onChange),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentUser?.id,
    currentUser?.username,
    currentUser?.displayName,
    currentUser?.email,
    currentUser?.roles?.join(','),
    applyHostAuthState,
  ]);

  const host: WiredHost | null = useMemo(
    () => (session ? { ...extensionHost, session } : null),
    [session],
  );

  // The API layer is free functions, so the host installs its transport rather
  // than the panel threading it down. Installed before the panel renders, and
  // re-installed when the session changes, so a request can never go out with
  // the previous account's bearer.
  //
  // The store and endpoints are NOT installed here: they are properties of the
  // context, not of the session, and the entry point installs them before React
  // mounts — the app-state bootstrap above reads the store in the very first
  // effect, which an installing effect would be racing.
  useEffect(() => {
    if (session) installExtensionTransport(session);
  }, [session]);

  // Recovering conversations after an extension reload is the extension's
  // question — a web page has no reload to detect and no `runtime.id` to detect
  // it with. It runs BEFORE the panel mounts, which is the order the shared hook
  // used to run it in when it did both jobs: recovery writes storage, hydration
  // reads it, and racing them would hydrate the pre-recovery state.
  const isRecovering = useExtensionReloadRecovery(Boolean(session));

  const handleAuthSuccess = useCallback(async () => {
    log.info('Authentication successful, checking auth state');
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Mark teardown BEFORE reloading so the store's beforeunload handler cancels
    // the pending debounced persist instead of flushing a prior user's
    // just-purged residue back to storage (#164). Same discipline as the
    // reload path in the auth slice.
    markSessionEnding();
    window.location.reload();
  }, []);

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
        <AuthScreen
          onAuthSuccess={handleAuthSuccess}
          signOutNotice={signOutNotice}
          onDismissSignOutNotice={() => setSignOutNotice(null)}
        />
      </ErrorBoundary>
    );
  }

  if (isRecovering) {
    return (
      <ErrorBoundary>
        <LoadingScreen message="Recovering session..." />
      </ErrorBoundary>
    );
  }

  return <CopilotPanel host={host} />;
}

export default ExtensionApp;
