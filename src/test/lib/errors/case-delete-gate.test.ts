/**
 * Contract 14.14.0 (faultmaven#2096): the case-delete gate's three codes map to
 * their own classes on both error shapes, the neighbouring codes keep theirs,
 * and none is auto-retried.
 */
import { describe, it, expect, vi } from 'vitest';
import { ErrorClassifier } from '@faultmaven/copilot-ui/lib/errors/classifier';
import {
  CaseDeleteInProgressError, CaseDeleteUnavailableError, CaseVersionConflictError, CaseWorkInProgressError, ServerError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { createHttpErrorFromResponse } from '@faultmaven/copilot-ui/lib/errors/http-error';
import { defaultRetryDecision } from '@faultmaven/copilot-ui/lib/utils/resilient-operation';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** The error `authenticatedFetch` throws for a non-OK response. */
const enriched = (status: number, code?: string, retryAfter?: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), {
    name: 'HTTPError',
    status,
    ...(code ? { headers: { 'x-error-code': code } } : {}),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  });

/** The `HttpError` a service builds from the response after a credential refresh. */
const snapshotted = (status: number, code: string, retryAfter?: string) =>
  createHttpErrorFromResponse({
    status,
    statusText: '',
    headers: new Headers({ 'x-error-code': code, ...(retryAfter ? { 'retry-after': retryAfter } : {}) }),
    json: async () => ({ detail: 'refused' }),
  } as unknown as Response);

describe('ErrorClassifier — the case-delete gate (contract 14.14.0)', () => {
  it.each([
    [409, 'CASE_WORK_IN_PROGRESS', CaseWorkInProgressError],
    [503, 'CASE_DELETE_UNAVAILABLE', CaseDeleteUnavailableError],
    [409, 'CASE_DELETE_IN_PROGRESS', CaseDeleteInProgressError],
  ] as const)('%i %s maps to its own class on both error shapes, never auto-retried', async (status, code, cls) => {
    const classified = ErrorClassifier.classify(enriched(status, code));
    expect(classified).toBeInstanceOf(cls);
    expect(ErrorClassifier.classify(await snapshotted(status, code))).toBeInstanceOf(cls);
    expect(defaultRetryDecision(classified, { idempotent: true })).toBe(false);
  });

  it('CASE_WORK_IN_PROGRESS carries Retry-After in ms from either shape', async () => {
    const waitOf = (e: Error) => (ErrorClassifier.classify(e) as CaseWorkInProgressError).retryAfterMs;
    expect(waitOf(enriched(409, 'CASE_WORK_IN_PROGRESS', 7))).toBe(7000);
    expect(waitOf(await snapshotted(409, 'CASE_WORK_IN_PROGRESS', '4'))).toBe(4000);
  });

  it('says what the owner approved', () => {
    const joined = (e: CaseWorkInProgressError | CaseDeleteUnavailableError) => `${e.userMessage} ${e.userAction}`;
    expect(joined(new CaseWorkInProgressError('x'))).toBe(
      "This case can't be deleted while FaultMaven is still working on it. Try again in a moment.",
    );
    expect(joined(new CaseDeleteUnavailableError('x'))).toBe("This case couldn't be deleted just now. Try again in a moment.");
    expect(new CaseDeleteInProgressError('x').bubbleText).toBe("This case is being deleted, so your message wasn't added.");
  });

  it('DUPLICATE_REQUEST, CASE_VERSION_CONFLICT and an unlabelled 409 keep their class; an uncoded 503 too', () => {
    for (const code of ['DUPLICATE_REQUEST', 'CASE_VERSION_CONFLICT', undefined]) {
      expect(ErrorClassifier.classify(enriched(409, code))).toBeInstanceOf(CaseVersionConflictError);
    }
    expect(ErrorClassifier.classify(enriched(503))).toBeInstanceOf(ServerError);
  });
});
