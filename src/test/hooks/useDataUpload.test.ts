import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataUpload } from '../../shared/ui/hooks/useDataUpload';
import * as api from '../../lib/api';

// Regression guard for the silent-failure class of bug — see the 131 s 504
// timeout incident. When submitTurn throws, the hook MUST call the
// injected `showError` so the global ToastContainer surfaces the failure
// to the user. Dropping this call puts the UI back into "stuck pending
// turn" limbo. showError is prop-injected (mirrors useMessageSubmission)
// so the hook stays context-agnostic; the test passes a spy directly.

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { set: vi.fn() } } }
}));

vi.mock('../../lib/api', () => ({
  submitTurn: vi.fn(),
  createCase: vi.fn(),
  generateCaseTitle: vi.fn()
}));

// Short-circuit retry so a rejected submitTurn surfaces synchronously.
vi.mock('../../lib/utils/retry', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn())
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  })
}));

describe('useDataUpload — error surfacing regression guard', () => {
  const makeProps = () => ({
    sessionId: 'session-123',
    activeCaseId: 'case-123',
    conversations: { 'case-123': [] },
    titleSources: {} as Record<string, 'user' | 'backend' | 'system'>,
    setActiveCaseId: vi.fn(),
    setHasUnsavedNewChat: vi.fn(),
    setActiveCase: vi.fn(),
    setConversations: vi.fn(),
    setConversationTitles: vi.fn(),
    setTitleSources: vi.fn(),
    setCaseEvidence: vi.fn(),
    setRefreshSessions: vi.fn(),
    showError: vi.fn()
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls showError when submitTurn throws (e.g. 504 timeout)', async () => {
    (api.submitTurn as any).mockRejectedValue(
      Object.assign(new Error('Request timeout - processing is taking longer than expected. Please try again.'), {
        status: 504
      })
    );

    const props = makeProps();
    const { result } = renderHook(() => useDataUpload(props));

    let submissionResult: { success: boolean; message: string } | undefined;
    await act(async () => {
      submissionResult = await result.current.handleTurnSubmit({ query: 'diagnose this' });
    });

    // The user-facing surface: global toast must fire.
    expect(props.showError).toHaveBeenCalledTimes(1);
    expect(props.showError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'turn_submit' })
    );

    // And the existing contract with UnifiedInputBar stays intact.
    expect(submissionResult?.success).toBe(false);
    expect(submissionResult?.message).toBeTruthy();
  });
});
