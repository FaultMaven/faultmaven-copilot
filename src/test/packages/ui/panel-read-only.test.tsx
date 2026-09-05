/**
 * A case this viewer may read and not write.
 *
 * A teammate opening someone else's case was given the composer and the upload
 * button. A turn sent into a case the user does not own is a write they cannot
 * make — the failure arrives from the server, after they have typed it.
 *
 * WHO may write is the host's question: it knows the case's owner and the
 * viewer. The panel renders the answer, and renders it by ABSENCE — a disabled
 * field says "you may write here, later", which is not what a shared case
 * means.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
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
