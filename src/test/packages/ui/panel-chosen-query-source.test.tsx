/**
 * A suggestion card clicked in the mounted panel reaches the turn request as
 * `chosen` (faultmaven#2717).
 *
 * Driven through every layer the source passes, CopilotPanel → ContentArea →
 * ChatInterface → ChatWindow → SuggestionCard → useMessageSubmission →
 * submitTurn, because a prop type cannot stop a wrapper with fewer parameters
 * from dropping it: `(q, i) => handleQuerySubmit(q, i)` type-checks against a
 * three-parameter prop and sends the hook's default, `typed`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@faultmaven/copilot-ui/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@faultmaven/copilot-ui/lib/api')>();
  return { ...actual, submitTurn: vi.fn() };
});
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'investigating' }) },
}));
vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import * as api from '@faultmaven/copilot-ui/lib/api';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

const SAVE_INTENT = { type: 'save_chat_data', offer_id: 'offer-1' };

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('CopilotPanel — a chosen suggestion is sent as chosen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.submitTurn).mockResolvedValue({
      agent_response: 'Saved.',
      turn_number: 2,
      milestones_completed: [],
      case_state: 'investigating',
      progress_made: true,
      attachments_processed: [],
      suggested_actions: [],
    } as never);
    useAppStore.setState({
      initializingCapabilities: false,
      capabilitiesError: null,
      sessionId: 'session-1',
      activeCaseId: 'case-a',
      activeCase: {
        case_id: 'case-a',
        title: 'case-a',
        state: 'investigating',
        enterprise_id: 'e1',
        created_at: '2026-10-09T09:00:00Z',
      },
      hasUnsavedNewChat: false,
      conversations: {},
      conversationTitles: {},
      titleSources: {},
    } as never);
  });

  // Seeded once the panel has mounted: its mount restores the persisted
  // conversations, which would replace a transcript seeded before it.
  const seedTranscript = () =>
    useAppStore.setState({
      conversations: {
        'case-a': [
          {
            id: 'a1',
            question: '',
            response: 'That output shows the pool limit. Save it as data?',
            error: false,
            timestamp: '2026-10-09T09:01:00Z',
            turn_number: 1,
            optimistic: false,
            suggestedActions: [
              { type: 'DECIDE', label: 'Yes, save it as data', payload: 'Save that output as data.', intent: SAVE_INTENT },
            ],
          },
        ],
      },
    } as never);

  it('sends querySource "chosen" with the card\'s intent on the request to submitTurn', async () => {
    render(<CopilotPanel host={createStubHost().host} />, { wrapper });
    await screen.findByRole('form', { name: 'Message Input' });
    act(() => seedTranscript());

    await userEvent.click(await screen.findByRole('button', { name: 'Yes, save it as data' }));

    await waitFor(() => expect(api.submitTurn).toHaveBeenCalledTimes(1));
    const [caseId, request] = vi.mocked(api.submitTurn).mock.calls[0];
    expect(caseId).toBe('case-a');
    expect(request).toMatchObject({
      query: 'Save that output as data.',
      querySource: 'chosen',
      intentType: 'save_chat_data',
    });
  });
});
