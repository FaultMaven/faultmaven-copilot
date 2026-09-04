/**
 * The extension's gate: what the user sees before there is a session.
 *
 * These are wiring assertions, and they exist because mutation testing showed
 * the wiring had none. Rendering WelcomeScreen from the entry, and rendering
 * the LOADING screen rather than the sign-in screen while the backend is still
 * being reached, are both behaviours that were preserved by hand across the
 * split — and both survived a mutation that removed them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
} =
  vi.hoisted(() => ({
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
  }));

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
  },
}));
vi.mock('@faultmaven/copilot-ui/lib/capabilities', () => ({ capabilitiesManager: { fetch: capsFetch } }));
vi.mock('../../extension/auth/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({
    provider: 'oidc',
    features: { supports_registration: false, supports_password_reset: false, supports_mfa: false },
  }),
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
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });

    renderApp();
    await screen.findByText(/Sign in with/i);

    await act(async () => {
      messageListeners.forEach((l) =>
        l({ type: 'auth_state_changed', authState: { isAuthenticated: true, user: HOST_USER } }),
      );
    });

    expect(reload).toHaveBeenCalled();
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
    Object.defineProperty(window, 'location', { configurable: true, value: { reload: vi.fn() } });

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
