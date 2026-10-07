/**
 * The Artifacts row's hypothesis count names what it counts.
 *
 * While investigating it is the server's count of ACTIVE hypotheses
 * (`progress.active_hypotheses`), not the length of `active_hypotheses`, which
 * is the top five by likelihood in any state. Once the case ends it is
 * `resolution_summary.hypotheses_tested`. The two used to share one label, so
 * the number read as a drop when a case resolved.
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
} as unknown as UserCase;

const summary = (id: string, state: string) => ({ hypothesis_id: id, statement: id, likelihood: 0.5, state });

const base = {
  case_id: 'case-1',
  current_turn: 5,
  investigation_turn: 5,
  title: 'OOM kills on checkout',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  problem_statement: 'Checkout pods are OOM-killed',
  uploaded_files_count: 0,
  agent_status: 'idle',
};

const renderDetails = (caseData: any) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = createStubHost();
  return render(
    <QueryClientProvider client={queryClient}>
      <CaseDetails caseData={caseData} activeCase={activeCase} expandedSection={null} onToggleSection={vi.fn()} />
    </QueryClientProvider>,
    { wrapper: hostWrapper(stub.host) }
  );
};

describe('CaseDetails — the hypothesis count in the Artifacts row', () => {
  it('counts the active hypotheses while investigating, not the summary list', () => {
    renderDetails({
      ...base,
      state: 'investigating',
      progress: { completed_indicators: [], completed_milestones: [], total_evidence: 1, active_hypotheses: 2 },
      // The top five by likelihood, in any state: three of these are not active.
      active_hypotheses: [
        summary('h1', 'active'),
        summary('h2', 'active'),
        summary('h3', 'refuted'),
        summary('h4', 'retired'),
        summary('h5', 'inconclusive'),
      ],
    });
    expect(screen.getByText(/2 active hypotheses/)).toBeInTheDocument();
    expect(screen.queryByText(/5 (active )?hypotheses/)).toBeNull();
  });

  it('says one active hypothesis in the singular', () => {
    renderDetails({
      ...base,
      state: 'investigating',
      progress: { completed_indicators: [], completed_milestones: [], total_evidence: 1, active_hypotheses: 1 },
      active_hypotheses: [summary('h1', 'active')],
    });
    expect(screen.getByText(/1 active hypothesis\b/)).toBeInTheDocument();
  });

  it('labels the terminal count as tested', () => {
    renderDetails({
      ...base,
      state: 'resolved',
      resolution_summary: { evidence_collected: 2, hypotheses_tested: 3, total_duration_minutes: 0 },
    });
    expect(screen.getByText(/3 hypotheses tested/)).toBeInTheDocument();
    expect(screen.queryByText(/active hypothes/)).toBeNull();
  });

  it('shows no count while none is active', () => {
    renderDetails({
      ...base,
      state: 'investigating',
      progress: { completed_indicators: [], completed_milestones: [], total_evidence: 1, active_hypotheses: 0 },
      active_hypotheses: [summary('h3', 'refuted')],
    });
    expect(screen.queryByText(/hypothes(is|es)\b(?! tested)/)).toBeNull();
    expect(screen.queryByText(/active hypothes/)).toBeNull();
  });
});
