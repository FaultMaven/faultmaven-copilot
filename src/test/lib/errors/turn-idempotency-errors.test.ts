/**
 * Contract 12.2.0 (faultmaven#1903): the turn route's idempotency 409s, the
 * Retry-After they carry, and the keyed-turn retry policy that acts on them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorClassifier } from '@faultmaven/copilot-ui/lib/errors/classifier';
import {
  CaseVersionConflictError,
  IdempotencyKeyReuseError,
  RateLimitError,
  TimeoutError,
  TurnInProgressError,
  TurnReplayUnavailableError,
  hasServerDirectedWait,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { resilientOperation } from '@faultmaven/copilot-ui/lib/utils/resilient-operation';
import {
  KEYED_TURN_DEADLINE_MS,
  idempotencyKeyFor,
  keyedTurnRetryPolicy,
  rotateIdempotencyKey,
  turnTimeoutKind,
} from '@faultmaven/copilot-ui/lib/utils/keyed-turn-retry';
import { createHttpErrorFromResponse } from '@faultmaven/copilot-ui/lib/errors/http-error';
import { isAmbiguousFailure, unsentAttachmentsNotice } from '@faultmaven/copilot-ui/lib/state/unsent-attachments';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** The error `authenticatedFetch` throws for a non-OK response. */
function httpError(
  status: number,
  headers: Record<string, string> = {},
  retryAfter?: number,
): Error {
  const error = new Error(`HTTP ${status}`) as Error & {
    status: number;
    headers?: Record<string, string>;
    retryAfter?: number;
  };
  error.name = 'HTTPError';
  error.status = status;
  if (Object.keys(headers).length > 0) error.headers = headers;
  if (retryAfter !== undefined) error.retryAfter = retryAfter;
  return error;
}

function clientTimeout(): Error {
  const error = new Error('Request timed out after 300000ms');
  error.name = 'TimeoutError';
  return error;
}

describe('ErrorClassifier — the 409s of contract 12.2.0, by x-error-code', () => {
  it('TURN_IN_PROGRESS → TurnInProgressError, auto-retried after Retry-After', () => {
    const classified = ErrorClassifier.classify(
      httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS' }, 3),
    );
    expect(classified).toBeInstanceOf(TurnInProgressError);
    expect(classified).not.toBeInstanceOf(CaseVersionConflictError);
    expect(classified.recovery).toBe('auto_retry_with_delay');
    expect((classified as TurnInProgressError).retryAfterMs).toBe(3000);
  });

  it('TURN_IN_PROGRESS clamps Retry-After to [1, 60] s and defaults to 2 s', () => {
    const wait = (retryAfter?: number) =>
      (ErrorClassifier.classify(
        httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS' }, retryAfter),
      ) as TurnInProgressError).retryAfterMs;
    expect(wait(0)).toBe(1000);
    expect(wait(170)).toBe(60_000);
    expect(wait(undefined)).toBe(2000);
  });

  it('TURN_IN_PROGRESS reads a snapshotted retry-after header (createHttpErrorFromResponse)', () => {
    const classified = ErrorClassifier.classify(
      httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS', 'retry-after': '7' }),
    );
    expect((classified as TurnInProgressError).retryAfterMs).toBe(7000);
  });

  it('IDEMPOTENCY_KEY_REUSE → IdempotencyKeyReuseError: a manual Retry, never an automatic one', () => {
    const classified = ErrorClassifier.classify(
      httpError(409, { 'x-error-code': 'IDEMPOTENCY_KEY_REUSE' }),
    );
    expect(classified).toBeInstanceOf(IdempotencyKeyReuseError);
    expect(classified.recovery).toBe('manual_retry');
  });

  it('IDEMPOTENCY_REPLAY_UNAVAILABLE → TurnReplayUnavailableError, never retried', () => {
    const classified = ErrorClassifier.classify(
      httpError(409, { 'x-error-code': 'IDEMPOTENCY_REPLAY_UNAVAILABLE' }),
    );
    expect(classified).toBeInstanceOf(TurnReplayUnavailableError);
    expect(classified.recovery).toBe('graceful_degradation');
    // The toast says the reload is under way; the bubble keeps "reload" for
    // when it does not land.
    expect(classified.userAction).toBe('Its reply is being loaded from the case.');
    expect((classified as TurnReplayUnavailableError).bubbleText).toContain('Reload the case to see it.');
  });

  it('CASE_VERSION_CONFLICT keeps today’s mapping, versions included', () => {
    const classified = ErrorClassifier.classify(
      httpError(409, {
        'x-error-code': 'CASE_VERSION_CONFLICT',
        'x-expected-version': '4',
        'x-actual-version': '5',
      }),
    );
    expect(classified).toBeInstanceOf(CaseVersionConflictError);
    expect(classified.recovery).toBe('manual_retry');
    expect((classified as CaseVersionConflictError).expectedVersion).toBe(4);
    expect((classified as CaseVersionConflictError).actualVersion).toBe(5);
  });

  it('an unlabelled 409 (a terminal case) keeps today’s mapping', () => {
    const classified = ErrorClassifier.classify(httpError(409));
    expect(classified).toBeInstanceOf(CaseVersionConflictError);
    expect(classified.recovery).toBe('manual_retry');
  });

  it('TimeoutError stays manual_retry for every request (only the keyed-turn policy retries it)', () => {
    expect(ErrorClassifier.classify(clientTimeout())).toBeInstanceOf(TimeoutError);
    expect(ErrorClassifier.classify(clientTimeout()).recovery).toBe('manual_retry');
    expect(ErrorClassifier.classify(httpError(504)).recovery).toBe('manual_retry');
  });

  it('both server-directed waits share one interface', () => {
    expect(hasServerDirectedWait(new TurnInProgressError('x', 3000))).toBe(true);
    expect(hasServerDirectedWait(new RateLimitError('x', 3000))).toBe(true);
    expect(hasServerDirectedWait(new TimeoutError('x'))).toBe(false);
  });
});

