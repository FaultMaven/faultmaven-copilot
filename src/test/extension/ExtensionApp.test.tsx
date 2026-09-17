/**
 * The extension's gate: what the user sees before there is a session.
 *
 * These are wiring assertions, and they exist because mutation testing showed
 * the wiring had none. Rendering WelcomeScreen from the entry, and rendering
 * the LOADING screen rather than the sign-in screen while the backend is still
 * being reached, are both behaviours that were preserved by hand across the
 * split — and both survived a mutation that removed them.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockPM,
  capsFetch,
  authState,
  detectExtensionReload,
  logoutAuth,
  messageListeners,
  capturedSignOut,
  getAuthConfig,
  localSignIn,
  localRegister,
  SSO_CONFIG,
  LOCAL_CONFIG,
} = vi.hoisted(() => {
  // The real `AuthConfig['features']` (auth-config.ts): four fields, and
  // `supports_mfa` is not one of them. The mock is untyped, so tsc cannot say
  // so — and a fixture that invents a field while dropping `requires_redirect`
  // hands any test that reads the one that decides the OIDC/SAML branch an
  // `undefined` it will not notice.
  const FEATURES = {
    supports_registration: false,
    supports_password_reset: false,
    supports_email_verification: false,
    requires_redirect: true, // true for OIDC/SAML
  };
  const SSO_CONFIG = { provider: 'oidc', features: FEATURES };
  const LOCAL_CONFIG = {
    provider: 'local',
    features: { ...FEATURES, requires_redirect: false },
  };

  return {
    SSO_CONFIG,
    LOCAL_CONFIG,
    mockPM: {
      isRecoveryInProgress: vi.fn().mockResolvedValue(false),
      recoverConversationsFromBackend: vi.fn(),
      markSyncComplete: vi.fn().mockResolvedValue(undefined),
      clearAllPersistenceData: vi.fn().mockResolvedValue(undefined),
    },
    capsFetch: vi.fn(),
    authState: { isAuthenticated: false },
    detectExtensionReload: vi.fn().mockResolvedValue(false),
    logoutAuth: vi.fn(),
    messageListeners: [] as ((msg: any) => void)[],
    capturedSignOut: { current: (_fn: (() => Promise<void>) | null) => {} },
    // Self-defaulting: `vi.clearAllMocks()` clears calls, not implementations,
    // so a describe that never stages a config still gets one. A bare `vi.fn()`
    // resolves undefined, which AuthScreen renders as its full-screen
    // "Authentication Error" — a failure with no visible cause in the test
    // that hits it.
    getAuthConfig: vi.fn().mockResolvedValue(SSO_CONFIG),
    localSignIn: vi.fn(),
    localRegister: vi.fn(),
  };
});

vi.mock('@faultmaven/copilot-ui/lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));
vi.mock('../../extension/extension-reload', () => ({
  detectExtensionReload,
  clearReloadFlag: vi.fn().mockResolvedValue(undefined),
  stampRuntimeIdentity: vi.fn().mockResolvedValue(undefined),
  markReloadDetected: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../extension/auth/auth-service', () => ({ logoutAuth }));

// WHO is signed in is the extension's own question now — it asks its credential
// stack directly rather than reading an answer the shared store produced.
const HOST_USER = {
  user_id: 'u1',
  username: 'op',
  email: 'op@example.invalid',
  display_name: 'Op',
  roles: ['user'],
};
vi.mock('../../extension/auth/auth-manager', () => ({
  authManager: {
    isAuthenticated: vi.fn(async () => authState.isAuthenticated),
    getCurrentUser: vi.fn(async () => (authState.isAuthenticated ? HOST_USER : null)),
    clearAllAuthData: vi.fn().mockResolvedValue(undefined),
    // Startup's single pass: reconcileSession returns the state it validated and
    // userFromAuthState maps it, so both must answer from the same fixture the
    // other methods do — stubbing them independently is how the panel came to
    // render signed-out against a signed-in fixture.
    reconcileSession: vi.fn(async () => (authState.isAuthenticated ? { user: HOST_USER } : null)),
    userFromAuthState: vi.fn((state: any) => (state ? HOST_USER : null)),
  },
}));
vi.mock('@faultmaven/copilot-ui/lib/capabilities', () => ({ capabilitiesManager: { fetch: capsFetch } }));
vi.mock('../../extension/auth/auth-config', () => ({ getAuthConfig }));
// Only the sign-in screen's local branch reaches this; every other test in the
// file renders the SSO branch, which never constructs one.
vi.mock('../../extension/auth/local-auth-client', () => ({
  LocalAuthClient: class {
    signIn = localSignIn;
    // Stubbed although no test registers today: `LocalLoginForm` calls it
    // whenever `supports_registration` is set, and a missing method there
    // surfaces through the form's own catch as a generic error — which reads
    // as a product bug rather than a missing stub.
    register = localRegister;
  },
}));
// A probe, not the panel. What this file tests is what the ENTRY builds and
// hands over; rendering the real panel would pull every hook it owns into a
// test about the gate above it.
vi.mock('@faultmaven/copilot-ui/shared/ui/CopilotPanel', () => ({
  default: ({ host }: any) => {
    capturedSignOut.current(host.session.signOut);
    return <div data-testid="panel-probe" />;
  },
}));
import { ExtensionApp } from '../../extension/ExtensionApp';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import {
  clearSessionEnding,
  isSessionEnding,
} from '@faultmaven/copilot-ui/lib/state/session-epoch';

const b = (global as any).browser;

/**
 * Render the entry with a session, and hand back the `signOut` it put on the
 * host. The panel is stubbed to a probe that publishes it: what the entry
 * BUILDS is the subject, and mounting the real panel would pull in every hook
 * it owns for a test about one function.
 */
