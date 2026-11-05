/**
 * Contract 14.14.0 (faultmaven#2096): a case delete refuses while work on the
 * case runs (409 `CASE_WORK_IN_PROGRESS`) or when that cannot be read (503
 * `CASE_DELETE_UNAVAILABLE`), and a turn refuses while a delete of its case
 * runs (409 `CASE_DELETE_IN_PROGRESS`). Each maps to its own class on both
 * error shapes, and none is retried.
 */
import { describe, it, expect, vi } from 'vitest';
import { ErrorClassifier } from '@faultmaven/copilot-ui/lib/errors/classifier';
import {
  CaseDeleteInProgressError,
  CaseDeleteUnavailableError,
  CaseVersionConflictError,
  CaseWorkInProgressError,
  ServerError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { createHttpErrorFromResponse } from '@faultmaven/copilot-ui/lib/errors/http-error';
import { defaultRetryDecision } from '@faultmaven/copilot-ui/lib/utils/resilient-operation';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** The error `authenticatedFetch` throws for a non-OK response. */
function enriched(status: number, code?: string, retryAfter?: number): Error {
  const error = new Error(`HTTP ${status}`) as Error & { status: number; headers?: Record<string, string>; retryAfter?: number };
  error.name = 'HTTPError';
  error.status = status;
  if (code) error.headers = { 'x-error-code': code };
  if (retryAfter !== undefined) error.retryAfter = retryAfter;
  return error;
}

/** The `HttpError` a service builds from the response after a credential refresh. */
const fromResponse = (status: number, code?: string, retryAfter?: string) => {
  const headers: Record<string, string> = {};
  if (code) headers['x-error-code'] = code;
  if (retryAfter) headers['retry-after'] = retryAfter;
  return createHttpErrorFromResponse({
    status,
    statusText: '',
    headers: new Headers(headers),
    json: async () => ({ detail: 'refused' }),
  } as unknown as Response);
};

describe('ErrorClassifier — the case-delete gate (contract 14.14.0)', () => {
  it.each([
    [409, 'CASE_WORK_IN_PROGRESS', CaseWorkInProgressError],
    [503, 'CASE_DELETE_UNAVAILABLE', CaseDeleteUnavailableError],
    [409, 'CASE_DELETE_IN_PROGRESS', CaseDeleteInProgressError],
  ] as const)('%i %s maps to its own class on both error shapes', async (status, code, cls) => {
    expect(ErrorClassifier.classify(enriched(status, code))).toBeInstanceOf(cls);
    expect(ErrorClassifier.classify(await fromResponse(status, code))).toBeInstanceOf(cls);
  });

  it('CASE_WORK_IN_PROGRESS carries Retry-After in ms from either shape', async () => {
    expect((ErrorClassifier.classify(enriched(409, 'CASE_WORK_IN_PROGRESS', 7)) as CaseWorkInProgressError).retryAfterMs).toBe(7000);
    const snapshotted = ErrorClassifier.classify(await fromResponse(409, 'CASE_WORK_IN_PROGRESS', '4'));
    expect((snapshotted as CaseWorkInProgressError).retryAfterMs).toBe(4000);
  });

  it('says what the owner approved', () => {
    const busy = new CaseWorkInProgressError('x');
    expect(`${busy.userMessage} ${busy.userAction}`).toBe(
      "This case can't be deleted while FaultMaven is still working on it. Try again in a moment.",
    );
    const unavailable = new CaseDeleteUnavailableError('x');
    expect(`${unavailable.userMessage} ${unavailable.userAction}`).toBe(
      "This case couldn't be deleted just now. Try again in a moment.",
    );
    expect(new CaseDeleteInProgressError('x').bubbleText).toBe("This case is being deleted, so your message wasn't added.");
  });

  it('DUPLICATE_REQUEST, CASE_VERSION_CONFLICT and an unlabelled 409 keep their class; an uncoded 503 too', () => {
    for (const code of ['DUPLICATE_REQUEST', 'CASE_VERSION_CONFLICT', undefined]) {
      expect(ErrorClassifier.classify(enriched(409, code))).toBeInstanceOf(CaseVersionConflictError);
    }
    const plain503 = ErrorClassifier.classify(enriched(503));
    expect(plain503).toBeInstanceOf(ServerError);
    expect(plain503).not.toBeInstanceOf(CaseDeleteUnavailableError);
  });

  it('none of the three is auto-retried', () => {
    for (const [status, code] of [[409, 'CASE_WORK_IN_PROGRESS'], [503, 'CASE_DELETE_UNAVAILABLE'], [409, 'CASE_DELETE_IN_PROGRESS']] as const) {
      expect(defaultRetryDecision(ErrorClassifier.classify(enriched(status, code)), { idempotent: true })).toBe(false);
    }
  });
});
