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
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockPM, capsFetch, authState } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    detectExtensionReload: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
    markSyncComplete: vi.fn().mockResolvedValue(undefined),
  },
  capsFetch: vi.fn(),
  authState: { isAuthenticated: false },
}));

vi.mock('../../lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));
vi.mock('../../lib/capabilities', () => ({ capabilitiesManager: { fetch: capsFetch } }));
vi.mock('../../lib/auth/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({
    provider: 'oidc',
    features: { supports_registration: false, supports_password_reset: false, supports_mfa: false },
  }),
}));
vi.mock('../../shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));
vi.mock('../../shared/ui/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    currentUser: authState.isAuthenticated
      ? {
          user_id: 'u1',
          username: 'op',
          email: 'op@example.invalid',
          display_name: 'Op',
          is_dev_user: false,
          is_active: true,
          roles: ['user'],
        }
      : null,
    logout: vi.fn(),
  }),
}));

import { ExtensionApp } from '../../extension/ExtensionApp';
import { useAppStore } from '../../lib/state/store';

const b = (global as any).browser;

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
    b.runtime = { ...(b.runtime ?? {}), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } };
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

});