async function captureHostSignOut(): Promise<() => Promise<void>> {
  let signOut: (() => Promise<void>) | null = null;
  capturedSignOut.current = (fn) => {
    signOut = fn;
  };
  renderApp();
  await screen.findByTestId('panel-probe');
  if (!signOut) throw new Error('the entry mounted the panel without a session signOut');
  return signOut;
}

/**
 * Stub `window.location` for one test, keeping what `src/test/setup.ts` put
 * there.
 *
 * setup.ts installs `{ href }` and nothing else. Replacing the object wholesale
 * with `{ reload }` therefore takes `href` away from every test that runs after
 * it in this file, and the test that trips over it fails for a reason nothing
 * in its own body shows. Spread what is there, and restore on teardown.
 */
const ORIGINAL_LOCATION = window.location;
const withStubbedLocation = (extra: Record<string, unknown>) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, ...extra },
  });
};
afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

const renderApp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExtensionApp />
    </QueryClientProvider>,
  );
};

describe('ExtensionApp — the gate above the shared panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = false;
    getAuthConfig.mockResolvedValue(SSO_CONFIG);
    // AuthScreen subscribes to runtime messages and unsubscribes on unmount;
    // the shared global mock has no removeListener.
    messageListeners.length = 0;
    b.runtime = {
      ...(b.runtime ?? {}),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn((l: (msg: any) => void) => messageListeners.push(l)),
        removeListener: vi.fn(),
      },
    };
    useAppStore.setState({ currentUser: null });
    useAppStore.setState({
      hasCompletedFirstRun: null,
      initializingCapabilities: true,
      capabilitiesError: null,
      capabilities: null,
    });
  });

  it('renders the first-run screen when setup has not been completed', async () => {
    // No stored flag: initializeApp reads first-run as false.
    b.storage.local.get.mockResolvedValue({});

    renderApp();

    expect(await screen.findByLabelText('Welcome Setup')).toBeInTheDocument();
    // Not the sign-in screen, and not the panel.
    expect(screen.queryByText(/Sign in with/i)).toBeNull();
  });

  it('renders the sign-in screen once setup is done and the backend has answered', async () => {
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });

    renderApp();

    expect(await screen.findByText(/Sign in with/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Welcome Setup')).toBeNull();
  });

  // The ordering, which is the whole reason capabilities are checked first: a
  // signed-out user during startup must see the loading screen, not a sign-in
  // form that will be replaced a moment later.
  it('shows loading, NOT sign-in, while the backend is still being reached', async () => {
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockImplementation(() => new Promise(() => {})); // never settles

    renderApp();

    expect(await screen.findByText(/Connecting to FaultMaven/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sign in with/i)).toBeNull();
  });


  /**
   * The panel does not mount until recovery has settled.
   *
   * This is the ORDER the one shared effect used to keep by construction:
   * recovery writes host storage and the panel's hydration reads it, so a panel
   * mounted alongside recovery hydrates the pre-recovery state and shows an
   * empty transcript with the user's cases sitting in storage. The gate is what
   * replaces that, and it shows the same screen the panel used to show.
   */
  it('shows "Recovering session…" instead of the panel while recovery runs', async () => {
    authState.isAuthenticated = true;
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    detectExtensionReload.mockResolvedValue(true);
    mockPM.recoverConversationsFromBackend.mockImplementation(() => new Promise(() => {}));

    renderApp();

    expect(await screen.findByText(/Recovering session/i)).toBeInTheDocument();
    expect(screen.queryByTestId('panel-probe')).toBeNull();
  });

  it('mounts the panel once recovery has settled', async () => {
    authState.isAuthenticated = true;
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    detectExtensionReload.mockResolvedValue(true);
    mockPM.recoverConversationsFromBackend.mockResolvedValue({
      success: true, recoveredCases: 2, recoveredConversations: 0, errors: [], strategy: 'metadata_only_recovery',
    });

    renderApp();

    expect(await screen.findByTestId('panel-probe')).toBeInTheDocument();
  });

  /**
   * A sign-in that completed in ANOTHER context, while this panel shows nothing
   * but the loading screen.
   *
   * The shared store used to hold this listener, which is how a tree that owns
   * no credential came to subscribe to runtime messaging. The window it covers
   * is real: the sign-in screen has a listener too, but it is not mounted during
   * startup, so without this the panel would sit signed-out until the user
   * clicked something.
   */
  it('reloads when a sign-in completes elsewhere while nobody is signed in here', async () => {
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    const reload = vi.fn();
    withStubbedLocation({ reload });

    renderApp();
    await screen.findByText(/Sign in with/i);

    await act(async () => {
      messageListeners.forEach((l) =>
        l({ type: 'auth_state_changed', authState: { isAuthenticated: true, user: HOST_USER } }),
      );
    });

    expect(reload).toHaveBeenCalled();
  });

  /**
   * ...and that listener earns its place in the window where the sign-in screen
   * is NOT mounted.
   *
   * The test above broadcasts with the sign-in screen up, where AuthScreen has a
   * listener of its own — so both fire and the reload cannot be attributed.
   * Delete the entry's listener and it stays green. This one holds capabilities
   * unsettled, so the panel is on the loading screen with no AuthScreen in the
   * tree, which is exactly the startup window the entry's listener exists for.
   */
  it('reloads from the loading screen, where the sign-in screen is not mounted', async () => {
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockImplementation(() => new Promise(() => {})); // never settles
    const reload = vi.fn();
    withStubbedLocation({ reload });

    renderApp();
    await screen.findByText(/Connecting to FaultMaven/i);
    expect(screen.queryByText(/Sign in with/i)).toBeNull();

    await act(async () => {
      messageListeners.forEach((l) =>
        l({ type: 'auth_state_changed', authState: { isAuthenticated: true, user: HOST_USER } }),
      );
    });

    expect(reload).toHaveBeenCalled();
  });

  /**
   * The sign-in reload happens INSIDE the turn that reported the sign-in, and
   * leaves nothing scheduled behind it.
   *
   * `handleAuthSuccess` used to `await` a 100ms sleep before touching the DOM,
   * and nothing awaits `handleAuthSuccess` — so the reload landed after its
   * caller was gone. In CI that meant after Vitest had disposed the jsdom
   * environment: every test file passed and the run failed on an unhandled
   * `ReferenceError: window is not defined` from that line (#277). In the
   * browser it is the same shape, reloading a document already being replaced.
   *
   * The local sign-in form is the path that isolates it. It broadcasts nothing,
   * so `applyHostAuthState` — the OTHER reload in this tree, which fires on the
   * SSO/bridge broadcast and is what the test above asserts — is not in play,
   * and the only reload that can happen here is this one.
   *
   * Both halves matter. Asserting the reload with NO timer advanced is what
   * fails if a wait comes back; asserting the count is unchanged after unmount
   * is what fails if the reload merely moves behind some other continuation.
   */
  it('reloads within the sign-in turn, scheduling nothing past it', async () => {
    getAuthConfig.mockResolvedValue(LOCAL_CONFIG);
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    localSignIn.mockResolvedValue({ success: true, user: HOST_USER });
    // The flag AT THE MOMENT OF THE RELOAD, not afterwards: #164 is an ordering
    // claim, and reading it after the fact passes just as happily when
    // `markSessionEnding()` has been moved BELOW the reload it must precede.
    const endingWhenReloaded: boolean[] = [];
    const reload = vi.fn(() => endingWhenReloaded.push(isSessionEnding()));
    withStubbedLocation({ reload });

    const view = renderApp();

    fireEvent.change(await screen.findByLabelText(/Username/i), { target: { value: 'op' } });
    // Cleared HERE, not at the top of the test: startup resolves nobody signed
    // in, and `setSignedInUser(null)` runs the slice's own teardown, which
    // marks it. Clearing before the render leaves the flag already true by the
    // time the sign-in reloads, and the probe below asserts nothing.
    clearSessionEnding();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    });

    // Microtasks only — no timer has been given a chance to fire, so this fails
    // for a reintroduced wait of ANY length, not just one shorter than the
    // sleep below.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(endingWhenReloaded).toEqual([true]);

    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  /**
   * A reload that fails is not a sign-in that failed.
   *
   * `LocalLoginForm.handleLogin` calls `onAuthSuccess()` INSIDE its own `try`,
   * whose catch runs `setError(err.message)`. Now that the handler is
   * synchronous, a throw from the reload would reach that catch and tell the
   * user their login failed — over a session that is live, with the credential
   * written and the prior user's data already purged.
   *
   * The seam is narrow (reloading a same-origin extension page does not throw)
   * but it is reachable from a test harness: `src/test/setup.ts` installs a
   * `location` with no `reload` at all.
   */
  it('does not report a successful sign-in as failed when the reload throws', async () => {
    getAuthConfig.mockResolvedValue(LOCAL_CONFIG);
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    localSignIn.mockResolvedValue({ success: true, user: HOST_USER });
    const reload = vi.fn(() => {
      throw new TypeError('location.reload is not a function');
    });
    withStubbedLocation({ reload });

    renderApp();

    fireEvent.change(await screen.findByLabelText(/Username/i), { target: { value: 'op' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is not a function/i)).toBeNull();
  });

  /**
   * ...and it takes the teardown mark back.
   *
   * `markSessionEnding()` is a promise that this document is going away, and it
   * gates the WHOLE debounced persist (`store.ts`), not just the beforeunload
   * flush. The only two places that clear it are store writes the local sign-in
   * path never performs — it broadcasts nothing, so the reload is the entire
   * hand-off. Left set by a reload that did not happen, the panel stays up with
   * nothing written to storage for the life of the document.
   */
  it('does not leave the session fenced when the reload throws', async () => {
    getAuthConfig.mockResolvedValue(LOCAL_CONFIG);
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    localSignIn.mockResolvedValue({ success: true, user: HOST_USER });
    withStubbedLocation({
      reload: vi.fn(() => {
        throw new TypeError('location.reload is not a function');
      }),
    });

    renderApp();

    fireEvent.change(await screen.findByLabelText(/Username/i), { target: { value: 'op' } });
    clearSessionEnding();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    });

    expect(isSessionEnding()).toBe(false);
  });
});

