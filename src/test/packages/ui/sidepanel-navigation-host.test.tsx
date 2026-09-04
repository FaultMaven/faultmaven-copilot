/**
 * SidePanelApp's two navigation call sites, asserted through the rendered UI.
 *
 * The settings affordance is the interesting one: with no settings surface the
 * button must not be drawn. `ErrorScreen` already omits an absent action, so
 * what is being tested is that SidePanelApp passes no action rather than one
 * that would do nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createStubHost } from '../../support/host';

const { mockPM, capsFetch, authState } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    detectExtensionReload: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
    markSyncComplete: vi.fn().mockResolvedValue(undefined),
    clearAllPersistenceData: vi.fn().mockResolvedValue(undefined),
  },
  capsFetch: vi.fn(),
  authState: { isAuthenticated: false },
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));
vi.mock('@faultmaven/copilot-ui/lib/capabilities', () => ({
  capabilitiesManager: { fetch: capsFetch },
}));
vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';

const b = (global as any).browser;

// CopilotPanel publishes the host itself, so the wrapper supplies only the
// query client.
const withQueryClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

describe('SidePanelApp — settings affordance follows the host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // First run is done, and the backend is unreachable — the branch that
    // offers "Open Settings".
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockRejectedValue(new Error('backend down'));
    useAppStore.setState({ capabilities: null, capabilitiesError: null, initializingCapabilities: true });
  });

  it('offers "Open Settings" when the host has a settings surface, and it calls the host', async () => {
    const stub = createStubHost();
    render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });

    const button = await screen.findByText('Open Settings');
    fireEvent.click(button);
    expect(stub.settings).toHaveBeenCalledTimes(1);
  });

  it('offers NO settings button when the host has no settings surface', async () => {
    const stub = createStubHost({}, { settings: false });
    render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });

    // The error screen itself still renders — this is an omitted affordance,
    // not an unrendered branch.
    await screen.findByText('Connection Error');
    expect(screen.queryByText('Open Settings')).toBeNull();
  });
});

describe('SidePanelApp — Open Dashboard goes through the host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    b.storage.local.get.mockResolvedValue({ hasCompletedFirstRun: true });
    capsFetch.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    useAppStore.setState({
      capabilities: null,
      capabilitiesError: null,
      initializingCapabilities: true,
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: false,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      pinnedCases: new Set(),
    });
  });

  const clickOpenDashboard = async (stub: ReturnType<typeof createStubHost>) => {
    render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });
    const button = await screen.findByTitle('Open Dashboard');
    fireEvent.click(button);
  };

  it('asks the host for /cases when no case is open', async () => {
    const stub = createStubHost();
    await clickOpenDashboard(stub);

    // A PATH, not a URL: resolving where the Dashboard lives is the host's job.
    await waitFor(() => expect(stub.dashboard).toHaveBeenCalledWith('/cases'));
  });

  it('asks the host for the open case', async () => {
    useAppStore.setState({ activeCaseId: 'case-123' });
    const stub = createStubHost();
    await clickOpenDashboard(stub);

    await waitFor(() => expect(stub.dashboard).toHaveBeenCalledWith('/cases/case-123'));
  });
});
