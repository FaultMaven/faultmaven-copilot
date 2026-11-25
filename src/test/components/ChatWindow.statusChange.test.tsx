/**
 * A status change from the case header is a query the user chose, not one they
 * typed (faultmaven#2717): the server searches only a typed query for system
 * output to offer back as data, so the submit names its source `chosen`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserCaseState } from '@faultmaven/copilot-ui/lib/api';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } },
}));
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'investigating' }) },
}));
// The header's dropdown and modal are not under test: a button stands in for
// the confirmed choice, calling the callback ChatWindow hands the header.
vi.mock('@faultmaven/copilot-ui/shared/ui/components/case-header/EnhancedCaseHeader', () => ({
  EnhancedCaseHeader: ({ onStatusChangeRequest }: { onStatusChangeRequest?: (s: UserCaseState) => void }) => (
    <button type="button" onClick={() => onStatusChangeRequest?.('closed' as UserCaseState)}>
      Close case
    </button>
  ),
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

describe('ChatWindow — status change', () => {
  it('submits the status change as a chosen query, with its transition intent', async () => {
    const onQuerySubmit = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HostAdapterProvider value={createStubHost().host}>
          <ChatWindow
            conversation={[]}
            activeCase={activeCase}
            loading={false}
            sessionId="sid"
            onQuerySubmit={onQuerySubmit}
          />
        </HostAdapterProvider>
      </QueryClientProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close case' }));

    await waitFor(() => expect(onQuerySubmit).toHaveBeenCalledTimes(1));
    expect(onQuerySubmit).toHaveBeenCalledWith(
      'Close this case. Summarize what we found so far.',
      expect.objectContaining({ type: 'status_transition', from_state: 'investigating', to_state: 'closed' }),
      'chosen'
    );
  });
});
