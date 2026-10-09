/**
 * `onCaseChanged` from the panel's transition effect (dashboard#204): a state
 * transition of the active case tells the host; mounting and switching cases
 * do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

const reconcileActiveCaseState = vi.fn();
const row = (id: string, state: string) =>
  ({ case_id: id, title: id, state, created_at: '2026-10-09T09:00:00Z' }) as never;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('CopilotPanel onCaseChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      initializingCapabilities: false,
      capabilitiesError: null,
      activeCaseId: 'case-a',
      activeCase: row('case-a', 'investigating'),
      hasUnsavedNewChat: false,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
      reconcileActiveCaseState,
    } as never);
  });

  const mount = (onCaseChanged?: (id: string) => void) => {
    const stub = createStubHost();
    return render(<CopilotPanel host={stub.host} onCaseChanged={onCaseChanged} />, { wrapper });
  };

  it('does not fire on mount', async () => {
    const cb = vi.fn();
    mount(cb);
    await screen.findByRole('form', { name: 'Message Input' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not fire on a plain case switch', async () => {
    const cb = vi.fn();
    mount(cb);
    await screen.findByRole('form', { name: 'Message Input' });
    act(() => useAppStore.setState({ activeCaseId: 'case-b', activeCase: row('case-b', 'resolved') } as never));
    expect(cb).not.toHaveBeenCalled();
    expect(reconcileActiveCaseState).not.toHaveBeenCalled();
  });

  it('fires with the case id when the active case changes state (terminal refresh)', async () => {
    const cb = vi.fn();
    mount(cb);
    await screen.findByRole('form', { name: 'Message Input' });
    act(() => useAppStore.setState({ activeCase: row('case-a', 'closed') } as never));
    expect(reconcileActiveCaseState).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('case-a');
  });

  it('a throwing callback does not break the panel', async () => {
    const cb = vi.fn(() => {
      throw new Error('host bug');
    });
    mount(cb);
    await screen.findByRole('form', { name: 'Message Input' });
    act(() => useAppStore.setState({ activeCase: row('case-a', 'resolved') } as never));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });

  it('mounts without the prop', async () => {
    mount();
    act(() => useAppStore.setState({ activeCase: row('case-a', 'closed') } as never));
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });
});
