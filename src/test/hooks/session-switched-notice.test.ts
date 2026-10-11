/**
 * A turn the host refused to send because another account is signed in shows
 * the switch notice — not "Something went wrong" (#350 review).
 *
 * `SessionSwitchedError` is a NOTICE (category `notice`, recovery `none`): the
 * request was never sent and nothing failed on the user's side. The message
 * path used to hand the toast `error.userMessage`, a bare string, for every
 * recovery it did not retry; a string is classified as an `UnknownError`, so
 * the user saw a generic failure with an error icon.
 *
 * Drives the real hooks down to `authenticatedFetch`; the host's `accessToken`
 * is the one that refuses, exactly as the extension's does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { SessionSwitchedError } from '@faultmaven/copilot-ui/lib/errors/types';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost, hostWrapper } from '../support/host';

const mockShowError = vi.fn();

vi.mock('@faultmaven/copilot-ui/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/errors')>()),
  useError: () => ({ showError: mockShowError, dismissError: vi.fn() }),
}));

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const fetchWithTimeout = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/utils/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

const CASE = 'case-123';
const BASE = 'http://localhost:8090';

/** Requests that would carry a credential: everything but the unauthenticated capabilities read. */
const authenticatedSends = () =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(([url]) => !String(url).includes('/meta/capabilities'));

/** What the toast was handed, each time. */
const shown = () => mockShowError.mock.calls.map(([e]) => e);

describe('a refused send shows the account-switch notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingOpsManager.clear();
    const stub = createStubHost();
    setHostStore(stub.store);
    setApiTransport({
      baseUrl: async () => BASE,
      accessToken: async () => {
        throw new SessionSwitchedError();
      },
      sessionId: async () => null,
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });
    useAppStore.setState({
      sessionId: 'session-123',
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      activeCase: {
        case_id: CASE,
        title: 'Test',
        state: 'investigating',
        created_at: '2026-10-09T09:00:00Z',
        owner_id: 'u1',
        enterprise_id: 'e1',
        closure_reason: null,
        closed_at: null,
        message_count: 2,
      },
    });
    (globalThis as { __stub?: unknown }).__stub = stub;
  });

  const host = () => (globalThis as { __stub?: ReturnType<typeof createStubHost> }).__stub!.host;

  it('message path: nothing sent, and the toast is the notice itself', async () => {
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(host()) });
    await act(async () => {
      await result.current.handleQuerySubmit('A question');
    });

    expect(authenticatedSends()).toEqual([]);
    expect(shown().some((e) => e instanceof SessionSwitchedError)).toBe(true);
    expect(shown().some((e) => typeof e === 'string')).toBe(false);
  });

  it('upload path: nothing sent, and the toast is the notice itself', async () => {
    const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(host()) });
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
    });

    expect(authenticatedSends()).toEqual([]);
    expect(shown().length).toBeGreaterThan(0);
    // Whatever the upload path wraps it in, the notice is what reaches the user.
    expect(shown().some((e) => typeof e === 'string')).toBe(false);
    expect(
      shown().some((e) => e instanceof SessionSwitchedError || (e as { category?: string })?.category === 'notice'),
    ).toBe(true);
  });
});