/**
 * Sign-out, which is the host's because the credential is.
 *
 * `auth-slice` used to own this: it called `logoutAuth` from the shared barrel
 * and broadcast the result itself. Both are here now, and the behaviour the
 * shared slice was carrying — #143, that a failed POST must still complete the
 * LOCAL sign-out rather than leave the app half-signed-out — has to survive the
 * move, so it is asserted on the host's `signOut` instead.
 */
describe('the extension session signs out', () => {
  let hostSignOut: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    getAuthConfig.mockResolvedValue(SSO_CONFIG);
    authState.isAuthenticated = true;
    messageListeners.length = 0;
    b.runtime = {
      ...(b.runtime ?? {}),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn((l: (msg: any) => void) => messageListeners.push(l)),
        removeListener: vi.fn(),
      },
    };
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    useAppStore.setState({ currentUser: null });
    withStubbedLocation({ reload: vi.fn() });

    // Reach the session the entry hands the panel, without rendering the panel:
    // CopilotPanel is not what is under test here, and mounting it drags every
    // hook it owns into a test about one function.
    hostSignOut = await captureHostSignOut();
  });

  it('completes the local sign-out and does NOT reject when the backend POST fails', async () => {
    logoutAuth.mockRejectedValue(new Error('Server error 500'));

    await expect(hostSignOut()).resolves.toBeUndefined();

    expect(useAppStore.getState().currentUser).toBeNull();
  });

  it('clears the identity on a successful sign-out', async () => {
    logoutAuth.mockResolvedValue({ allSessionsEnded: true });

    await hostSignOut();

    expect(logoutAuth).toHaveBeenCalled();
    expect(useAppStore.getState().currentUser).toBeNull();
  });

  // The notice exists because signing out here cannot end the Dashboard's own
  // token chain. Saying nothing would report a reach this client never verified.
  it('warns about other sessions when the server did not confirm they ended', async () => {
    logoutAuth.mockResolvedValue({ allSessionsEnded: false });
    authState.isAuthenticated = false;

    await act(async () => {
      await hostSignOut();
    });

    expect(await screen.findByText(/could not confirm your other FaultMaven sessions/i))
      .toBeInTheDocument();
  });

  it('says nothing when the server confirmed every session ended', async () => {
    logoutAuth.mockResolvedValue({ allSessionsEnded: true });
    authState.isAuthenticated = false;

    await act(async () => {
      await hostSignOut();
    });

    await screen.findByText(/Sign in with/i);
    expect(screen.queryByText(/could not confirm your other FaultMaven sessions/i)).toBeNull();
  });
});
