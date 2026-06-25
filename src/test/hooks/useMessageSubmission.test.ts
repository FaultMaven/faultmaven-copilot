import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageSubmission } from '../../shared/ui/hooks/useMessageSubmission';
import * as api from '../../lib/api';
import { pendingOpsManager, OptimisticIdGenerator } from '../../lib/optimistic';
import { useAppStore } from '../../lib/state/store';

const mockShowError = vi.fn();
const mockShowErrorWithRetry = vi.fn();

// Mock dependencies
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        set: vi.fn(),
        remove: vi.fn()
      }
    }
  }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  authManager: {
    isAuthenticated: vi.fn().mockResolvedValue(true)
  },
  generateCaseTitle: vi.fn(),
  getCaseConversation: vi.fn()
}));

vi.mock('../../lib/errors', () => ({
  useError: () => ({
    showError: mockShowError,
    showErrorWithRetry: mockShowErrorWithRetry,
    dismissError: vi.fn(),
    handleError: vi.fn()
  }),
  useErrorHandler: () => ({
    errors: [],
    showError: mockShowError,
    dismissError: vi.fn(),
    dismissAll: vi.fn(),
    getErrorsByType: () => [],
    hasError: () => false,
    setRetryAction: vi.fn()
  })
}));

vi.mock('../../lib/optimistic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/optimistic')>();
  return {
    ...actual,
    pendingOpsManager: {
      add: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      remove: vi.fn(),
      getByStatus: vi.fn().mockReturnValue([])
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowError.mockClear();
    mockShowErrorWithRetry.mockClear();

    (OptimisticIdGenerator.generateMessageId as any)
      .mockReturnValueOnce('user-msg-id')
      .mockReturnValueOnce('ai-msg-id');

    // Setup Zustand store state
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      hasUnsavedNewChat: false,
      conversations: { 'case-123': [] },
      titleSources: {},
      conversationTitles: {},
      optimisticCases: [],
      pinnedCases: new Set(),
      activeCase: {
        case_id: 'case-123',
        title: 'Test',
        state: 'inquiry',
        created_at: '2026-01-01T00:00:00Z',
        owner_id: 'u1',
        organization_id: 'o1',
        closure_reason: null,
        closed_at: null,
        message_count: 0
      }
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useMessageSubmission());
    expect(result.current.submitting).toBe(false);
  });

  it('should handle successful query submission via submitTurn', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    // Mock successful TurnResponse
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'AI Response',
      turn_number: 1,
      milestones_completed: [],
      case_state: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // 1. Optimistic updates
    expect(result.current.submitting).toBe(false);
    expect(useAppStore.getState().conversations['case-123']).toHaveLength(2);
    expect(pendingOpsManager.add).toHaveBeenCalled();

    // 2. API Call - now uses submitTurn with TurnRequest
    expect(api.submitTurn).toHaveBeenCalledWith('case-123', expect.objectContaining({
      query: 'test query',
    }));

    // 3. Success handling
    expect(pendingOpsManager.complete).toHaveBeenCalledWith('ai-msg-id');
  });

  it('should sync activeCase.state from TurnResponse.case_state', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Starting the investigation.',
      turn_number: 2,
      milestones_completed: [],
      case_state: 'investigating',
      progress_made: true,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('Yes, let us investigate');
    });

    expect(useAppStore.getState().activeCase?.state).toBe('investigating');
  });

  it('should create new case if no active case exists', async () => {
    useAppStore.setState({ activeCaseId: null, hasUnsavedNewChat: true, conversations: {} });
    const { result } = renderHook(() => useMessageSubmission());

    (OptimisticIdGenerator.generateCaseId as any).mockReturnValue('opt-case-id');
    (api.createCase as any).mockResolvedValue({
      case_id: 'real-case-id',
      title: 'Case-0625-1',
      state: 'inquiry'
    });
    (api.submitTurn as any).mockResolvedValue({
      agent_response: 'Response',
      turn_number: 1,
      milestones_completed: [],
      case_state: 'inquiry',
      progress_made: false,
      is_stuck: false,
      attachments_processed: []
    });

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    expect(api.createCase).toHaveBeenCalledWith(expect.objectContaining({
      title: null
    }));
    expect(useAppStore.getState().activeCaseId).toBe('real-case-id');
  });

  it('should handle API errors gracefully', async () => {
    const { result } = renderHook(() => useMessageSubmission());

    // Mock API failure
    (api.submitTurn as any).mockRejectedValue(new Error('Network Error'));

    await act(async () => {
      await result.current.handleQuerySubmit('test query');
    });

    // Wait for retries to complete and failure to be handled
    await waitFor(() => {
      expect(pendingOpsManager.fail).toHaveBeenCalledWith('ai-msg-id', expect.stringContaining('Network Error'));
    });

    expect(mockShowError).toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });
});