describe('turnTimeoutKind — the 504 split', () => {
  it('tells a client timeout, an uncoded gateway 504 and a coded 504 apart', () => {
    expect(turnTimeoutKind(clientTimeout())).toBe('client');
    expect(turnTimeoutKind(httpError(504))).toBe('gateway');
    expect(turnTimeoutKind(httpError(504, { 'x-error-code': 'REQUEST_TIMEOUT' }, 30))).toBe('server_timeout');
    expect(turnTimeoutKind(httpError(504, { 'x-error-code': 'LLM_TIMEOUT' }, 30))).toBe('server_timeout');
    // A code this build does not know is not a gateway's 504.
    expect(turnTimeoutKind(httpError(504, { 'x-error-code': 'SOMETHING_NEW' }))).toBeNull();
    expect(turnTimeoutKind(httpError(408))).toBeNull();
    expect(turnTimeoutKind(httpError(500))).toBeNull();
  });
});

describe('resilientOperation with the keyed-turn policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const run = (operation: () => Promise<string>, withPolicy = true) =>
    resilientOperation({
      operation,
      context: { operation: 'message_submission' },
      idempotent: true,
      ...(withPolicy ? keyedTurnRetryPolicy() : {}),
    });

  it('waits Retry-After on TURN_IN_PROGRESS before re-sending', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS' }, 5))
      .mockResolvedValueOnce('replayed');

    const result = run(operation);
    await vi.advanceTimersByTimeAsync(4900);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe('replayed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries a client timeout and a gateway 504 (without the policy: neither)', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(clientTimeout())
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce('replayed');
    const result = run(operation);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('replayed');
    expect(operation).toHaveBeenCalledTimes(3);

    const bare = vi.fn<() => Promise<string>>().mockRejectedValue(clientTimeout());
    const caught = run(bare, false).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toBeInstanceOf(TimeoutError);
    expect(bare).toHaveBeenCalledTimes(1);
  });

  it('retries a 504 REQUEST_TIMEOUT at most once', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(httpError(504, { 'x-error-code': 'REQUEST_TIMEOUT' }, 30));
    const caught = run(operation).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toBeInstanceOf(TimeoutError);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries a 504 LLM_TIMEOUT at most once (each retry is a new LLM run)', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(httpError(504, { 'x-error-code': 'LLM_TIMEOUT' }, 30));
    const caught = run(operation).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toBeInstanceOf(TimeoutError);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('one retry in all across REQUEST_TIMEOUT and LLM_TIMEOUT', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(504, { 'x-error-code': 'LLM_TIMEOUT' }, 30))
      .mockRejectedValue(httpError(504, { 'x-error-code': 'REQUEST_TIMEOUT' }, 30));
    const caught = run(operation).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    await caught;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('a 504 with an unknown code keeps today’s behaviour: no automatic retry', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(httpError(504, { 'x-error-code': 'SOMETHING_NEW' }));
    const caught = run(operation).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await caught).toBeInstanceOf(TimeoutError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('keeps the old attempt count for everything else (a network failure: 3 attempts)', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new TypeError('Failed to fetch'));
    const caught = run(operation).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect((await caught as { category: string }).category).toBe('network');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('never retries KEY_REUSE or REPLAY_UNAVAILABLE', async () => {
    for (const code of ['IDEMPOTENCY_KEY_REUSE', 'IDEMPOTENCY_REPLAY_UNAVAILABLE']) {
      const operation = vi.fn<() => Promise<string>>().mockRejectedValue(
        httpError(409, { 'x-error-code': code }),
      );
      const caught = run(operation).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      await caught;
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('stops at the wall-clock deadline, counting time spent inside requests', async () => {
    // Every attempt hangs 100 s before the server says TURN_IN_PROGRESS again.
    // The count is unbounded, so the deadline is the only thing that ends it.
    const operation = vi.fn<() => Promise<string>>(
      () =>
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS' }, 10)),
            100_000,
          ),
        ),
    );
    const started = Date.now();
    let failedAt = 0;
    const caught = run(operation).catch((e: unknown) => {
      failedAt = Date.now();
      return e;
    });
    await vi.advanceTimersByTimeAsync(KEYED_TURN_DEADLINE_MS + 200_000);
    const error = await caught;

    expect(error).toBeInstanceOf(TurnInProgressError);
    // 100 s in each request and 10 s between them: the sixth attempt ends at
    // 650 s, and a seventh would start at 660 s, which the deadline refuses.
    expect(operation).toHaveBeenCalledTimes(6);
    expect(failedAt - started).toBe(650_000);
  });
});

describe('createHttpErrorFromResponse keeps Retry-After', () => {
  it('snapshots retry-after, so a TURN_IN_PROGRESS thrown from it waits the server’s seconds', async () => {
    const response = {
      status: 409,
      statusText: 'Conflict',
      headers: new Headers({ 'x-error-code': 'TURN_IN_PROGRESS', 'Retry-After': '7' }),
      json: async () => ({ detail: 'still running' }),
    } as unknown as Response;
    const error = await createHttpErrorFromResponse(response);
    expect(error.headers?.['retry-after']).toBe('7');
    expect((ErrorClassifier.classify(error) as TurnInProgressError).retryAfterMs).toBe(7000);
  });
});

describe('a TURN_IN_PROGRESS that outlasted the deadline is ambiguous', () => {
  it('says the files "may not have been added"', () => {
    const error = ErrorClassifier.classify(httpError(409, { 'x-error-code': 'TURN_IN_PROGRESS' }, 3));
    expect(isAmbiguousFailure(error)).toBe(true);
    const notice = unsentAttachmentsNotice({
      attachments: [{ name: 'app.log', isFile: true }],
      hasQuery: false,
      ambiguous: isAmbiguousFailure(error),
    });
    expect(notice).toContain('may not have been added');
    // A definite 409 stays definite.
    expect(isAmbiguousFailure(httpError(409, { 'x-error-code': 'IDEMPOTENCY_KEY_REUSE' }))).toBe(false);
  });
});

describe('a key refused as reused is rotated', () => {
  it('the turn id is its key until rotated; then the fresh key sticks', () => {
    expect(idempotencyKeyFor('opt_msg_1_9')).toBe('opt_msg_1_9');
    const fresh = rotateIdempotencyKey('opt_msg_1_9');
    expect(fresh).not.toBe('opt_msg_1_9');
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{8,255}$/);
    expect(idempotencyKeyFor('opt_msg_1_9')).toBe(fresh);
  });
});
