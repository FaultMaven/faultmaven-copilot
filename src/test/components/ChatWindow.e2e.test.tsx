import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock browser API from wxt
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn()
    }
  }
}));

// Mock the API layer used by ChatWindow
import * as api from '../../lib/api';
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    createSession: vi.fn(),
    createCase: vi.fn(),
    submitTurn: vi.fn(),
    getCaseConversation: vi.fn(),
    updateCaseTitle: vi.fn(),
    getUserCases: vi.fn().mockResolvedValue([])
  } as unknown as typeof import('../../lib/api');
});

// ChatWindow imports caseApi from a separate module — mock it so the
// component's useQuery doesn't issue a real fetch in the test environment.
vi.mock('../../lib/api/case-service', () => ({
  caseApi: {
    getCaseUI: vi.fn().mockResolvedValue({ state: 'inquiry' }),
  },
}));

import { ChatInterface } from '../../shared/ui/components/ChatInterface';
import { caseApi } from '../../lib/api/case-service';

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  // Using `wrapper` means subsequent rerender() calls reuse the same provider.
  return render(ui, { wrapper: Wrapper });
};

describe('ChatInterface e2e', () => {
  const sessionId = 'sid-1';
  const caseId = 'case-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles input and renders messages', async () => {
    const user = userEvent.setup();

    // Create mock handlers to simulate state updates
    const mockQuerySubmit = vi.fn();
    const mockTurnSubmit = vi.fn();
    const { rerender } = renderWithQueryClient(
      <ChatInterface
        activeCaseId={caseId}
        conversations={{ [caseId]: [] }}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          state: 'inquiry',
          created_at: new Date().toISOString(),
          owner_id: 'user-1',
          organization_id: 'org-1',
          closure_reason: null,
          closed_at: null
        }}
        loading={false}
        submitting={false}
        sessionId={sessionId}
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
        failedOperations={[]}
        onRetryFailedOperation={vi.fn()}
        onDismissFailedOperation={vi.fn()}
        getErrorMessageForOperation={() => ({ title: '', message: '', recoveryHint: '' })}
      />
    );

    // Focus query input and type hello + Enter
    const textarea = await screen.findByPlaceholderText('Ask FaultMaven...');
    await user.click(textarea);
    await user.type(textarea as HTMLElement, 'hello{enter}');

    // Verify the onQuerySubmit was called
    expect(mockQuerySubmit).toHaveBeenCalledWith('hello');

    // Simulate the parent component updating the conversation state
    rerender(
      <ChatInterface
        activeCaseId={caseId}
        conversations={{
          [caseId]: [
            {
              id: '1',
              question: 'hello',
              response: 'Hi! How can I help you troubleshoot right now?',
              timestamp: new Date().toISOString(),
              error: false,
              optimistic: false
            }
          ]
        }}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          state: 'inquiry',
          created_at: new Date().toISOString(),
          owner_id: 'user-1',
          organization_id: 'org-1',
          closure_reason: null,
          closed_at: null
        }}
        loading={false}
        submitting={false}
        sessionId={sessionId}
        onQuerySubmit={mockQuerySubmit}
        onTurnSubmit={mockTurnSubmit}
        failedOperations={[]}
        onRetryFailedOperation={vi.fn()}
        onDismissFailedOperation={vi.fn()}
        getErrorMessageForOperation={() => ({ title: '', message: '', recoveryHint: '' })}
      />
    );

    // Only one user message "hello" should be present
    const helloNodes = screen.getAllByText((content, node) => node?.textContent === 'hello');
    expect(helloNodes.length).toBe(1);

    // Assistant response is rendered
    expect(screen.getByText(/How can I help you troubleshoot/i)).toBeInTheDocument();
  });

  it('serves the case-UI snapshot from cache on remount with the same caseId', async () => {
    // Single QueryClient shared across both renders so the cache persists
    // (matches production: in the extension, the QueryClient lives at the
    // sidepanel entry point and survives ChatWindow remounts). staleTime
    // matches the production global default so a fresh cache entry is not
    // considered stale within the test window.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 1000 * 60 * 5, retry: false },
      },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const props = {
      activeCaseId: caseId,
      conversations: { [caseId]: [] },
      activeCase: {
        case_id: caseId,
        title: 'Test Case',
        state: 'inquiry' as const,
        created_at: new Date().toISOString(),
        owner_id: 'user-1',
        organization_id: 'org-1',
        closure_reason: null,
        closed_at: null,
      },
      loading: false,
      submitting: false,
      sessionId,
      onQuerySubmit: vi.fn(),
      onTurnSubmit: vi.fn(),
      failedOperations: [],
      onRetryFailedOperation: vi.fn(),
      onDismissFailedOperation: vi.fn(),
      getErrorMessageForOperation: () => ({ title: '', message: '', recoveryHint: '' }),
    };

    const mockedGetCaseUI = vi.mocked(caseApi.getCaseUI);

    // First mount: the snapshot fetch should fire exactly once.
    const { unmount } = render(<ChatInterface {...props} />, { wrapper: Wrapper });
    await waitFor(() => expect(mockedGetCaseUI).toHaveBeenCalledTimes(1));

    // Unmount then remount with the same caseId. With a stable queryKey and
    // shared QueryClient, the cache must serve the second mount — no new
    // fetch. Regression guard: if anyone destabilises the queryKey (e.g.
    // adds a Date.now() to it) this assertion fails.
    unmount();
    render(<ChatInterface {...props} />, { wrapper: Wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockedGetCaseUI).toHaveBeenCalledTimes(1);
  });
});


