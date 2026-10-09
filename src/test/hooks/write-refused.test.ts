/**
 * 403 on a turn (fm#1898): the server's own word that this viewer may not write
 * the case. Driven down to `authenticatedFetch`, stubbing only the wire.
 *
 * The ownership the client held was stale or unknown, so the refusal is read
 * against the case row: a row naming another owner makes the case read-only and
 * keeps the shared-case notice in the bubble; a row naming the viewer means the
 * refusal was something else, so the composer is left alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { SHARED_READ_ONLY_NOTICE } from '@faultmaven/copilot-ui/lib/cases/ownership';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
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
const CASE_URL = `${BASE}/api/v1/cases/${CASE}`;
const TURNS_URL = `${CASE_URL}/turns`;

const wire = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
});

const row = (ownerId: string) => ({
  case_id: CASE,
  title: 'Test',
  state: 'investigating',
  closure_reason: null,
  closed_at: null,
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  user_id: ownerId,
  enterprise_id: 'e1',
});

/** Turn POSTs get a 403; the case read-back names `ownerId`. */
function route(ownerId: string) {
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === TURNS_URL && method === 'POST') return Promise.resolve(wire(403, { detail: 'Not the case owner' }));
    if (url === CASE_URL && method === 'GET') return Promise.resolve(wire(200, row(ownerId)));
    return Promise.reject(new Error(`unrouted ${method} ${url}`));
  });
}

const rows = (): OptimisticConversationItem[] => useAppStore.getState().conversations[CASE] ?? [];
const assistant = () => rows().find((r) => !r.question);
const denied = () => useAppStore.getState().writeDeniedCaseIds[CASE] === true;

describe('403 on a turn', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    pendingOpsManager.clear();
    stub = createStubHost();
    setHostStore(stub.store);
    setApiTransport({
      baseUrl: async () => BASE,
      accessToken: async () => 'test-token',
      sessionId: async () => null,
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });
    useAppStore.setState({
      sessionId: 'session-123',
      currentUser: { id: 'u1', username: 'me', roles: [] } as never,
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      writeDeniedCaseIds: {},
      // Ownership not yet known: the placeholder a freshly opened case carries.
      activeCase: {
        case_id: CASE,
        title: 'Test',
        state: 'investigating',
        created_at: '2026-10-09T09:00:00Z',
        owner_id: '',
        enterprise_id: '',
        closure_reason: null,
        closed_at: null,
        message_count: 0,
      },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700_000);
    });
  };

  it('message path: another owner → read-only message, case marked, no Retry, sent once', async () => {
    route('u2');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await settle();

    const posts = (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(
      ([u, i]) => u === TURNS_URL && i.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(assistant()?.response).toBe(SHARED_READ_ONLY_NOTICE);
    expect(assistant()).toMatchObject({ error: true, failed: false });
    expect(pendingOpsManager.getByStatus('failed')).toHaveLength(0);
    expect(denied()).toBe(true);
    expect(useAppStore.getState().activeCase?.owner_id).toBe('u2');
  });

  it('message path: the viewer owns it → the server’s message, the composer is not hidden', async () => {
    route('u1');
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit('why is the pool exhausted?');
    });
    await settle();

    expect(denied()).toBe(false);
    expect(assistant()?.response).not.toBe(SHARED_READ_ONLY_NOTICE);
    expect(assistant()?.response).toMatch(/permission/i);
  });

  it('upload path: another owner → read-only message, case marked, reported refused', async () => {
    route('u2');
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({
        query: 'read this log',
        files: [new File(['ERROR x'], 'app.log', { type: 'text/plain' })],
        inputType: 'file',
      });
    });
    await settle();

    expect(outcome).toMatchObject({ success: false, sent: true, refused: true });
    expect(assistant()?.response).toBe(SHARED_READ_ONLY_NOTICE);
    expect(denied()).toBe(true);
  });
});
