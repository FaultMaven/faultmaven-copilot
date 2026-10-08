/**
 * A keyed turn whose response is lost or delayed is RECOVERED, not retyped
 * (contract 12.2.0, faultmaven#1903 / #1888).
 *
 * These drive the real chain — `useMessageSubmission` → `resilientOperation`
 * with the keyed-turn policy → `submitTurn` → `authenticatedFetch` — and stub
 * only the wire (`fetchWithTimeout`), so what is asserted is what the server
 * would receive: the same `Idempotency-Key` and the same form on every attempt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import {
  TimeoutError,
  TurnReplayUnavailableError,
  UserFacingError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost, hostWrapper } from '../support/host';

const mockShowError = vi.fn();

vi.mock('@faultmaven/copilot-ui/lib/errors', () => ({
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
const TURNS_URL = `${BASE}/api/v1/cases/${CASE}/turns`;

interface WireResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
}

const wire = (status: number, body: unknown, headers: Record<string, string> = {}): WireResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

const TURN_RESPONSE = {
  agent_response: 'The pool is exhausted.',
  turn_number: 1,
  milestones_completed: [],
  case_state: 'inquiry',
  progress_made: false,
  is_stuck: false,
  attachments_processed: [],
};

const replay = () => wire(200, TURN_RESPONSE, { 'X-Idempotency-Replayed': 'true' });
const inProgress = (retryAfter: string) =>
  wire(409, { detail: 'A turn with this Idempotency-Key is still running' }, {
    'x-error-code': 'TURN_IN_PROGRESS',
    'Retry-After': retryAfter,
  });

/** The committed turn as `GET /messages` serves it. */
const BACKEND_ROWS = [
  { message_id: 'msg_u1', role: 'user', content: 'why is the pool exhausted?', created_at: '2026-10-08T10:00:00Z', turn_number: 1 },
  { message_id: 'msg_a1', role: 'assistant', content: 'The pool is exhausted.', created_at: '2026-10-08T10:00:05Z', turn_number: 1 },
];

const CASE_ROW = {
  case_id: CASE,
  title: 'Test',
  state: 'inquiry',
  created_at: '2026-10-08T09:00:00Z',
  updated_at: '2026-10-08T10:00:05Z',
  user_id: 'u1',
  enterprise_id: 'e1',
};

type TurnHandler = () => Promise<WireResponse>;

/** Routes the wire: turn POSTs to `turns` in order; reads to fixed answers. */
function routeWire(turns: TurnHandler[], messages: unknown[] = BACKEND_ROWS) {
  let next = 0;
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    if (url === TURNS_URL && init.method === 'POST') {
      const handler = turns[Math.min(next, turns.length - 1)];
      next += 1;
      return handler();
    }
    if (url.startsWith(`${BASE}/api/v1/cases/${CASE}/messages`)) {
      return Promise.resolve(wire(200, { messages, total_count: messages.length }));
    }
    if (url === `${BASE}/api/v1/cases/${CASE}`) {
      return Promise.resolve(wire(200, CASE_ROW));
    }
    return Promise.reject(new Error(`unrouted ${init.method ?? 'GET'} ${url}`));
  });
}

const turnPosts = (): [string, RequestInit][] =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(
    ([url, init]) => url === TURNS_URL && init.method === 'POST',
  );

const keyOf = (init: RequestInit) => (init.headers as Record<string, string>)['Idempotency-Key'];
const formOf = (init: RequestInit) => [...(init.body as FormData).entries()];

const rows = (): OptimisticConversationItem[] => useAppStore.getState().conversations[CASE] ?? [];
const questions = () => rows().filter((r) => r.question);
const responses = () => rows().filter((r) => r.response);

function timeout(): Error {
  const error = new Error('Request timed out after 300000ms');
  error.name = 'TimeoutError';
  return error;
}

