/**
 * The entry must not unmount the panel that bootstrapped.
 *
 * `CopilotPanel` calls `initializeApp` on mount, and it has to: a host that
 * embeds it has no entry above it to do that, and the Dashboard is such a host.
 * `loadCapabilities` raises `initializingCapabilities` while it runs. So an
 * entry that renders a loading screen whenever that flag is true swaps the
 * panel out for it, and the remount bootstraps again:
 *
 *   mount → initializeApp → flag true → the entry swaps in the loading screen
 *   → unmount → capabilities settle → flag false → remount → initializeApp → …
 *
 * That shipped in #240 and took the side-panel document down with it: the panel
 * remounted for as long as the renderer survived, refetching capabilities every
 * cycle, and Extension E2E was red on main for two days.
 *
 * The entry's own suite mocks `CopilotPanel` with an inert probe, so it could
 * never see this — 707 unit tests stayed green. The probe here does the one
 * thing the real panel does that matters: it bootstraps on mount, and it counts
 * how many times it was mounted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockPM, capsFetch, mounts } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
    markSyncComplete: vi.fn().mockResolvedValue(undefined),
    clearAllPersistenceData: vi.fn().mockResolvedValue(undefined),
  },
  capsFetch: vi.fn(),
  mounts: { count: 0 },
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));
vi.mock('../../extension/extension-reload', () => ({
  detectExtensionReload: vi.fn().mockResolvedValue(false),
  clearReloadFlag: vi.fn().mockResolvedValue(undefined),
  stampRuntimeIdentity: vi.fn().mockResolvedValue(undefined),
  markReloadDetected: vi.fn().mockResolvedValue(undefined),
}));
const SIGNED_IN_USER = {
  user_id: 'u1', username: 'op', email: 'op@example.invalid', roles: ['user'],
};
vi.mock('../../extension/auth/auth-service', () => ({ logoutAuth: vi.fn() }));
vi.mock('../../extension/auth/auth-manager', () => ({
  authManager: {
    isAuthenticated: vi.fn(async () => true),
    getCurrentUser: vi.fn(async () => SIGNED_IN_USER),
    clearAllAuthData: vi.fn().mockResolvedValue(undefined),
    // Startup's single pass: reconcileSession returns the state it validated and
    // userFromAuthState maps it. Both answer from the same fixture the other
    // methods do — stubbing them independently is how the panel would render
    // signed-out against a signed-in fixture.
    reconcileSession: vi.fn(async () => ({ user: SIGNED_IN_USER })),
    userFromAuthState: vi.fn((state: any) => (state ? SIGNED_IN_USER : null)),
  },
}));
vi.mock('@faultmaven/copilot-ui/lib/capabilities', () => ({ capabilitiesManager: { fetch: capsFetch } }));
vi.mock('../../extension/auth/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({
    provider: 'oidc',
    features: { supports_registration: false, supports_password_reset: false, supports_mfa: false },
  }),
}));

// How many mounts the probe will bootstrap on before it gives up.
//
// It exists so the pre-fix behaviour FAILS this test rather than hanging it.
// The cycle is a microtask storm — a storage read and an already-resolved
// capabilities promise per turn — which starves the event loop, so neither
// vitest's per-test timeout nor a `setTimeout` in the test body ever fires. On
// the unfixed entry this test ran until the CI job's own timeout killed it.
// Capping the probe lets the loop stop, the wait below resolve, and the
// assertion report what actually happened.
const MOUNT_CAP = 5;

// The panel, reduced to the single behaviour this is about: it bootstraps on
// mount, exactly as the real one does, and records each mount.
vi.mock('@faultmaven/copilot-ui/shared/ui/CopilotPanel', () => ({
  default: () => {
    const initializeApp = useAppStore((s) => s.initializeApp);
    React.useEffect(() => {
      mounts.count += 1;
      if (mounts.count > MOUNT_CAP) return;
      initializeApp({ skipOnboardingGate: false });
    }, [initializeApp]);
    return <div data-testid="panel-probe" />;
  },
}));

import { ExtensionApp } from '../../extension/ExtensionApp';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';

const b = (global as any).browser;

const renderApp = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExtensionApp />
    </QueryClientProvider>,
  );
};

describe('the entry does not remount the panel that bootstrapped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mounts.count = 0;
    b.runtime = {
      ...(b.runtime ?? {}),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    useAppStore.setState({
      currentUser: null,
      hasCompletedFirstRun: null,
      initializingCapabilities: true,
      capabilitiesError: null,
      capabilities: null,
    });
  });

  it('mounts it exactly once, though the panel bootstraps on mount', async () => {
    renderApp();
    await screen.findByTestId('panel-probe');

    // Long enough for a cycle to have turned over several times: each one is a
    // storage read and a capabilities fetch, all already-resolved promises.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      mounts.count,
      'the panel was mounted more than once — the entry gated on ' +
        '`initializingCapabilities` while the panel was raising it, so it ' +
        'unmounted the component that made the call and the remount made it ' +
        'again (#251)',
    ).toBe(1);
    expect(screen.getByTestId('panel-probe')).toBeInTheDocument();
  });

  it('still shows loading rather than the panel while STARTUP is reaching the backend', async () => {
    // The gate has to keep doing its startup job: it stands down only once the
    // first bootstrap has settled, not from the first render.
    capsFetch.mockImplementation(() => new Promise(() => {}));

    renderApp();

    expect(await screen.findByText(/Connecting to FaultMaven/i)).toBeInTheDocument();
    expect(screen.queryByTestId('panel-probe')).toBeNull();
    expect(mounts.count).toBe(0);
  });

  /**
   * A degraded capabilities result must not become permanent. CapabilitiesManager
   * serves a fabricated fallback when the fetch fails and records that it did,
   * so the NEXT call re-detects a recovered backend — which is why the fix is a
   * one-way gate rather than a once-per-page-load guard on `initializeApp`.
   */
  it('lets a later bootstrap re-run after startup has settled', async () => {
    renderApp();
    await screen.findByTestId('panel-probe');
    await waitFor(() => expect(capsFetch).toHaveBeenCalled());
    const afterStartup = capsFetch.mock.calls.length;

    await useAppStore.getState().initializeApp({ skipOnboardingGate: true });

    expect(
      capsFetch.mock.calls.length,
      'a later initializeApp was swallowed — a degraded (fallback) result ' +
        'would then stick for the whole page load',
    ).toBeGreaterThan(afterStartup);
    expect(mounts.count).toBe(1);
  });
});
