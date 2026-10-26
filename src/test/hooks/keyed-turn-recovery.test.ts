/**
 * A keyed turn whose response is lost or delayed is RECOVERED, not retyped
 * (contract 12.2.0, faultmaven#1903 / #1888).
 *
 * These drive the real chain — `useMessageSubmission` → `resilientOperation`
 * with the keyed-turn policy → `submitTurn` → `authenticatedFetch` — and stub
 * only the wire (`fetchWithTimeout`), so what is asserted is what the server
 * would receive: the same `Idempotency-Key` and the same form on every attempt.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSubmission } from '@faultmaven/copilot-ui/shared/ui/hooks/useMessageSubmission';
import { useDataUpload } from '@faultmaven/copilot-ui/shared/ui/hooks/useDataUpload';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setApiTransport, type AuthOutcome } from '@faultmaven/copilot-ui/lib/api/transport';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import {
  CredentialUnavailableError,
  TimeoutError,
  TurnInProgressError,
  TurnTimedOutError,
  TurnReplayUnavailableError,
  UserFacingError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import { capabilitiesManager, type CapabilitiesManager } from '@faultmaven/copilot-ui/lib/capabilities';
import { deriveTurnTiming } from '@faultmaven/copilot-ui/lib/utils/turn-timing';
import { submitTurn } from '@faultmaven/copilot-ui/lib/api/services/case-service';
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
const replayUnavailable = () =>
  wire(409, { detail: 'committed; reload the case' }, { 'x-error-code': 'IDEMPOTENCY_REPLAY_UNAVAILABLE' });
const later = <T,>(ms: number, value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), ms));
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
function routeWire(turns: TurnHandler[], messages: unknown[] | TurnHandler = BACKEND_ROWS) {
  let next = 0;
  fetchWithTimeout.mockImplementation((url: string, init: RequestInit = {}) => {
    if (url === TURNS_URL && init.method === 'POST') {
      const handler = turns[Math.min(next, turns.length - 1)];
      next += 1;
      return handler();
    }
    if (url.startsWith(`${BASE}/api/v1/cases/${CASE}/messages`)) {
      if (typeof messages === 'function') return messages();
      return Promise.resolve(wire(200, { messages, total_count: messages.length }));
    }
    if (url === `${BASE}/api/v1/cases/${CASE}`) {
      return Promise.resolve(wire(200, CASE_ROW));
    }
    return Promise.reject(new Error(`unrouted ${init.method ?? 'GET'} ${url}`));
  });
}

const messageGets = () =>
  (fetchWithTimeout.mock.calls as [string, RequestInit][]).filter(([url]) =>
    url.startsWith(`${BASE}/api/v1/cases/${CASE}/messages`),
  );

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
  let refreshIfStale: MockInstance<CapabilitiesManager['refreshIfStale']>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // A module singleton that outlives a render.
    pendingOpsManager.clear();
    // The capabilities re-read before a turn is not under test here, and the
    // wire routes only turns: stub it so no unrouted capabilities GET goes out.
    refreshIfStale = vi.spyOn(capabilitiesManager, 'refreshIfStale').mockResolvedValue(undefined);
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
    const complete = vi.spyOn(pendingOpsManager, 'complete');

    await submit();
    await advance(5000);

    expect(turnPosts()).toHaveLength(1);
    expect(refreshActiveCase).toHaveBeenCalledWith(CASE);
    // The turn committed: its pending op is done, not failed (no Retry).
    expect(complete).toHaveBeenCalledWith(keyOf(turnPosts()[0][1]));
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
    const complete = vi.spyOn(pendingOpsManager, 'complete');
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    let outcome: { success: boolean; sent: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.handleTurnSubmit({ query: 'why is the pool exhausted?' });
    });
    await advance(10);
    expect(complete).toHaveBeenCalledWith(keyOf(turnPosts()[0][1]));

    expect(outcome).toMatchObject({ success: true, sent: true });
    expect(turnPosts()).toHaveLength(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TurnReplayUnavailableError);
    expect(rows().map((r) => r.id)).toEqual(['msg_u1', 'msg_a1']);
  });
  it('504 LLM_TIMEOUT: retried once, not to the deadline (each retry is a new LLM run)', async () => {
    routeWire([
      async () => wire(504, { detail: 'The AI provider timed out.' }, { 'x-error-code': 'LLM_TIMEOUT', 'Retry-After': '30' }),
    ]);
    await submit();
    await advance(700_000);
    expect(turnPosts()).toHaveLength(2);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TimeoutError);
  });

  it('504 REQUEST_TIMEOUT: no automatic retry; the nothing-was-saved message at once', async () => {
    routeWire([
      async () => wire(504, { detail: 'The turn ran out of time and nothing was saved.' }, { 'x-error-code': 'REQUEST_TIMEOUT' }),
    ]);
    await submit();
    await advance(700_000);
    expect(turnPosts()).toHaveLength(1);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TurnTimedOutError);
  });

  it('504 LLM_TIMEOUT: the single retry waits Retry-After', async () => {
    routeWire([
      async () => wire(504, { detail: 'The AI provider timed out.' }, { 'x-error-code': 'LLM_TIMEOUT', 'Retry-After': '30' }),
      async () => replay(),
    ]);
    await submit();
    await advance(29_000);
    expect(turnPosts()).toHaveLength(1);
    await advance(2_000);
    expect(turnPosts()).toHaveLength(2);
    expect(responses().map((r) => r.response)).toEqual(['The pool is exhausted.']);
  });

  it('sends the turn with the request timeout derived from the published bound', async () => {
    const timingFor = vi
      .spyOn(capabilitiesManager, 'getTurnTiming')
      .mockImplementation((_apiUrl, bytes = 0) => deriveTurnTiming(150, bytes));
    routeWire([async () => replay()]);
    await submit();
    const [[, , timeoutMs]] = (fetchWithTimeout.mock.calls as [string, RequestInit, number][]).filter(
      ([url, init]) => url === TURNS_URL && init.method === 'POST',
    );
    expect(timeoutMs).toBe(211_000); // 150 + 60 + ceil(26 / 125000) s
    // The bound is the one published by the server the turn goes to (#324):
    // that server is the one re-read, and the one asked about.
    expect(refreshIfStale).toHaveBeenCalled();
    for (const [url] of refreshIfStale.mock.calls) expect(url).toBe(BASE);
    expect(timingFor).toHaveBeenCalledWith(BASE, 26);
    // And no capabilities GET reached the wire.
    expect(fetchWithTimeout.mock.calls.some(([url]) => String(url).includes('/meta/capabilities'))).toBe(false);
  });

  it('with no published bound the turn keeps the 300 s request timeout (+1 s: the 26-byte body rounds up)', async () => {
    routeWire([async () => replay()]);
    await submit();
    const [[, , timeoutMs]] = (fetchWithTimeout.mock.calls as [string, RequestInit, number][]).filter(
      ([url, init]) => url === TURNS_URL && init.method === 'POST',
    );
    expect(timeoutMs).toBe(301_000);
  });

  it('client timeouts stop at the DERIVED deadline (420 s for a 150 s bound), not the 660 s constant', async () => {
    vi.spyOn(capabilitiesManager, 'getTurnTiming').mockReturnValue(deriveTurnTiming(150));
    routeWire([
      () => new Promise<WireResponse>((_, reject) => setTimeout(() => reject(timeout()), 210_000)),
    ]);
    await submit();
    await advance(1_200_000);
    // Attempts end at 210 s and 421 s; the second ends past the 420 s deadline.
    expect(turnPosts()).toHaveLength(2);
    expect(mockShowError).toHaveBeenCalledTimes(1);
  });

  it('a final TURN_IN_PROGRESS shows its whole message, Retry advice included', async () => {
    routeWire([async () => inProgress('60')]);
    await submit();
    await advance(700_000);
    expect(mockShowError).toHaveBeenCalledTimes(1);
    const shown = mockShowError.mock.calls[0][0];
    expect(shown).toBeInstanceOf(TurnInProgressError);
    expect((shown as TurnInProgressError).userAction).toBe('Retry in a moment to get its reply.');
  });

  it('IDEMPOTENCY_KEY_REUSE: no automatic retry; the manual Retry goes out under a FRESH key', async () => {
    routeWire([
      async () => wire(409, { detail: 'key reused' }, { 'x-error-code': 'IDEMPOTENCY_KEY_REUSE' }),
      async () => replay(),
    ]);
    await submit();
    await advance(5000);
    expect(turnPosts()).toHaveLength(1);
    const firstKey = keyOf(turnPosts()[0][1]);

    await act(async () => {
      await pendingOpsManager.retry(firstKey);
    });
    const posts = turnPosts();
    expect(posts).toHaveLength(2);
    expect(keyOf(posts[1][1])).not.toBe(firstKey);
    expect(keyOf(posts[1][1])).toMatch(/^[A-Za-z0-9_-]{8,255}$/);
    expect(formOf(posts[1][1])).toEqual(formOf(posts[0][1]));
    expect(responses().map((r) => r.response)).toEqual(['The pool is exhausted.']);
  });

  it('IDEMPOTENCY_REPLAY_UNAVAILABLE with a delta fetch already in flight: a fresh fetch is chained, not skipped', async () => {
    // The fetch in flight was sent before the turn committed and answers
    // without it; only the chained one can see it.
    let gets = 0;
    routeWire(
      [() => later(100, replayUnavailable)],
      () => {
        gets += 1;
        const rowsNow = gets === 1 ? [] : BACKEND_ROWS;
        return later(gets === 1 ? 1000 : 10, () => wire(200, { messages: rowsNow, total_count: rowsNow.length }));
      },
    );
    await submit();
    act(() => {
      useAppStore.getState().handleCaseSelect(CASE);
    });
    await advance(2000);

    expect(messageGets()).toHaveLength(2);
    expect(rows().map((r) => r.id)).toEqual(['msg_u1', 'msg_a1']);
  });

  it('IDEMPOTENCY_REPLAY_UNAVAILABLE whose read fails: the message stays, saying the turn was saved', async () => {
    routeWire([async () => replayUnavailable()], () => Promise.reject(new TypeError('Failed to fetch')));
    await submit();
    await advance(5000);

    expect(messageGets().length).toBeGreaterThan(0);
    expect(questions().map((r) => r.question)).toEqual(['why is the pool exhausted?']);
    const ai = responses()[0];
    expect(ai.response).toBe(new TurnReplayUnavailableError('x').bubbleText);
    expect(ai.loading).toBe(false);
    expect(mockShowError.mock.calls[0][0]).toBeInstanceOf(TurnReplayUnavailableError);
  });

  it('upload path: a final TURN_IN_PROGRESS says the file "may not have been added"', async () => {
    routeWire([async () => inProgress('60')]);
    const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      const pending = result.current.handleTurnSubmit({ query: '', files: [file], inputType: 'file', queryIsGenerated: true });
      await vi.advanceTimersByTimeAsync(700_000);
      await pending;
    });
    const failed = rows().find((r) => r.failed);
    expect(failed?.response).toContain('may not have been added');
    expect(failed?.response).not.toContain('was not added');
  });
  it('upload path: IDEMPOTENCY_KEY_REUSE, then the banner Retry goes out under a FRESH key', async () => {
    routeWire([
      async () => wire(409, { detail: 'key reused' }, { 'x-error-code': 'IDEMPOTENCY_KEY_REUSE' }),
      async () => replay(),
    ]);
    const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      await result.current.handleTurnSubmit({ query: 'why is the pool exhausted?' });
    });
    expect(turnPosts()).toHaveLength(1);
    const firstKey = keyOf(turnPosts()[0][1]);

    await act(async () => {
      await pendingOpsManager.retry(firstKey);
    });
    expect(turnPosts()).toHaveLength(2);
    expect(keyOf(turnPosts()[1][1])).not.toBe(firstKey);
  });

  // The host could not renew a credential and the session goes on (faultmaven#1460).
  describe("a host that answers 'unavailable'", () => {
    const onUnauthorized = vi.fn(async (): Promise<AuthOutcome> => 'unavailable');
    const refused = () => wire(401, { detail: 'Could not validate credentials' });
    beforeEach(() => {
      onUnauthorized.mockClear();
      setApiTransport({
        baseUrl: async () => BASE,
        accessToken: async () => 'test-token',
        sessionId: async () => null,
        clearSession: async () => undefined,
        onUnauthorized,
      });
    });

    it('a 202 turn whose poll is refused stops after one renewal', async () => {
      const JOB = `${BASE}/api/v1/jobs/job-1`;
      fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
        if (url === TURNS_URL && init.method === 'POST') return wire(202, {}, { Location: '/api/v1/jobs/job-1' });
        if (url === JOB) return refused();
        throw new Error(`unrouted ${url}`);
      });
      let outcome: unknown;
      submitTurn(CASE, { query: 'why?' }).catch((error: unknown) => { outcome = error; });

      await advance(60_000);

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(fetchWithTimeout.mock.calls.filter(([url]) => url === JOB)).toHaveLength(1);
      expect(outcome).toBeInstanceOf(CredentialUnavailableError);
    });

    it('upload path: an ambiguous attempt, then a refused one, says the file "may not have been added"', async () => {
      routeWire([async () => Promise.reject(timeout()), async () => refused()]);
      const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
      const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
      await act(async () => {
        const pending = result.current.handleTurnSubmit({ query: '', files: [file], inputType: 'file', queryIsGenerated: true });
        await vi.advanceTimersByTimeAsync(60_000);
        await pending;
      });

      expect(onUnauthorized).toHaveBeenCalled();
      const failed = rows().find((r) => r.failed);
      expect(failed?.response).toContain('may not have been added');
    });

    // The mint refused with no 'ended' verdict: the re-send after 'refreshed',
    // and the client-id recovery mint, which asks the host nothing.
    it.each([
      ['the re-send after a refreshed credential', [401, 401]],
      ['the client-id recovery mint', [401, 404, 401]],
    ])('upload path: a mint refused on %s shows the connection copy, not a sign-out', async (_label, statuses) => {
      onUnauthorized.mockImplementation(async () => 'refreshed');
      const MINT = `${BASE}/api/v1/sessions`;
      let minted = 0;
      fetchWithTimeout.mockImplementation(async (url: string) => {
        if (url === MINT) return wire(statuses[Math.min(minted++, statuses.length - 1)], {});
        throw new Error(`unrouted ${url}`);
      });
      await useAppStore.getState().initializeSession(true, 'u1');
      minted = 0;
      useAppStore.setState({ sessionId: null });
      const file = new File(['ERROR x'], 'app.log', { type: 'text/plain' });
      const { result } = renderHook(() => useDataUpload(), { wrapper: hostWrapper(stub.host) });
      try {
        await act(async () => {
          await result.current.handleTurnSubmit({ query: 'why?', files: [file], inputType: 'file' });
        });

        const shown = mockShowError.mock.calls[0][0] as UserFacingError;
        expect(shown.userMessage).toContain('Unable to reach FaultMaven server');
        expect(shown.userMessage).not.toMatch(/signed out/i);
        expect(shown.userAction).toBe('Send again to retry.');
      } finally {
        await useAppStore.getState().clearSession();
      }
    });
  });

  // The host still holds the session but has no credential right now
  // (faultmaven#1460). Sent with no bearer, the case create's 401 read as an
  // expired session: six requests, then "Sign in first" (faultmaven-dashboard#257).
  it('a question whose case the host has no credential for right now: nothing sent, no sign-in advice', async () => {
    const accessToken = vi.fn(async (): Promise<string> => {
      throw new CredentialUnavailableError();
    });
    setApiTransport({
      baseUrl: async () => BASE,
      accessToken,
      sessionId: async () => 'session-123',
      clearSession: async () => undefined,
      onUnauthorized: async () => 'ended' as const,
    });
    // The server refuses a request that carries no bearer.
    fetchWithTimeout.mockImplementation(async () => wire(401, { detail: 'Not authenticated' }));
    useAppStore.setState({ activeCaseId: null, activeCase: null });

    const { result } = renderHook(() => useMessageSubmission(), { wrapper: hostWrapper(stub.host) });
    await act(async () => {
      const pending = result.current.handleQuerySubmit('why is the pool exhausted?');
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    });

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    // One host read per attempt of the action (`resilientOperation`'s 3).
    expect(accessToken).toHaveBeenCalledTimes(3);
    const shown = mockShowError.mock.calls[0][0] as UserFacingError;
    expect(shown.userMessage).toContain('Unable to reach FaultMaven server');
    expect(shown.userAction).toBe('Send again to retry.');
  });
});
