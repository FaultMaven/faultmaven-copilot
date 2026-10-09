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
 * `TimeoutError` or a gateway 504 (no `x-error-code`: a proxy answered, the API
 * may still commit) on a keyed turn is retried under the deadline below. A
 * CODED 504 is the API's own answer that nothing committed —
 * `REQUEST_TIMEOUT` (the turn exhausted its ceiling; the same input likely
 * does again, no `Retry-After`) or `LLM_TIMEOUT` (the provider timed out;
 * transient, `Retry-After: 30`) — so every retry of it is a new LLM run of the
 * same input: it is retried at most ONCE, across both codes, and an
 * `LLM_TIMEOUT` retry waits its `Retry-After` first. A 504 with a code this
 * build does not know keeps the default decision (no automatic retry).
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
import { capabilitiesManager } from '../capabilities';
import type { TurnTiming } from './turn-timing';

/** The attempt count every other recovery keeps (`resilientOperation`'s default). */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** The coded 504s that say nothing committed: retried once, together. */
const NOTHING_COMMITTED_504_CODES: ReadonlySet<string> = new Set(['REQUEST_TIMEOUT', 'LLM_TIMEOUT']);

type TurnTimeout = 'client' | 'gateway' | 'server_timeout';

/** Which kind of timeout a raw submit error is, if it is one. */
export function turnTimeoutKind(error: unknown): TurnTimeout | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  if (status === 504) {
    const code = (error as HttpError).headers?.['x-error-code'];
    if (code === undefined) return 'gateway';
    return NOTHING_COMMITTED_504_CODES.has(code) ? 'server_timeout' : null;
  }
  if (typeof status !== 'number' && error.name === 'TimeoutError') return 'client';
  return null;
}

/**
 * The `resilientOperation` options for one keyed turn submission. Call it once
 * per submission: it carries that submission's retry counts.
 *
 * `timing.deadlineMs` is how long the panel keeps trying to get the turn
 * answered, from the first attempt, and it counts time inside each request too
 * (`resilientOperation`'s `deadlineMs`). It is derived from the response bound
 * the API publishes (`lib/utils/turn-timing.ts`), read from the capabilities
 * held now unless a caller passes one. It bounds STARTING a retry, not the
 * last attempt: an attempt started just before it runs to its own request
 * timeout, so the worst case is about deadline + one request timeout.
 *
 * The waits between attempts are the server's: a `TURN_IN_PROGRESS` 409 is
 * polled within its `Retry-After` (an upper bound on the claim) and an
 * `LLM_TIMEOUT` 504 waits its `Retry-After`; `REQUEST_TIMEOUT` carries none.
 */
export function keyedTurnRetryPolicy(timing: TurnTiming = capabilitiesManager.getTurnTiming()): Pick<
  ResilientOperationOptions<unknown>,
  'retryOptions' | 'deadlineMs'
> {
  let serverTimeoutRetried = false;
  let otherRetries = 0;

  return {
    deadlineMs: timing.deadlineMs,
    retryOptions: {
      // The deadline is the bound, not the count.
      maxAttempts: Number.POSITIVE_INFINITY,
      shouldRetry: (error) => {
        switch (turnTimeoutKind(error)) {
          case 'client':
          case 'gateway':
            return true;
          case 'server_timeout':
            if (serverTimeoutRetried) return false;
            serverTimeoutRetried = true;
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

/**
 * The `Idempotency-Key` a turn is sent under: its stable id, unless a
 * `IDEMPOTENCY_KEY_REUSE` refusal rotated it.
 *
 * The server refuses a key it already holds for a DIFFERENT request, so a
 * same-key retry can only meet the same 409. The changed request is a new
 * logical turn and takes a fresh key; every later retry of it reuses that one.
 */
const rotatedKeys = new Map<string, string>();
let rotations = 0;

export function idempotencyKeyFor(turnId: string): string {
  return rotatedKeys.get(turnId) ?? turnId;
}

/** Give the turn a fresh key after an `IDEMPOTENCY_KEY_REUSE` (in-grammar: `[A-Za-z0-9_-]`). */
export function rotateIdempotencyKey(turnId: string): string {
  rotations += 1;
  const key = `${turnId}_r${rotations}`;
  rotatedKeys.set(turnId, key);
  return key;
}
