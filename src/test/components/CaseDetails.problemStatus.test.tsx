/**
 * #296 — the Problem row reads `problem_verification.problem_status`.
 *
 * Before this the row stated the problem as fact in every state, including an
 * open case whose evidence showed the problem never occurred (a false alarm the
 * user has not yet closed). The fields arrive on INVESTIGATING only; RESOLVED
 * and CLOSED responses carry no `problem_verification`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } }
}));

vi.mock('@faultmaven/copilot-ui/lib/api/files-service', () => ({
  filesApi: { getUploadedFiles: vi.fn().mockResolvedValue([]), getUploadedFileDetails: vi.fn() }
}));

import { CaseDetails } from '@faultmaven/copilot-ui/shared/ui/components/case-header/CaseDetails';
import { createStubHost, hostWrapper } from '../support/host';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

const STATEMENT = 'Checkout pods are OOM-killed under load';

const activeCase = {
  case_id: 'case-1',
  title: 'OOM kills on checkout',
  state: 'investigating',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  owner_id: 'u1',
  enterprise_id: 'e1',
  closure_reason: null,
  closed_at: null,
  message_count: 4,
  description: 'Checkout pods restart (cached)',
} as unknown as UserCase;

const investigating = (problemVerification: Record<string, unknown> | null) =>
  ({
    state: 'investigating',
    case_id: 'case-1',
    current_turn: 5,
    investigation_turn: 5,
    title: 'OOM kills on checkout',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    problem_statement: STATEMENT,
    progress: { completed_indicators: [], completed_milestones: [] },
    uploaded_files_count: 0,
    agent_status: 'idle',
    problem_verification: problemVerification,
  }) as any;

const renderProblem = (caseData: any) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = createStubHost();
  return render(
    <QueryClientProvider client={queryClient}>
      <CaseDetails
        caseData={caseData}
        activeCase={activeCase}
        expandedSection={null}
        onToggleSection={vi.fn()}
      />
    </QueryClientProvider>,
    { wrapper: hostWrapper(stub.host) }
  );
};

describe('CaseDetails — the Problem row against problem_status (#296)', () => {
  it('marks an invalidated problem as not present, with the finding', () => {
    renderProblem(
      investigating({
        problem_status: 'invalidated',
        invalidation_finding: 'Memory never exceeded 60% of the limit during the window.',
      })
    );

    expect(screen.getByText(STATEMENT).className).toContain('line-through');
    expect(
      screen.getByText('Not present: Memory never exceeded 60% of the limit during the window.')
    ).toBeInTheDocument();
  });

  it('says the problem was not present even without a finding text', () => {
    renderProblem(investigating({ problem_status: 'invalidated' }));
    expect(screen.getByText('The evidence shows this problem was not present.')).toBeInTheDocument();
  });

  it('shows a pending revision beside the statement still in force', () => {
    renderProblem(
      investigating({
        problem_status: 'revision_pending',
        pending_revision: 'Checkout pods restart on liveness failures, not OOM',
      })
    );

    expect(screen.getByText(STATEMENT).className).not.toContain('line-through');
    expect(
      screen.getByText(
        'Revision awaiting your confirmation: Checkout pods restart on liveness failures, not OOM'
      )
    ).toBeInTheDocument();
  });

  it('shows where a revised statement started', () => {
    renderProblem(
      investigating({
        problem_status: 'verified',
        original_problem_statement: 'Checkout is slow',
      })
    );

    expect(screen.getByText(STATEMENT)).toBeInTheDocument();
    expect(screen.getByText('Originally reported as: Checkout is slow')).toBeInTheDocument();
  });

  it.each([
    ['unverified', { problem_status: 'unverified' }],
    ['no status', { problem_status: null }],
    ['no verification', null],
    // A server newer than this build: renders as before rather than breaking.
    ['an unknown status', { problem_status: 'reopened' }],
  ])('renders the statement as before for %s', (_label, verification) => {
    renderProblem(investigating(verification as Record<string, unknown> | null));

    expect(screen.getByText(STATEMENT).className).not.toContain('line-through');
    expect(screen.queryByText(/Not present|awaiting your confirmation|Originally reported/)).toBeNull();
  });

  it('notes a pending revision even when its wording is missing', () => {
    renderProblem(investigating({ problem_status: 'revision_pending', pending_revision: null }));
    expect(screen.getByText('A revised statement awaits your confirmation.')).toBeInTheDocument();
  });

  it('keeps "Originally reported as" for a status this build does not know', () => {
    renderProblem(
      investigating({ problem_status: 'reopened', original_problem_statement: 'Checkout is slow' })
    );
    expect(screen.getByText(STATEMENT).className).not.toContain('line-through');
    expect(screen.getByText('Originally reported as: Checkout is slow')).toBeInTheDocument();
  });

  it('truncates every line on its own, with the full text on hover', () => {
    // DetailRow's own `truncate` cannot reach into a block child, so a line
    // without it is cut off with no ellipsis.
    renderProblem(
      investigating({
        problem_status: 'invalidated',
        invalidation_finding: 'Memory never exceeded 60% of the limit.',
        original_problem_statement: 'Checkout is slow',
      })
    );
    for (const text of [
      STATEMENT,
      'Not present: Memory never exceeded 60% of the limit.',
      'Originally reported as: Checkout is slow',
    ]) {
      const line = screen.getByText(text);
      expect(line.className).toContain('truncate');
      expect(line.getAttribute('title')).toBe(text);
    }
  });

  it('applies no status to the cached description when the server sent no statement', () => {
    // The verification judges `problem_statement`; `activeCase.description`
    // is a sidebar cache that can be older.
    renderProblem({
      ...investigating({ problem_status: 'invalidated', invalidation_finding: 'not seen' }),
      problem_statement: '   ',
    });
    const cached = screen.getByText(String((activeCase as any).description ?? ''), { exact: false });
    expect(cached.className).not.toContain('line-through');
    expect(screen.queryByText(/Not present/)).toBeNull();
  });

  it('reads no verification on a resolved case, which carries none', () => {
    renderProblem({
      ...investigating(null),
      state: 'resolved',
      problem_verification: { problem_status: 'invalidated', invalidation_finding: 'ignored' },
      resolution_summary: { hypotheses_tested: 0 },
    });

    expect(screen.getByText(STATEMENT).className).not.toContain('line-through');
    expect(screen.queryByText(/Not present/)).toBeNull();
  });
});
