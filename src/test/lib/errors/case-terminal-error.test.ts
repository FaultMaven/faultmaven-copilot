/**
 * Contract 12.3.0 (faultmaven#1908): every terminal-case 409 carries
 * `x-error-code: CASE_TERMINAL` — the turn route's refusals (new data, a status
 * change, a file reclassification), `PUT /cases/{id}`, and
 * `POST /cases/{id}/close` on a case already terminal. It maps to
 * `CaseTerminalError` on any route, and nothing retries it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorClassifier } from '@faultmaven/copilot-ui/lib/errors/classifier';
import {
  CaseTerminalError,
  CaseVersionConflictError,
} from '@faultmaven/copilot-ui/lib/errors/types';
import { createHttpErrorFromResponse } from '@faultmaven/copilot-ui/lib/errors/http-error';
import { getRecoveryPlan } from '@faultmaven/copilot-ui/lib/errors/recovery-strategies';
import { defaultRetryDecision, resilientOperation } from '@faultmaven/copilot-ui/lib/utils/resilient-operation';
import { keyedTurnRetryPolicy } from '@faultmaven/copilot-ui/lib/utils/keyed-turn-retry';
import { isAmbiguousFailure, unsentAttachmentsNotice } from '@faultmaven/copilot-ui/lib/state/unsent-attachments';

vi.mock('@faultmaven/copilot-ui/lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** The error `authenticatedFetch` throws for a non-OK response. */
function httpError(status: number, headers: Record<string, string> = {}): Error {
  const error = new Error(`HTTP ${status}`) as Error & { status: number; headers?: Record<string, string> };
  error.name = 'HTTPError';
  error.status = status;
  if (Object.keys(headers).length > 0) error.headers = headers;
  return error;
}

const terminal = () => httpError(409, { 'x-error-code': 'CASE_TERMINAL' });

describe('ErrorClassifier — 409 CASE_TERMINAL', () => {
  it('maps to CaseTerminalError, not a version conflict', () => {
    const classified = ErrorClassifier.classify(terminal());
    expect(classified).toBeInstanceOf(CaseTerminalError);
    expect(classified).not.toBeInstanceOf(CaseVersionConflictError);
  });

  it('says the case is closed and read-only, and that questions still work; never "updated elsewhere"', () => {
    const classified = ErrorClassifier.classify(terminal()) as CaseTerminalError;
    expect(classified.userMessage).toBe('This case is closed and read-only.');
    expect(classified.userAction).toBe('You can still ask questions about it.');
    expect(classified.bubbleText).toBe('This case is closed and read-only. You can still ask questions about it.');
    for (const text of [classified.userTitle, classified.userMessage, classified.userAction, classified.bubbleText]) {
      expect(text).not.toMatch(/updated|retry|resubmit/i);
    }
  });

  it('is shown as a toast with no actions (only toasts and modals render)', () => {
    const options = new CaseTerminalError('x').getDisplayOptions();
    expect(options.displayType).toBe('toast');
    expect(options.actions).toBeUndefined();
  });

  it('reads the snapshotted header from createHttpErrorFromResponse too', async () => {
    const response = {
      status: 409,
      statusText: 'Conflict',
      headers: new Headers({ 'x-error-code': 'CASE_TERMINAL' }),
      json: async () => ({ detail: 'Cannot change status of a closed case.' }),
    } as unknown as Response;
    expect(ErrorClassifier.classify(await createHttpErrorFromResponse(response))).toBeInstanceOf(CaseTerminalError);
  });

  it('CASE_VERSION_CONFLICT and an unlabelled 409 keep today’s mapping', () => {
    expect(ErrorClassifier.classify(httpError(409, { 'x-error-code': 'CASE_VERSION_CONFLICT' }))).toBeInstanceOf(
      CaseVersionConflictError,
    );
    expect(ErrorClassifier.classify(httpError(409))).toBeInstanceOf(CaseVersionConflictError);
  });

  it('is a definite failure: the files were not added', () => {
    expect(isAmbiguousFailure(terminal())).toBe(false);
    const notice = unsentAttachmentsNotice(
      { attachments: [{ name: 'app.log', isFile: true }], hasQuery: false },
      { noRetry: true },
    );
    expect(notice).toBe('1 file (app.log) was not added to the case.');
  });
});

describe('CASE_TERMINAL is never retried', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is final for defaultRetryDecision, idempotent or not', () => {
    const classified = ErrorClassifier.classify(terminal());
    expect(classified.recovery).toBe('graceful_degradation');
    expect(defaultRetryDecision(classified, { idempotent: true })).toBe(false);
    expect(defaultRetryDecision(classified, { idempotent: false })).toBe(false);
  });

  it('offers no Retry in its recovery plan', () => {
    const onRetry = vi.fn();
    const plan = getRecoveryPlan(terminal(), { onRetry });
    expect(plan.actions).toEqual([]);
    expect(plan.autoRetry).toBeUndefined();
  });

  it('the keyed-turn policy sends it once (and so does the default policy)', async () => {
    for (const withPolicy of [true, false]) {
      const operation = vi.fn<() => Promise<string>>().mockRejectedValue(terminal());
      const caught = resilientOperation({
        operation,
        context: { operation: 'message_submission' },
        idempotent: true,
        ...(withPolicy ? keyedTurnRetryPolicy() : {}),
      }).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await caught).toBeInstanceOf(CaseTerminalError);
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });
});
