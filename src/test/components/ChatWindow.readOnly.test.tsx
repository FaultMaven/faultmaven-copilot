/**
 * A case someone else drives is read-only (fm#1898, ADR-020): every control in the
 * transcript that would submit a turn is absent or inert, not just the composer.
 * Each is a write the server answers with a 403.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } },
}));
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'investigating' }) },
}));

const headerProps = vi.hoisted(() => ({ last: null as null | { onStatusChangeRequest?: unknown } }));
vi.mock('@faultmaven/copilot-ui/shared/ui/components/case-header/EnhancedCaseHeader', () => ({
  EnhancedCaseHeader: (props: { onStatusChangeRequest?: unknown }) => {
    headerProps.last = props;
    return <div data-testid="header" />;
  },
}));

import { ChatWindow } from '@faultmaven/copilot-ui/shared/ui/components/ChatWindow';
import { ChatInterface } from '@faultmaven/copilot-ui/shared/ui/components/ChatInterface';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';
import { HostAdapterProvider } from '@faultmaven/copilot-ui/shared/host';
import { createStubHost } from '../support/host';

const activeCase = {
  case_id: 'case-1',
  title: 'Pool exhaustion',
  state: 'investigating',
  created_at: '2026-08-01T00:00:00Z',
  owner_id: 'u1',
  driver_id: 'u2',
  enterprise_id: 'e1',
  closure_reason: null,
  closed_at: null,
} as unknown as UserCase;

const conversation = [
  {
    id: 'a1',
    response: 'Restart the pool?\n\n[✅ Yes]  [❌ No]',
    timestamp: '2026-08-01T10:00:05Z',
    turn_number: 2,
    optimistic: false,
    suggestedActions: [{ type: 'DECIDE', label: 'Restart the pool', payload: 'restart', intent: undefined }],
  },
] as any[];

const stub = createStubHost();
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <HostAdapterProvider value={stub.host}>{ui}</HostAdapterProvider>
  </QueryClientProvider>
);

const chat = (readOnly: boolean) =>
  wrap(
    <ChatWindow
      conversation={conversation}
      activeCase={activeCase}
      loading={false}
      sessionId="sid"
      onQuerySubmit={vi.fn()}
      readOnly={readOnly}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  headerProps.last = null;
});

describe('ChatWindow — readOnly', () => {
  it('contrast: a writable case has Yes/No, a clickable suggestion and the status callback', () => {
    render(chat(false));
    expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart the pool' })).toBeInTheDocument();
    expect(headerProps.last?.onStatusChangeRequest).toBeTypeOf('function');
  });

  it('a read-only case has none of them', () => {
    render(chat(true));
    expect(screen.queryByRole('button', { name: /^(✅\s*)?yes/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /no$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart the pool' })).toBeNull();
    expect(headerProps.last?.onStatusChangeRequest).toBeUndefined();
    // The transcript itself is still there.
    expect(screen.getByText(/Restart the pool\?/)).toBeInTheDocument();
  });
});

describe('ChatInterface — readOnly', () => {
  const failedOp = { id: 'op1' } as any;
  const face = (readOnly: boolean) =>
    wrap(
      <ChatInterface
        activeCaseId="case-1"
        activeCase={activeCase}
        conversations={{ 'case-1': conversation }}
        loading={false}
        submitting={false}
        sessionId="sid"
        readOnly={readOnly}
        onQuerySubmit={vi.fn()}
        onTurnSubmit={vi.fn()}
        failedOperations={[failedOp]}
        onRetryFailedOperation={vi.fn()}
        onDismissFailedOperation={vi.fn()}
        getErrorMessageForOperation={() => ({ title: 'Failed', message: 'm', recoveryHint: 'h' })}
      />,
    );

  it('contrast: a writable case offers Retry on a failed operation', () => {
    render(face(false));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a read-only case does not offer Retry (a resend is a write)', () => {
    render(face(true));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('ChatWindow — memo', () => {
  // Every other prop equal: only the verdict changes. A comparator that ignored
  // it would keep the live Yes/No on screen after the case turned out to be someone else's to drive.
  it('re-renders when only readOnly flips', () => {
    const onQuerySubmit = vi.fn();
    const props = { conversation, activeCase, loading: false, sessionId: 'sid', onQuerySubmit };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (readOnly: boolean) => (
      <QueryClientProvider client={client}>
        <HostAdapterProvider value={stub.host}>
          <ChatWindow {...props} readOnly={readOnly} />
        </HostAdapterProvider>
      </QueryClientProvider>
    );
    const view = render(tree(false));
    expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument();
    view.rerender(tree(true));
    expect(screen.queryByRole('button', { name: /yes/i })).toBeNull();
  });
});
