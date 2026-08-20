import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } }
}));

vi.mock('../../lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'resolved' }) }
}));

import { ChatWindow } from '../../shared/ui/components/ChatWindow';
import type { UserCase } from '../../types/case';

const activeCase = {
  case_id: 'case-1',
  title: 'Redis connection pool exhaustion',
  state: 'resolved',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  owner_id: 'user-1',
  organization_id: 'org-1',
  closure_reason: null,
  closed_at: null
} as unknown as UserCase;

/** The verbatim failure notice `_run_runbook_conversion` writes on the backend. */
const FAILURE_NOTICE =
  'Runbook generation failed. Click **Generate runbook from this case** to retry.';

const conversation = [
  {
    id: 'm1',
    question: 'Generate a runbook from this case',
    timestamp: '2026-08-01T10:00:00Z',
    turn_number: 4,
    optimistic: false
  },
  {
    id: 'm2',
    response: 'Creating your runbook draft from this case.',
    timestamp: '2026-08-01T10:00:05Z',
    turn_number: 4,
    optimistic: false
  },
  {
    id: 'm3',
    notice: FAILURE_NOTICE,
    timestamp: '2026-08-01T10:01:00Z',
    // Whichever turn happened to be open when the background job finished.
    turn_number: 4,
    optimistic: false
  }
] as any[];

const renderChat = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatWindow
        conversation={conversation}
        activeCase={activeCase}
        loading={false}
        sessionId="sid-1"
        onQuerySubmit={vi.fn()}
      />
    </QueryClientProvider>
  );
};

const noticeRow = (container: HTMLElement) =>
  container.querySelector('[data-notice-id="m3"]') as HTMLElement | null;

describe('ChatWindow — system notices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a system notice that used to be dropped entirely (#209)', () => {
    // The regression: this row never reached the store, so a failed runbook
    // conversion produced no signal at all — and the retry instruction the user
    // needed lived only inside this message.
    const { container } = renderChat();

    const row = noticeRow(container);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Runbook generation failed');
    expect(row!.textContent).toContain('Generate runbook from this case');
  });

  it('attributes the notice to neither participant', () => {
    // The failure mode worth avoiding, seen in the Dashboard's transcript
    // (faultmaven-dashboard#105): a non-conversational row rendered as
    // something the reader said.
    const { container } = renderChat();
    const row = noticeRow(container)!;

    expect(row.textContent).toContain('System');
    expect(row.textContent).not.toContain('FaultMaven');
    // The user's own words are in a separate row, not this one.
    expect(row.textContent).not.toContain('Generate a runbook from this case');
  });

  it('claims no turn, and leaves the surrounding turns labelled', () => {
    // `turn_number` is carried (the delta merge's turn floor needs it) but not
    // printed: it is whichever turn was open when the background job finished,
    // so printing it would assert membership in an exchange the notice had no
    // part in.
    const { container } = renderChat();

    expect(noticeRow(container)!.textContent).not.toMatch(/Turn \d+/);
    // …while the conversational rows still carry theirs.
    expect(screen.getAllByText(/Turn 4 ·/).length).toBeGreaterThan(0);
  });

  it('renders the notice as Markdown rather than raw asterisks', () => {
    // The backend writes these with Markdown emphasis (`**Knowledge > Drafts**`,
    // `**Generate runbook from this case**`). Rendered as plain text the
    // asterisks would show through, in the one message whose whole job is to
    // tell the user what to do next.
    const { container } = renderChat();
    const row = noticeRow(container)!;

    expect(row.textContent).not.toContain('**');
    expect(row.querySelector('strong')?.textContent).toBe(
      'Generate runbook from this case'
    );
  });
});
