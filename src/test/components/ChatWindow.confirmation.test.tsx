/**
 * A confirmation is answered through the card the server attaches, never through
 * text in the reply (#291).
 *
 * The server executes a confirmation click only when its intent names the offer
 * standing when it arrives (`proposal_id`, faultmaven#1812). Its confirm/decline
 * cards carry that key; a Yes/No pair drawn from a `[✅ Yes] [❌ No]` pattern in
 * the reply could name no offer, so every click on it was refused. The pattern
 * is now plain text, and the card's intent reaches `onQuerySubmit` whole.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } },
}));
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'investigating' }) },
}));
vi.mock('@faultmaven/copilot-ui/shared/ui/components/case-header/EnhancedCaseHeader', () => ({
  EnhancedCaseHeader: () => <div data-testid="header" />,
}));

import { ChatWindow } from '@faultmaven/copilot-ui/shared/ui/components/ChatWindow';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';
import { HostAdapterProvider } from '@faultmaven/copilot-ui/shared/host';
import { createStubHost } from '../support/host';

const activeCase = {
  case_id: 'case-1',
  title: 'Pool exhaustion',
  state: 'investigating',
  created_at: '2026-08-01T00:00:00Z',
  owner_id: 'u1',
  driver_id: 'u1',
  enterprise_id: 'e1',
  closure_reason: null,
  closed_at: null,
} as unknown as UserCase;

// The shape core's builders emit (`terminal_replies`, `offer_intent_fields`).
const confirmIntent = { type: 'confirmation', confirmation_value: true, proposal_id: '2026-10-01T06:00:00Z' };
const declineIntent = { type: 'confirmation', confirmation_value: false, proposal_id: '2026-10-01T06:00:00Z' };

const conversation = [
  {
    id: 'a1',
    response: 'The pool limit was the cause. Mark the case resolved?\n\n[✅ Yes]  [❌ No]',
    timestamp: '2026-10-01T06:00:05Z',
    turn_number: 4,
    optimistic: false,
    suggestedActions: [
      { type: 'DECIDE', label: 'Yes, mark as resolved', payload: 'Yes, mark it resolved.', intent: confirmIntent },
      { type: 'DECIDE', label: 'Not yet', payload: 'Not yet.', intent: declineIntent },
    ],
  },
] as any[];

const stub = createStubHost();

const chat = (onQuerySubmit: (...args: unknown[]) => void) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <HostAdapterProvider value={stub.host}>
      <ChatWindow
        conversation={conversation}
        activeCase={activeCase}
        loading={false}
        sessionId="sid"
        onQuerySubmit={onQuerySubmit}
      />
    </HostAdapterProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChatWindow — confirmation', () => {
  it('renders a Yes/No pattern in the reply as text, not as buttons', () => {
    render(chat(vi.fn()));

    // The reply is not cut short where the pattern was: the user reads what the model wrote.
    expect(screen.getByText(/\[✅ Yes\]\s+\[❌ No\]/)).toBeInTheDocument();
    // The only controls are the server's two cards.
    expect(screen.queryByRole('button', { name: /^(✅\s*)?yes$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(❌\s*)?no$/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes, mark as resolved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not yet' })).toBeInTheDocument();
  });

  it("submits the card's intent whole, with the offer it names", async () => {
    const onQuerySubmit = vi.fn();
    render(chat(onQuerySubmit));

    await userEvent.click(screen.getByRole('button', { name: 'Yes, mark as resolved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));

    expect(onQuerySubmit).toHaveBeenNthCalledWith(1, 'Yes, mark it resolved.', confirmIntent);
    expect(onQuerySubmit).toHaveBeenNthCalledWith(2, 'Not yet.', declineIntent);
    // Exactly the server's object, not a rebuild that happens to compare equal today.
    expect(onQuerySubmit.mock.calls[0][1]).toBe(confirmIntent);
    expect(onQuerySubmit.mock.calls[1][1]).toBe(declineIntent);
  });
});