describe('keyed turn recovery (contract 12.2.0)', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
      activeCaseId: CASE,
      hasUnsavedNewChat: false,
      conversations: { [CASE]: [] },
      titleSources: {},
      conversationTitles: {},
      pinnedCases: new Set(),
      activeCase: {
        case_id: CASE,
        title: 'Test',
        state: 'inquiry',
        created_at: '2026-10-08T09:00:00Z',
        owner_id: 'u1',
        enterprise_id: 'e1',
        closure_reason: null,
        closed_at: null,
        message_count: 0,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const submit = async (query = 'why is the pool exhausted?') => {
    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleQuerySubmit(query);
    });
    return result;
  };

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('TURN_IN_PROGRESS: waits Retry-After, re-sends the same key and body, renders the replay once', async () => {
    routeWire([async () => inProgress('3'), async () => replay()]);

    await submit();
    expect(turnPosts()).toHaveLength(1);

    // Still inside the server's 3 s.
    await advance(2900);
    expect(turnPosts()).toHaveLength(1);

    await advance(200);
    const posts = turnPosts();
    expect(posts).toHaveLength(2);

    const [[, first], [, second]] = posts;
    expect(keyOf(first)).toMatch(/^opt_msg_/);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(formOf(second)).toEqual(formOf(first));

    expect(questions()).toHaveLength(1);
    expect(responses().map((r) => r.response)).toEqual(['The pool is exhausted.']);
    expect(rows().some((r) => r.loading || r.failed)).toBe(false);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('client timeout: re-sends with the same key, renders the replay once', async () => {
    routeWire([async () => Promise.reject(timeout()), async () => replay()]);

    await submit();
    await advance(1000);

    const posts = turnPosts();
    expect(posts).toHaveLength(2);
    expect(keyOf(posts[1][1])).toBe(keyOf(posts[0][1]));
    expect(formOf(posts[1][1])).toEqual(formOf(posts[0][1]));
    expect(questions()).toHaveLength(1);
    expect(responses().map((r) => r.response)).toEqual(['The pool is exhausted.']);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('client timeout until the deadline: today’s timeout UX, once', async () => {
    // Every attempt hangs to the 300 s client timeout.
    routeWire([
      () => new Promise<WireResponse>((_, reject) => setTimeout(() => reject(timeout()), 300_000)),
    ]);

    await submit();
    // 0–300 s, 301–601 s, 603–903 s: no fourth attempt starts past 660 s.
    await advance(1_200_000);

    expect(turnPosts()).toHaveLength(3);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    const shown = mockShowError.mock.calls[0][0] as UserFacingError;
    expect(shown).toBeInstanceOf(TimeoutError);
    const ai = rows().find((r) => r.failed);
    expect(ai?.response).toBe(shown.userMessage);
  });

  it('IDEMPOTENCY_REPLAY_UNAVAILABLE: no retry; the case is refreshed and the turn read back', async () => {
    routeWire([
      async () =>
        wire(409, { detail: 'committed; reload the case' }, { 'x-error-code': 'IDEMPOTENCY_REPLAY_UNAVAILABLE' }),
    ]);
    const refreshActiveCase = vi.spyOn(useAppStore.getState(), 'refreshActiveCase');

    await submit();
    await advance(5000);

    expect(turnPosts()).toHaveLength(1);
    expect(refreshActiveCase).toHaveBeenCalledWith(CASE);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TurnReplayUnavailableError);
    // The local pair gave way to the committed rows: one copy, backend ids.
    expect(rows().map((r) => r.id)).toEqual(['msg_u1', 'msg_a1']);
    expect(rows().some((r) => r.failed || r.loading || r.optimistic)).toBe(false);
  });

  it('a delta merge during the wait, then the replay: one exchange, not two (A5)', async () => {
    routeWire([async () => inProgress('5'), async () => replay()]);

    await submit();
    // The pair is in flight at the predicted turn: the fixture's precondition.
    expect(rows().map((r) => [r.turn_number, r.loading, r.optimistic])).toEqual([
      [1, false, true],
      [1, true, true],
    ]);

    // Panel reopened / case switched back while the turn waits out
    // TURN_IN_PROGRESS: the delta fetch reads the turn the server committed.
    act(() => {
      useAppStore.getState().handleCaseSelect(CASE);
    });
    await advance(10);

    // Positive control: the hazard is reached. The backend copy sits beside the
    // in-flight pair, because the reconciliation skips in-flight rows.
    expect(rows().map((r) => r.id).filter((id) => id.startsWith('msg_'))).toEqual(['msg_u1', 'msg_a1']);
    expect(rows()).toHaveLength(4);

    await advance(5000);
    expect(turnPosts()).toHaveLength(2);

    expect(questions()).toHaveLength(1);
    expect(responses()).toHaveLength(1);
    expect(rows()).toHaveLength(2);
    // The pair took the backend identity, so later fetches dedup it by id.
    expect(rows().map((r) => r.id)).toEqual(['msg_u1', 'msg_a1']);
    expect(rows().some((r) => r.loading || r.optimistic || r.failed)).toBe(false);
  });
  it('upload path: TURN_IN_PROGRESS, then the replay — the same key and file, one attachment chip', async () => {
    const attachment = {
      file_id: 'file_1',
      filename: 'app.log',
      file_size: 7,
      processing_status: 'completed',
      source_type: 'file',
      upload_source: 'file',
      uploaded_at: '2026-10-08T10:00:00Z',
    };
    routeWire([
      async () => inProgress('2'),
      async () =>
        wire(200, { ...TURN_RESPONSE, attachments_processed: [attachment] }, { 'X-Idempotency-Replayed': 'true' }),
    ]);
    const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });

    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: { success: boolean } | undefined;
    await act(async () => {
      const pending = result.current.handleTurnSubmit({ query: 'read this log', files: [file], inputType: 'file' });
      await vi.advanceTimersByTimeAsync(2100);
      outcome = await pending;
    });

    expect(outcome?.success).toBe(true);
    const posts = turnPosts();
    expect(posts).toHaveLength(2);
    expect(keyOf(posts[1][1])).toBe(keyOf(posts[0][1]));
    expect(formOf(posts[1][1])).toEqual(formOf(posts[0][1]));
    expect(questions()).toHaveLength(1);
    expect(questions()[0].attachments).toHaveLength(1);
    expect(responses()).toHaveLength(1);
  });

  it('upload path: IDEMPOTENCY_REPLAY_UNAVAILABLE reloads the turn and reports it sent', async () => {
    routeWire([
      async () =>
        wire(409, { detail: 'committed; reload the case' }, { 'x-error-code': 'IDEMPOTENCY_REPLAY_UNAVAILABLE' }),
    ]);
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: { success: boolean; sent: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({ query: 'why is the pool exhausted?' });
    });
    await advance(10);

    expect(outcome).toMatchObject({ success: true, sent: true });
    expect(turnPosts()).toHaveLength(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TurnReplayUnavailableError);
    expect(rows().map((r) => r.id)).toEqual(['msg_u1', 'msg_a1']);
  });
});
