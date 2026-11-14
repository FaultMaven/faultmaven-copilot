/**
 * `onCaseChanged` from the panel's transition effect (dashboard#204): a state
 * transition of the active case tells the host; mounting and switching cases
 * do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
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
  ({ case_id: id, title: id, state, enterprise_id: 'e1', created_at: '2026-10-09T09:00:00Z' }) as never;

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

  // The Dashboard's mount: handleCaseSelect writes a synchronous 'inquiry'
  // placeholder (no enterprise_id), then refreshActiveCase replaces it with the
  // server's row on the same id. Revealing state that already existed is not a
  // change of the case.
  it('opening a non-inquiry case (placeholder, then hydration) does not notify; a later transition does', async () => {
    const handleCaseSelect = vi.fn((caseId: string) => {
      useAppStore.setState({
        activeCaseId: caseId,
        activeCase: { case_id: caseId, title: caseId, state: 'inquiry', enterprise_id: '' },
      } as never);
      setTimeout(() => useAppStore.setState({ activeCase: row(caseId, 'investigating') } as never), 10);
    });
    useAppStore.setState({ activeCaseId: null, activeCase: null, handleCaseSelect } as never);
    const cb = vi.fn();
    const stub = createStubHost();
    render(
      <CopilotPanel host={stub.host} chrome="embedded" initialCase={{ kind: 'existing', caseId: 'case-a' }} onCaseChanged={cb} />,
      { wrapper },
    );
    await screen.findByRole('form', { name: 'Message Input' });
    await waitFor(() => expect(useAppStore.getState().activeCase?.state).toBe('investigating'));
    expect(cb).not.toHaveBeenCalled();

    act(() => useAppStore.setState({ activeCase: row('case-a', 'resolved') } as never));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('case-a');
  });

  // #384: the read-back found the open case gone and the store closed it.
  it('a case found gone: the panel shows the ruled notice and tells the host, once', async () => {
    // The toast reads the reduced-motion preference; the test DOM has no matchMedia.
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    const cb = vi.fn();
    mount(cb);
    await screen.findByRole('form', { name: 'Message Input' });
    act(() => useAppStore.setState({
      activeCaseId: null, activeCase: null, hasUnsavedNewChat: false, goneCaseNotice: { caseId: 'case-a' },
    } as never));

    expect(await screen.findByText('Case Not Found')).toBeInTheDocument();
    expect(screen.getByText('This case no longer exists.')).toBeInTheDocument();
    expect(screen.getByText('It may have been deleted in another window or on another device.')).toBeInTheDocument();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('case-a');
    expect(useAppStore.getState().goneCaseNotice).toBeNull();
    // Closed: the no-case screen, not a composer for the gone case.
    expect(screen.getByText('Start a new case')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Message Input' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('mounts without the prop', async () => {
    mount();
    act(() => useAppStore.setState({ activeCase: row('case-a', 'closed') } as never));
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });
});
