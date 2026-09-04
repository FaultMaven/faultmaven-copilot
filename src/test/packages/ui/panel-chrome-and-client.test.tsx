/**
 * What the panel brings with it, and how much of itself it renders.
 *
 * Both of these are about a host that already has a page around the panel. The
 * Dashboard has its own case list, its own account menu and its own query
 * client; the extension's side panel has none of those and IS the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { queryClient as packageQueryClient } from '@faultmaven/copilot-ui/lib/api/query-client';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

/**
 * The stand-in for the case list is also the PROBE: it renders inside the
 * panel's own provider, which is the only place the identity question means
 * anything. Rendering a probe as a sibling would read whatever provider the
 * TEST mounted and prove nothing about the panel.
 */
const seenClients: unknown[] = [];
vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    seenClients.push(useQueryClient());
    return <div data-testid="conversations-list" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  seenClients.length = 0;
  useAppStore.setState({
    initializingCapabilities: false,
    capabilitiesError: null,
    activeCaseId: null,
    activeCase: null,
    hasUnsavedNewChat: true,
    conversations: {},
    conversationTitles: {},
    titleSources: {},
  } as never);
});

/**
 * The panel owns its query client.
 *
 * Two pieces of this tree reach the cache by different routes: `ChatWindow`
 * calls `useQueryClient()`, while `useMessageSubmission` and `useDataUpload`
 * import the module singleton and invalidate on that. When the host supplied
 * the provider those were DIFFERENT objects, so every invalidation the hooks
 * fired landed in a cache nothing was reading — the case header went stale with
 * nothing thrown. Only an identity check catches that; "a client is present"
 * was always true.
 */
describe('CopilotPanel brings its own query client', () => {
  it('renders with NO host-supplied provider at all', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} />);

    // On the previous head this threw "No QueryClient set": the panel depended
    // on its host to mount one.
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
  });

  it('gives its subtree the SAME object the invalidating hooks import', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} />);
    await screen.findByTestId('conversations-list');

    expect(seenClients.length).toBeGreaterThan(0); // the probe actually ran
    for (const client of seenClients) {
      expect(
        client,
        'a component inside the panel saw a DIFFERENT client from the one ' +
          'useMessageSubmission and useDataUpload invalidate on — every ' +
          'invalidation they fire would land in a cache nothing reads',
      ).toBe(packageQueryClient);
    }
  });
});

/**
 * `chrome: 'embedded'` renders the conversation alone.
 *
 * Not a smaller sidebar — none. A host that embeds the panel already shows a
 * case list and an account menu, and a second set inside its layout duplicates
 * the page around it.
 */
describe('CopilotPanel chrome', () => {
  it("'full' renders the case-list nav and the account row", async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} chrome="full" />);

    expect(await screen.findByTestId('conversations-list')).toBeInTheDocument();
    expect(screen.getByText('Stub Operator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
  });

  it("'embedded' renders the conversation and NONE of them", async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} chrome="embedded" />);

    // The conversation is there…
    expect(await screen.findByRole('form', { name: 'Message Input' })).toBeInTheDocument();
    // …and the host's own furniture is not duplicated inside it.
    expect(screen.queryByTestId('conversations-list')).toBeNull();
    expect(screen.queryByText('Stub Operator')).toBeNull();
    expect(screen.queryByRole('button', { name: /New Case/i })).toBeNull();
  });

  it('defaults to full, so the extension side panel is unchanged by omission', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} />);

    expect(await screen.findByTestId('conversations-list')).toBeInTheDocument();
    expect(screen.getByText('Stub Operator')).toBeInTheDocument();
  });
});

/**
 * The composer's copy in a DRAFT case — the state `initialCase: { kind: 'new' }`
 * lands a host on.
 */
describe('the draft-case composer', () => {
  it('invites the problem rather than telling the user to select a case', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} initialCase={{ kind: 'new' }} />);

    const composer = await screen.findByPlaceholderText(/Describe what's wrong/i);
    expect(composer).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Select a case to start chatting/i)).toBeNull();
  });

  it('is enabled, so the instruction and the affordance agree', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} initialCase={{ kind: 'new' }} />);

    const composer = await screen.findByPlaceholderText(/Describe what's wrong/i);
    await waitFor(() => expect(composer).not.toBeDisabled());
  });
});
