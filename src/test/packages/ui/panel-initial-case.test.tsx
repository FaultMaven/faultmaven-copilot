/**
 * What the panel opens on, when the host says.
 *
 * A host knows why it mounted the panel. Before `initialCase` the only way to
 * say so was to write the store's storage keys behind the panel's back and hope
 * the hydrate picked them up — which is what the Dashboard's case-detail mount
 * was doing, and which couples a host to a key name, an encoding and a race.
 *
 * Three cases, and the third is the one that keeps the other two honest: with
 * nothing passed, the panel must behave exactly as it did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

const handleCaseSelect = vi.fn();

const withQueryClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

describe('CopilotPanel initialCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      // The panel gates on this; the host answers it before mounting.
      initializingCapabilities: false,
      capabilitiesError: null,
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: false,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      handleCaseSelect,
    } as never);
  });

  afterEach(() => {
    useAppStore.setState({ hasUnsavedNewChat: false, activeCaseId: null } as never);
  });

  const renderPanel = (
    initialCase?: Parameters<typeof CopilotPanel>[0]['initialCase'],
    seed: Record<string, unknown> = {},
  ) => {
    const stub = createStubHost(seed);
    return {
      stub,
      ...render(<CopilotPanel host={stub.host} initialCase={initialCase} />, {
        wrapper: withQueryClient(),
      }),
    };
  };

  // ADR-016 D6: "lands on the panel with a new investigation open" — not one
  // click short of it, which is what the empty state is.
  it("{ kind: 'new' } opens the composer, NOT the start-a-new-case screen", async () => {
    renderPanel({ kind: 'new' });

    // Asserted through the RENDERED UI, not the store flag it sets: the flag is
    // the mechanism, and the requirement is what the user is looking at — a
    // composer they can type into, not a screen with a button on it.
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
    expect(screen.queryByText('Start a new case')).toBeNull();
    expect(useAppStore.getState().activeCaseId).toBeNull();
  });

  it("{ kind: 'existing' } opens that case, without the host touching storage", async () => {
    const { stub } = renderPanel({ kind: 'existing', caseId: 'case-42' });

    await waitFor(() => expect(handleCaseSelect).toHaveBeenCalledWith('case-42'));
    expect(handleCaseSelect).toHaveBeenCalledTimes(1);
    // The point of the prop: no seeding of the active-case pointer by the host.
    const seeded = stub.set.mock.calls.filter(([items]) => items && 'faultmaven_current_case' in items);
    expect(seeded, 'the host should not have to write the pointer itself').toEqual([]);
  });

  it("{ kind: 'existing' } lands on that case's surface, not the empty state", async () => {
    handleCaseSelect.mockImplementation((caseId: string) => {
      useAppStore.setState({
        activeCaseId: caseId,
        activeCase: { case_id: caseId, title: 'Disk pressure on worker-03', state: 'investigating' },
      } as never);
    });

    renderPanel({ kind: 'existing', caseId: 'case-42' });

    await waitFor(() => expect(useAppStore.getState().activeCaseId).toBe('case-42'));
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
    expect(screen.queryByText('Start a new case')).toBeNull();
    // The transcript ITSELF needs a backend to fill it, so it is proved where
    // one answers: the playground, headless, in both modes.
  });

  it('omitted, the panel opens nothing of its own and shows the empty state', async () => {
    renderPanel();

    expect(await screen.findByText('Start a new case')).toBeInTheDocument();
    expect(handleCaseSelect).not.toHaveBeenCalled();
    expect(useAppStore.getState().hasUnsavedNewChat).toBe(false);
  });

  // Applied at mount, not on every render: re-applying would drag the user back
  // out of whatever they opened next.
  it('is applied once, not on re-render', async () => {
    const stub = createStubHost();
    const { rerender } = render(
      <CopilotPanel host={stub.host} initialCase={{ kind: 'existing', caseId: 'case-42' }} />,
      { wrapper: withQueryClient() },
    );
    await waitFor(() => expect(handleCaseSelect).toHaveBeenCalledTimes(1));

    // A fresh object literal, as a host re-rendering would produce.
    rerender(
      <CopilotPanel host={stub.host} initialCase={{ kind: 'existing', caseId: 'case-42' }} />,
    );

    expect(handleCaseSelect).toHaveBeenCalledTimes(1);
  });

  /**
   * The host's intent beats the persisted one.
   *
   * The panel restores the case that was open last, which is right for a side
   * panel that outlives its host and wrong the moment a host mounts it FOR
   * something. Without this the Dashboard would open a case's detail page and
   * be dragged onto whatever the user last looked at, asynchronously, two
   * storage reads later — a flicker, not a crash.
   */
  it("{ kind: 'new' } is not overridden by the persisted active case", async () => {
    renderPanel({ kind: 'new' }, { faultmaven_current_case: 'a-case-from-last-time' });

    await waitFor(() => expect(useAppStore.getState().hasUnsavedNewChat).toBe(true));
    // Long enough for the restore's two storage reads to have resolved.
    await new Promise((r) => setTimeout(r, 50));

    expect(handleCaseSelect).not.toHaveBeenCalled();
    expect(useAppStore.getState().hasUnsavedNewChat).toBe(true);
    expect(useAppStore.getState().activeCaseId).toBeNull();
  });

  it("{ kind: 'existing' } is not overridden by a DIFFERENT persisted case", async () => {
    handleCaseSelect.mockImplementation((caseId: string) => {
      useAppStore.setState({ activeCaseId: caseId } as never);
    });

    renderPanel(
      { kind: 'existing', caseId: 'case-42' },
      { faultmaven_current_case: 'a-case-from-last-time' },
    );

    await waitFor(() => expect(handleCaseSelect).toHaveBeenCalledWith('case-42'));
    await new Promise((r) => setTimeout(r, 50));

    expect(handleCaseSelect).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().activeCaseId).toBe('case-42');
  });
});
