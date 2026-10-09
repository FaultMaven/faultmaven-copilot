/**
 * The REAL case header under a read-only ChatWindow (fm#1898).
 *
 * `EnhancedCaseHeader` used to hand HeaderSummary its own handler whatever the
 * parent passed, so `canChangeStatus` stayed true on a shared case: the menu
 * opened, and the modal's Continue did nothing. The contrast render proves the
 * query can find the menu at all, so the absence below is not vacuous.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({ browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } } }));
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: {
    getCaseUI: vi.fn().mockResolvedValue({
      case_id: 'case-1',
      title: 'Pool exhaustion',
      state: 'investigating',
      disposition_eligibility: { closed: 'ready', resolved: 'not_eligible' },
      progress: { current_stage: 'diagnosis', completed_indicators: [] },
    }),
  },
}));

import { ChatWindow } from '@faultmaven/copilot-ui/shared/ui/components/ChatWindow';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

const activeCase = {
  case_id: 'case-1', title: 'Pool exhaustion', state: 'investigating',
  created_at: '2026-08-01T00:00:00Z', owner_id: 'u2', enterprise_id: 'e1',
  closure_reason: null, closed_at: null,
} as unknown as UserCase;

const chat = (readOnly: boolean) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ChatWindow conversation={[]} activeCase={activeCase} loading={false} sessionId="sid"
      onQuerySubmit={vi.fn()} readOnly={readOnly} />
  </QueryClientProvider>
);

beforeEach(() => vi.clearAllMocks());

describe('real header, status menu', () => {
  it('contrast: a writable case has a status control that opens a Closed option', async () => {
    render(chat(false));
    fireEvent.click(await screen.findByRole('button', { name: /investigating/i }));
    expect(await screen.findByRole('button', { name: /closed/i })).toBeInTheDocument();
  });

  it('a read-only case shows the static pill: no control, no menu', async () => {
    render(chat(true));
    expect(await screen.findByText(/investigating/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /investigating/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /closed/i })).toBeNull();
  });
});
