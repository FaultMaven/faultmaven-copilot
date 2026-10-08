/**
 * How a turn sent under an `Idempotency-Key` is retried (contract 12.2.0).
 *
 * Both turn paths (`useMessageSubmission`, `useDataUpload`) send the turn's
 * stable `aiMessageId` as its key, so the server commits it at most once and a
 * retry under the same key is answered truthfully:
 *
 * - the turn committed → 200 with the committed `TurnResponse` replayed
 *   (`X-Idempotency-Replayed: true`), which the hook reconciles exactly like a
 *   first answer;
 * - it is still running → 409 `TURN_IN_PROGRESS` with `Retry-After`
 *   (`TurnInProgressError`, waited out by `resilientOperation`);
 * - nothing committed → the turn runs, once.
 *
 * That is what makes a lost response safe to recover WITHOUT the user: a client
 * `TimeoutError` or a gateway 504 (no `x-error-code`) on a keyed turn is
 * retried under the deadline below. A 504 `REQUEST_TIMEOUT` is the server's own
 * answer that the turn exhausted its ceiling and nothing committed: the same
 * input would most likely exhaust it again, so it is retried at most ONCE.
 *
 * Everything else keeps the decision it has without this policy
 * (`defaultRetryDecision`) and the attempt count it had (`DEFAULT_MAX_ATTEMPTS`),
 * so a network blip or a 429 is not retried for eleven minutes. `TimeoutError`
 * itself stays `manual_retry` in `lib/errors/types.ts`: only a request built
 * with this policy auto-retries a timeout.
 */

import { ErrorClassifier } from '../errors/classifier';
import { TurnInProgressError } from '../errors/types';
import type { HttpError } from '../errors/http-error';
import { defaultRetryDecision, type ResilientOperationOptions } from './resilient-operation';

/**
 * How long the panel keeps trying to get one keyed turn answered, from the
 * first attempt: 11 minutes.
 *
 * A POLICY number, not one derived from the API. It sits above the default
 * server ceiling (`AGENT_REQUEST_TIMEOUT` 120 s) and its bounded maximum (600 s)
 * plus the commit reserve, but per-provider ceiling overrides are unbounded, so
 * no client number can be "longer than any turn". It counts time inside each
 * request too (`resilientOperation`'s `deadlineMs`); the 300 s request timeout
 * (`lib/api/client.ts`) is unchanged, so an attempt started before the deadline
 * may still run to that timeout.
 */
export const KEYED_TURN_DEADLINE_MS = 660_000;

/** The attempt count every other recovery keeps (`resilientOperation`'s default). */
export const DEFAULT_MAX_ATTEMPTS = 3;

type TurnTimeout = 'client' | 'gateway' | 'request_timeout';

/** Which kind of timeout a raw submit error is, if it is one. */
export function turnTimeoutKind(error: unknown): TurnTimeout | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  if (status === 504) {
    const code = (error as HttpError).headers?.['x-error-code'];
    return code === 'REQUEST_TIMEOUT' ? 'request_timeout' : 'gateway';
  }
  if (typeof status !== 'number' && error.name === 'TimeoutError') return 'client';
  return null;
}

/**
 * The `resilientOperation` options for one keyed turn submission. Call it once
 * per submission: it carries that submission's retry counts.
 */
export function keyedTurnRetryPolicy(): Pick<
  ResilientOperationOptions<unknown>,
  'retryOptions' | 'deadlineMs'
> {
  let requestTimeoutRetried = false;
  let otherRetries = 0;

  return {
    deadlineMs: KEYED_TURN_DEADLINE_MS,
    retryOptions: {
      // The deadline is the bound, not the count.
      maxAttempts: Number.POSITIVE_INFINITY,
      shouldRetry: (error) => {
        switch (turnTimeoutKind(error)) {
          case 'client':
          case 'gateway':
            return true;
          case 'request_timeout':
            if (requestTimeoutRetried) return false;
            requestTimeoutRetried = true;
            return true;
          case null:
            break;
        }

        const classified = ErrorClassifier.classify(error);
        if (classified instanceof TurnInProgressError) return true;

        // The key makes the request idempotent, as the callers already declare.
        if (!defaultRetryDecision(classified, { idempotent: true })) return false;
        // At most DEFAULT_MAX_ATTEMPTS - 1 such retries, as without this policy.
        if (otherRetries >= DEFAULT_MAX_ATTEMPTS - 1) return false;
        otherRetries += 1;
        return true;
      },
    },
  };
}
