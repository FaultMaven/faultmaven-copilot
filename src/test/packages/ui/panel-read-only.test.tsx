/**
 * A case this viewer may read and not write: someone else drives it (ADR-020).
 *
 * A reader opening a case someone else drives was given the composer and the
 * upload button. A turn sent into a case the user does not drive is a write
 * they cannot make — the failure arrives from the server, after they have typed it.
 *
 * WHO may write is the host's question: it knows the case's driver and the
 * viewer. The panel renders the answer, and renders it by ABSENCE — a disabled
 * field says "you may write here, later", which is not what a case someone
 * else drives means.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: ({ currentUserId }: { currentUserId?: string }) => (
    <div data-testid="conversations-list" data-user={currentUserId} />
  ),
}));

const handleCaseSelect = vi.fn((caseId: string) => {
  useAppStore.setState({
    activeCaseId: caseId,
    activeCase: { case_id: caseId, title: "Someone else's disk pressure", state: 'investigating' },
  } as never);
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    initializingCapabilities: false,
    capabilitiesError: null,
    activeCaseId: null,
    activeCase: null,
    hasUnsavedNewChat: false,
    conversations: {},
    handleCaseSelect,
  } as never);
});

const renderPanel = (readOnly?: boolean) => {
  const stub = createStubHost();
  render(
    <CopilotPanel
      host={stub.host}
      initialCase={{ kind: 'existing', caseId: 'case-42', readOnly }}
    />,
  );
  return stub;
};

describe('initialCase readOnly', () => {
  it('renders the transcript and NO composer', async () => {
    renderPanel(true);

    await waitFor(() => expect(useAppStore.getState().activeCaseId).toBe('case-42'));
    expect(screen.queryByRole('form', { name: 'Message Input' })).toBeNull();
    expect(screen.queryByPlaceholderText(/Ask FaultMaven/i)).toBeNull();
    // …and it is an omission, not an unrendered branch: the case is open.
    expect(screen.queryByText('Start a new case')).toBeNull();
  });

  it('offers no upload affordance either', async () => {
    renderPanel(true);
    await waitFor(() => expect(useAppStore.getState().activeCaseId).toBe('case-42'));

    expect(screen.queryByRole('button', { name: /attach|upload|capture/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  // The same case without the flag is the writable view, so the absence above
  // is the flag's doing and not a broken render.
  it('without readOnly the composer is there', async () => {
    renderPanel(false);

    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });

  it('omitted entirely, the composer is there', async () => {
    renderPanel(undefined);

    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });
});

// The extension host's LIVE verdict (fm#1898): it follows the case the user
// opens inside the panel, where `initialCase.readOnly` is only the mount-time
// answer. Same mechanism, same absence.
describe('host readOnly prop', () => {
  const mountWith = (readOnly: boolean) => {
    const stub = createStubHost();
    const view = render(
      <CopilotPanel host={stub.host} initialCase={{ kind: 'existing', caseId: 'case-42' }} readOnly={readOnly} />,
    );
    return { stub, view };
  };

  it('renders no composer and says why', async () => {
    mountWith(true);
    await waitFor(() => expect(useAppStore.getState().activeCaseId).toBe('case-42'));

    expect(screen.queryByRole('form', { name: 'Message Input' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent("Only the case's driver can add to it.");
    expect(screen.getByRole('note')).not.toHaveTextContent(/shared|owner/i);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('follows the verdict when the open case changes', async () => {
    const { stub, view } = mountWith(false);
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();

    view.rerender(
      <CopilotPanel host={stub.host} initialCase={{ kind: 'existing', caseId: 'case-42' }} readOnly />,
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Message Input' })).toBeNull());

    view.rerender(
      <CopilotPanel host={stub.host} initialCase={{ kind: 'existing', caseId: 'case-42' }} readOnly={false} />,
    );
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });

  it('a case the server refused a write on is read-only whatever the host said', async () => {
    mountWith(false);
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();

    act(() => useAppStore.getState().markWriteDenied('case-42'));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Message Input' })).toBeNull());
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('a readOnly case offers no write action: no confirmation buttons, no Retry', async () => {
    useAppStore.setState({
      conversations: {
        'case-42': [
          {
            id: 'a1',
            response: 'Restart the pool?\n\n[Yes] [No]',
            timestamp: '2026-10-09T09:00:00Z',
            optimistic: false,
          },
        ],
      },
    } as never);
    mountWith(true);
    await waitFor(() => expect(useAppStore.getState().activeCaseId).toBe('case-42'));

    expect(screen.queryByRole('button', { name: /^(yes|no|retry)$/i })).toBeNull();
    // (The status menu is asserted against the REAL header in
    // ChatWindow.readOnlyHeader.test.tsx; the panel here has no case-UI data,
    // so a query for it would pass vacuously.)
  });
});

// The list is told who the viewer is, so it offers delete only on the cases
// the viewer created (ADR-020 D2).
describe('the case list is told the signed-in user', () => {
  it('passes the session user id to ConversationsList', async () => {
    const stub = createStubHost();
    render(<CopilotPanel host={stub.host} />);
    await waitFor(() =>
      expect(screen.getByTestId('conversations-list').getAttribute('data-user')).toBe(stub.host.session.user.id),
    );
  });
});
