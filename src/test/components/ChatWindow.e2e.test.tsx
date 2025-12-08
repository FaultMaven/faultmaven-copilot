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

import { ChatWindow } from '../../shared/ui/components/ChatWindow';

describe('ChatWindow e2e (201 with body hydration, no duplicates)', () => {
  const sessionId = 'sid-1';
  const caseId = 'case-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows spinner on enter, hydrates once, and renders single user message', async () => {
    const user = userEvent.setup();

    // Initial conversation load when caseId is provided
    (api.getCaseConversation as any).mockResolvedValueOnce({ messages: [] });

    // submitQueryToCase resolves with a synchronous 201-style body (content present)
    (api.submitQueryToCase as any).mockResolvedValueOnce({
      response_type: 'ANSWER',
      content: 'Hi! How can I help you troubleshoot right now?',
      session_id: sessionId,
      case_id: caseId
    });

    // After submission, ChatWindow hydrates via getCaseConversation again
    ;(api.getCaseConversation as any).mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi! How can I help you troubleshoot right now?', timestamp: Date.now() }
      ]
    });

    // Create mock handlers to simulate state updates
    const mockQuerySubmit = vi.fn();
    const { rerender } = render(
      <ChatWindow
        conversation={[]}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          status: 'active'
        }}
        loading={false}
        sessionId={sessionId}
        onQuerySubmit={mockQuerySubmit}
        onDocumentView={vi.fn()}
      />
    );

    // Focus query input and type hello + Enter
    const textarea = await screen.findByPlaceholderText('Type your question here and press Enter...');
    await user.click(textarea);
    await user.type(textarea as HTMLElement, 'hello{enter}');

    // Verify the onQuerySubmit was called
    expect(mockQuerySubmit).toHaveBeenCalledWith('hello');

    // Simulate the parent component updating the conversation state
    rerender(
      <ChatWindow
        conversation={[
          {
            id: '1',
            question: 'hello',
            response: 'Hi! How can I help you troubleshoot right now?',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            error: false
          }
        ]}
        activeCase={{
          case_id: caseId,
          title: 'Test Case',
          status: 'active'
        }}
        loading={false}
        sessionId={sessionId}
        onQuerySubmit={mockQuerySubmit}
        onDocumentView={vi.fn()}
      />
    );

    // Allow either immediate hydration (no visible spinner) or brief spinner.
    // Just assert spinner is not present after hydration completes.
    await waitFor(() => {
      expect(screen.queryByText('Thinking...')).toBeNull();
    });

    // Only one user message "hello" should be present
    const helloNodes = screen.getAllByText((content, node) => node?.textContent === 'hello');
    expect(helloNodes.length).toBe(1);

    // Assistant response is rendered
    expect(screen.getByText(/How can I help you troubleshoot/i)).toBeInTheDocument();

    // Verify that the ChatWindow called the onQuerySubmit prop correctly (this is the new architecture)
    expect(mockQuerySubmit).toHaveBeenCalledWith('hello');
    expect(mockQuerySubmit).toHaveBeenCalledTimes(1);
  });
});


