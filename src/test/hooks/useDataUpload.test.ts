import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataUpload } from '../../shared/ui/hooks/useDataUpload';
import * as api from '../../lib/api';
import { useAppStore } from '../../lib/state/store';

const mockShowError = vi.fn();

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { set: vi.fn(), remove: vi.fn() } } }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn()
}));

vi.mock('../../lib/errors', () => ({
  useError: () => ({
    showError: mockShowError,
    showErrorWithRetry: vi.fn(),
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

vi.mock('../../lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn())
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  })
}));

describe('useDataUpload — error surfacing regression guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowError.mockClear();

    // Set initial Zustand store state for the test
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: 'case-123',
      conversations: { 'case-123': [] },
      titleSources: {},
      conversationTitles: {},
      optimisticCases: [],
      pinnedCases: new Set(),
      caseEvidence: {}
    });
  });

  it('calls showError when submitTurn throws (e.g. 504 timeout)', async () => {
    (api.submitTurn as any).mockRejectedValue(
      Object.assign(new Error('Request timeout - processing is taking longer than expected. Please try again.'), {
        status: 504
      })
    );

    const { result } = renderHook(() => useDataUpload());

    let submissionResult: { success: boolean; message: string } | undefined;
    await act(async () => {
      submissionResult = await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    // The user-facing surface: global toast must fire.
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'turn_submit' })
    );

    // And the existing contract with UnifiedInputBar stays intact.
    expect(submissionResult?.success).toBe(false);
    expect(submissionResult?.message).toBeTruthy();
  });
});
