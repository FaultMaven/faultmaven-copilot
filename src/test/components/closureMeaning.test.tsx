/**
 * A closed case's MEANING is the contract's, verbatim; its LABELS are ours.
 *
 * Each `ClosureReason` meaning is published by the API and vendored in
 * `types/contract-vocabularies.json` (ruling of 2026-11-02 on fm#2411).
 * CaseDetails' Closure row is the one surface that shows it. The status pill
 * and the post-terminal card show the client's labels and nothing more.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } }
}));

vi.mock('@faultmaven/copilot-ui/lib/api/files-service', () => ({
  filesApi: { getUploadedFiles: vi.fn().mockResolvedValue([]), getUploadedFileDetails: vi.fn() }
}));

import vocabularies from '@faultmaven/copilot-ui/types/contract-vocabularies.json';
import { CLOSURE_DISPLAY_INFO } from '@faultmaven/copilot-ui/lib/api/services/case-service';
import { CaseDetails } from '@faultmaven/copilot-ui/shared/ui/components/case-header/CaseDetails';
import { HeaderSummary } from '@faultmaven/copilot-ui/shared/ui/components/case-header/HeaderSummary';
import { ResolutionActionsCard } from '@faultmaven/copilot-ui/shared/ui/components/ResolutionActionsCard';
import { createStubHost, hostWrapper } from '../support/host';
import type { ClosureReason, UserCase } from '@faultmaven/copilot-ui/types/case';

const closedCase = (closure_reason: string) =>
  ({
    case_id: 'case-1',
    title: 'OOM kills on checkout',
    state: 'closed',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T01:00:00Z',
    closed_at: '2026-09-01T01:00:00Z',
    closure_reason,
  }) as unknown as UserCase;

// The Closure row shows only when the closure summary was SKIPPED.
const closedData = {
  case_id: 'case-1',
  state: 'closed',
  title: 'OOM kills on checkout',
  current_turn: 5,
  investigation_turn: 5,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T01:00:00Z',
  uploaded_files_count: 0,
  reports_available: [{ report_type: 'closure_summary', status: 'skipped' }],
} as any;

describe.each(vocabularies.ClosureReason)('a case closed as $value', ({ value, meaning }) => {
  const labels = CLOSURE_DISPLAY_INFO[value as ClosureReason];

  it('CaseDetails renders the published meaning beside the client label', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CaseDetails caseData={closedData} activeCase={closedCase(value)} expandedSection={null} onToggleSection={vi.fn()} />
      </QueryClientProvider>,
      { wrapper: hostWrapper(createStubHost().host) },
    );
    expect(container.textContent).toContain(`${labels.label} — ${meaning}`);
  });

  it('HeaderSummary and ResolutionActionsCard keep the client labels, without the meaning', () => {
    const header = render(
      <HeaderSummary caseData={closedData} activeCase={closedCase(value)} expanded={false} severity={null} onToggle={vi.fn()} />,
    ).container.textContent;
    const card = render(<ResolutionActionsCard activeCase={closedCase(value)} caseData={closedData} />).container
      .textContent;

    expect(header).toContain(`Closed - ${labels.label}`);
    expect(card).toContain(`Case Closed · ${labels.shortLabel}`);
    expect(header).not.toContain(meaning);
    expect(card).not.toContain(meaning);
  });
});
