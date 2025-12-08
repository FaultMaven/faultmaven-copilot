import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    submitQueryToCase: vi.fn(),
    getCaseConversation: vi.fn(),
    updateCaseTitle: vi.fn(),
    getUserCases: vi.fn().mockResolvedValue([])
  } as unknown as typeof import('../../lib/api');
});

import { ChatInterface } from '../../shared/ui/components/ChatInterface';

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
    const mockDataUpload = vi.fn();
    const { rerender } = render(
      <ChatInterface
        activeCaseId={caseId}
        conversations={{ [caseId]: [] }}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          status: 'active'
        }}
        loading={false}
        submitting={false}
        onQuerySubmit={mockQuerySubmit}
        onDataUpload={mockDataUpload}
        failedOperations={[]}
        onRetryFailedOperation={vi.fn()}
        onDismissFailedOperation={vi.fn()}
        getErrorMessageForOperation={() => ({ title: '', message: '', recoveryHint: '' })}
      />
    );

    // Focus query input and type hello + Enter
    const textarea = await screen.findByPlaceholderText('Type a message or / command...');
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
              error: false
            }
          ]
        }}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          status: 'active'
        }}
        loading={false}
        submitting={false}
        onQuerySubmit={mockQuerySubmit}
        onDataUpload={mockDataUpload}
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
});


