/**
 * The chat-data offer (#328, faultmaven#1930, contract 13.3.0).
 *
 * Chat messages are claims; only submitted data is evidence. When a message
 * carries system output, the reply leads `suggested_actions` with the offer:
 *
 * - "Yes, save it as data": a DECIDE whose `save_chat_data` intent names the
 *   offer (`offer_id`). The click goes through the ordinary DECIDE path and the
 *   intent reaches the turn whole.
 * - "Not exactly, let me re-submit": an EVIDENCE with `prefill` (the blocks).
 *   The click opens the composer's data box holding them for the user to
 *   correct and send. Nothing goes to the server on the click.
 * - "Submit the output": an EVIDENCE with `prefill: ""` and the requested output
 *   in `body`. The click opens the data box empty, with `body` as its hint.
 *
 * Tested through `ChatInterface`, the parent both hosts mount, because the click
 * lands in the transcript and its effect is in the composer beside it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { ChatInterface } from '@faultmaven/copilot-ui/shared/ui/components/ChatInterface';
import { suggestionFromResponse } from '@faultmaven/copilot-ui/lib/state/turn-items';
import type { SuggestedAction } from '@faultmaven/copilot-ui/lib/api/types';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import type { TurnIntent } from '@faultmaven/copilot-ui/lib/api';
import type {
  QuerySubmitResult,
  TurnPayload,
  TurnSubmitResult,
} from '@faultmaven/copilot-ui/shared/ui/components/UnifiedInputBar';
import { HostAdapterProvider } from '@faultmaven/copilot-ui/shared/host';
import { createStubHost } from '../support/host';

const caseIn = (state: string) =>
  ({
    case_id: 'case-1',
    title: 'Pool exhaustion',
    state,
    created_at: '2026-10-01T00:00:00Z',
    owner_id: 'u1',
    driver_id: 'u1',
    enterprise_id: 'e1',
    closure_reason: null,
    closed_at: null,
  }) as unknown as UserCase;

// The blocks keep the first line's indentation: they are sent as typed.
const BLOCKS = '  pool:\n    max: 10\nERROR pool exhausted (10/10 in use)';
const SAVE_INTENT = { type: 'save_chat_data', offer_id: 'cdo_3f9a1c2b7d4e' };
const SUBMIT_HINT = 'Send it as data (pasted or attached): the output of `kubectl get pods -n api`.';

// As the server sends them (`chat_data_choices`), narrowed by the one builder.
const OUTPUT_OFFER = [
  {
    label: 'Yes, save it as data',
    type: 'DECIDE',
    payload: 'Save that output as data.',
    body: 'It is output copied from the system, unchanged.',
    intent: SAVE_INTENT,
  },
  {
    label: 'Not exactly, let me re-submit',
    type: 'EVIDENCE',
    body: 'Correct it, then send it as data (pasted or attached).',
    prefill: BLOCKS,
  },
].map(suggestionFromResponse);

const STATE_REQUEST = [
  { label: 'Submit the output', type: 'EVIDENCE', body: SUBMIT_HINT, prefill: '' },
].map(suggestionFromResponse);

const conversationWith = (suggestedActions: SuggestedAction[]): OptimisticConversationItem[] => [
  {
    id: 'u1',
    question: 'the pool is stuck:\n  pool:\n    max: 10\nERROR pool exhausted (10/10 in use)',
    timestamp: '2026-10-11T10:00:00Z',
    turn_number: 3,
    optimistic: false,
  },
  {
    id: 'a1',
    response: 'The pool is at its limit.\n\n---\nYour message includes output from a system.',
    timestamp: '2026-10-11T10:00:05Z',
    turn_number: 3,
    optimistic: false,
    suggestedActions,
  },
];

const stub = createStubHost();
let onQuerySubmit: Mock<(query: string, intent?: TurnIntent) => Promise<QuerySubmitResult>>;
let onTurnSubmit: Mock<(payload: TurnPayload) => Promise<TurnSubmitResult>>;

function renderChat({
  suggestedActions = OUTPUT_OFFER,
  state = 'investigating',
  readOnly = false,
} = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HostAdapterProvider value={stub.host}>
        <ChatInterface
          activeCaseId="case-1"
          activeCase={caseIn(state)}
          conversations={{ 'case-1': conversationWith(suggestedActions) }}
          loading={false}
          submitting={false}
          sessionId="sid"
          readOnly={readOnly}
          onQuerySubmit={onQuerySubmit}
          onTurnSubmit={onTurnSubmit}
          failedOperations={[]}
          onRetryFailedOperation={vi.fn()}
          onDismissFailedOperation={vi.fn()}
          getErrorMessageForOperation={() => ({ title: '', message: '', recoveryHint: '' })}
        />
      </HostAdapterProvider>
    </QueryClientProvider>,
  );
}

const resubmitButton = () => screen.getByRole('button', { name: 'Not exactly, let me re-submit' });
const textpad = () => screen.getByLabelText('Paste data content') as HTMLTextAreaElement;
const box = () => screen.getByLabelText(/Type your message/i) as HTMLTextAreaElement;
const send = () => fireEvent.click(screen.getByRole('button', { name: /send message/i }));
const lines = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  onQuerySubmit = vi.fn(async () => ({ sent: true }));
  onTurnSubmit = vi.fn(async () => ({ success: true, message: '', sent: true }));
});

describe('the chat-data offer (#328)', () => {
  describe('"Not exactly, let me re-submit" (EVIDENCE + prefill)', () => {
    it('opens the data box holding the blocks, and sends nothing', () => {
      renderChat();
      expect(screen.queryByLabelText('Paste data content')).toBeNull();

      fireEvent.click(resubmitButton());

      expect(textpad().value).toBe(BLOCKS);
      expect(onQuerySubmit).not.toHaveBeenCalled();
      expect(onTurnSubmit).not.toHaveBeenCalled();
    });

    it('Send carries the corrected blocks as pasted data, verbatim, beside the typed words', async () => {
      renderChat();
      fireEvent.click(resubmitButton());
      fireEvent.change(textpad(), { target: { value: `${BLOCKS}\nWARN retrying` } });
      fireEvent.change(box(), { target: { value: 'this is the real output' } });
      send();

      await waitFor(() => expect(onTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = onTurnSubmit.mock.calls[0][0];
      expect(payload.pastedContent).toBe(`${BLOCKS}\nWARN retrying`);
      expect(payload.inputType).toBe('paste');
      expect(payload.query).toBe('this is the real output');
      expect(onQuerySubmit).not.toHaveBeenCalled();
    });

    it('keeps a staged file: the two go in one turn', async () => {
      renderChat();
      const file = new File(['boom'], 'app.log', { type: 'text/plain' });
      fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());

      fireEvent.click(resubmitButton());

      expect(screen.getByText('app.log')).toBeInTheDocument();
      expect(textpad().value).toBe(BLOCKS);
      send();
      await waitFor(() => expect(onTurnSubmit).toHaveBeenCalledTimes(1));
      const payload = onTurnSubmit.mock.calls[0][0];
      expect(payload.files).toEqual([file]);
      expect(payload.pastedContent).toBe(BLOCKS);
    });

    it('adds the blocks after data already staged, never in place of it', () => {
      renderChat();
      const earlier = lines(3, 'earlier');
      fireEvent.paste(box(), { clipboardData: { getData: (t: string) => (t === 'text/plain' ? earlier : '') } });
      expect(screen.getByText(/Pasted context/)).toBeInTheDocument();

      fireEvent.click(resubmitButton());

      expect(textpad().value).toBe(`${earlier}\n${BLOCKS}`);
    });

    it('adds the blocks to an open textpad after what it holds; a second click adds nothing', () => {
      renderChat();
      fireEvent.click(screen.getByRole('button', { name: 'Paste data' }));
      fireEvent.change(textpad(), { target: { value: 'kubectl output' } });

      fireEvent.click(resubmitButton());
      fireEvent.click(resubmitButton());

      expect(textpad().value).toBe(`kubectl output\n${BLOCKS}`);
    });

    it('leaves what the user typed in the message box', () => {
      renderChat();
      fireEvent.change(box(), { target: { value: 'half a question' } });
      fireEvent.click(resubmitButton());
      expect(box()).toHaveValue('half a question');
    });
  });

  describe('"Submit the output" (EVIDENCE + empty prefill)', () => {
    it('opens the data box empty, with the requested output as its hint, and sends nothing', () => {
      renderChat({ suggestedActions: STATE_REQUEST });

      fireEvent.click(screen.getByRole('button', { name: 'Submit the output' }));

      expect(textpad().value).toBe('');
      expect(textpad().placeholder).toBe(SUBMIT_HINT);
      expect(onQuerySubmit).not.toHaveBeenCalled();
      expect(onTurnSubmit).not.toHaveBeenCalled();
    });

    it('the hint is the offer\'s only: the Paste button opens the data box with its own', () => {
      renderChat({ suggestedActions: STATE_REQUEST });
      fireEvent.click(screen.getByRole('button', { name: 'Submit the output' }));
      // Closed from the Paste button, then reopened from it.
      fireEvent.click(screen.getByRole('button', { name: 'Paste data' }));
      fireEvent.click(screen.getByRole('button', { name: 'Paste data' }));
      expect(textpad().placeholder).not.toBe(SUBMIT_HINT);
    });
  });

  describe('"Yes, save it as data" (DECIDE + save_chat_data)', () => {
    it('sends the payload with the intent exactly as the server attached it, offer_id included', () => {
      renderChat();

      fireEvent.click(screen.getByRole('button', { name: 'Yes, save it as data' }));

      expect(onQuerySubmit).toHaveBeenCalledTimes(1);
      expect(onQuerySubmit).toHaveBeenCalledWith('Save that output as data.', SAVE_INTENT);
      expect(onTurnSubmit).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Paste data content')).toBeNull();
    });
  });

  describe('where the composer takes no data', () => {
    it.each(['resolved', 'closed'])('a %s case offers no data-box action; the choice still reads', (state) => {
      renderChat({ suggestedActions: [...OUTPUT_OFFER, ...STATE_REQUEST], state });

      expect(screen.queryByRole('button', { name: 'Not exactly, let me re-submit' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Submit the output' })).toBeNull();
      expect(screen.getByText('Not exactly, let me re-submit')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Submit the output'));
      expect(screen.queryByLabelText('Paste data content')).toBeNull();
    });

    it('a read-only case offers none of the choices', () => {
      renderChat({ suggestedActions: [...OUTPUT_OFFER, ...STATE_REQUEST], readOnly: true });

      expect(screen.queryByRole('button', { name: 'Yes, save it as data' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Not exactly, let me re-submit' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Submit the output' })).toBeNull();
    });
  });

  it('an EVIDENCE without prefill stays informational', () => {
    renderChat({
      suggestedActions: [suggestionFromResponse({ label: 'Pod list', type: 'EVIDENCE', body: 'kubectl get pods' })],
    });
    expect(screen.queryByRole('button', { name: 'Pod list' })).toBeNull();
    fireEvent.click(screen.getByText('Pod list'));
    expect(screen.queryByLabelText('Paste data content')).toBeNull();
  });
});
