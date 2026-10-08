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
 * `REQUEST_TIMEOUT` (the turn exhausted its ceiling) or `LLM_TIMEOUT` (the
 * provider timed out) — so every retry of it is a new LLM run of the same
 * input: it is retried at most ONCE, across both codes. A 504 with a code this
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

/**
 * How long the panel keeps trying to get one keyed turn answered, from the
 * first attempt: 11 minutes.
 *
 * A POLICY number, not one derived from the API. It sits above the default
 * server ceiling (`AGENT_REQUEST_TIMEOUT` 120 s) and its bounded maximum (600 s)
 * plus the commit reserve, but per-provider ceiling overrides are unbounded, so
 * no client number can be "longer than any turn". It counts time inside each
 * request too (`resilientOperation`'s `deadlineMs`).
 *
 * It bounds STARTING a retry, not the last attempt: the 300 s request timeout
 * (`lib/api/client.ts`) is unchanged and an attempt started just before the
 * deadline runs to it, so the worst case is about deadline + one request
 * timeout, ~960 s. The late attempt is deliberately not capped.
 */
export const KEYED_TURN_DEADLINE_MS = 660_000;

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
 */
export function keyedTurnRetryPolicy(): Pick<
  ResilientOperationOptions<unknown>,
  'retryOptions' | 'deadlineMs'
> {
  let serverTimeoutRetried = false;
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
