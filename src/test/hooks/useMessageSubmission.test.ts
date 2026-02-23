import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageSubmission } from '../../shared/ui/hooks/useMessageSubmission';
import * as api from '../../lib/api';
import { pendingOpsManager, OptimisticIdGenerator } from '../../lib/optimistic';

// Mock dependencies
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        set: vi.fn()
      }
    }
  }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  authManager: {
    isAuthenticated: vi.fn().mockResolvedValue(true)
  },
  generateCaseTitle: vi.fn()
}));

vi.mock('../../lib/optimistic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/optimistic')>();
  return {
    ...actual,
    pendingOpsManager: {
      add: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      remove: vi.fn()
    },
    OptimisticIdGenerator: {
      generateMessageId: vi.fn().mockReturnValue('mock-message-id'),
      generateCaseId: vi.fn().mockReturnValue('mock-case-id')
    }
  };
});

// Mock logger
vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

// Mock retry logic to execute immediately
vi.mock('../../lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn) => fn())
}));

describe('useMessageSubmission', () => {
  const mockProps = {
    sessionId: 'session-123',
    activeCaseId: 'case-123',
    hasUnsavedNewChat: false,
    conversations: {},
    titleSources: {} as Record<string, 'user' | 'backend' | 'system'>,
    setActiveCaseId: vi.fn(),
    setHasUnsavedNewChat: vi.fn(),
    setConversations: vi.fn(),
    setActiveCase: vi.fn(),
    setOptimisticCases: vi.fn(),
    setConversationTitles: vi.fn(),
    setTitleSources: vi.fn(),
    setInvestigationProgress: vi.fn(),
    createOptimisticCaseInBackground: vi.fn(),
    refreshSession: vi.fn(),
    showError: vi.fn(),
    showErrorWithRetry: vi.fn(),
    showConflictResolution: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (OptimisticIdGenerator.generateMessageId as any)
      .mockReturnValueOnce('user-msg-id')
      .mockReturnValueOnce('ai-msg-id');
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useMessageSubmission(mockProps));
    expect(result.current.submitting).toBe(false);
  });

  it('should handle successful query submission via submitTurn', async () => {
    const { result } = renderHook(() => useMessageSubmission(mockProps));

    // Mock successful TurnResponse
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'AI Response',
      turn_number: 1,
      milestones_completed: [],
      case_status: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // 1. Optimistic updates
    expect(result.current.submitting).toBe(false); // Should unlock after completion
    expect(mockProps.setConversations).toHaveBeenCalled(); // Updated optimistically
    expect(pendingOpsManager.add).toHaveBeenCalled();

    // 2. API Call - now uses submitTurn with TurnRequest
    expect(api.submitTurn).toHaveBeenCalledWith('case-123', expect.objectContaining({
      query: 'test query',
    }));

    // 3. Success handling
    expect(pendingOpsManager.complete).toHaveBeenCalledWith('ai-msg-id');
  });

  it('should create new case if no active case exists', async () => {
    const propsNoCase = { ...mockProps, activeCaseId: undefined };
    const { result } = renderHook(() => useMessageSubmission(propsNoCase));

    (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt-case-id');
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Response',
      turn_number: 1,
      milestones_completed: [],
      case_status: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // null triggers backend auto-generation of Case-MMDD-N format
    expect(propsNoCase.createOptimisticCaseInBackground).toHaveBeenCalledWith('opt-case-id', null);
    expect(propsNoCase.setActiveCaseId).toHaveBeenCalledWith('opt-case-id');
  });

  it('should handle API errors gracefully', async () => {
    const { result } = renderHook(() => useMessageSubmission(mockProps));

    // Mock API failure
    (api.submitTurn as any).mockRejectedValue(new Error('Network Error'));

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // Wait for retries to complete and failure to be handled
    await waitFor(() => {
      expect(pendingOpsManager.fail).toHaveBeenCalledWith('ai-msg-id', expect.stringContaining('Network Error'));
    });

    // Should show error to user
    expect(mockProps.showErrorWithRetry).toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  it('should block submission if already submitting', async () => {
    const { result } = renderHook(() => useMessageSubmission(mockProps));

    // Start a submission that doesn't resolve immediately
    (api.submitTurn as any).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      result.current.handleQuerySubmit('first query');
    });

    expect(result.current.submitting).toBe(true);

    // Try second submission
    await act(async () => {
      await result.current.handleQuerySubmit('second query');
    });

    // Should not call API again
    expect(api.submitTurn).toHaveBeenCalledTimes(1);
  });

  it('should block submission if not authenticated', async () => {
    (api.authManager.isAuthenticated as any).mockResolvedValue(false);
    const { result } = renderHook(() => useMessageSubmission(mockProps));

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    expect(api.submitTurn).not.toHaveBeenCalled();
  });
});
