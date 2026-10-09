/**
 * How long the panel waits on a turn, derived from what the API publishes
 * (contract 12.4.0).
 *
 * `GET /api/v1/meta/capabilities` carries `limits.turnResponseBoundSeconds`: the
 * NOMINAL bound on how long `POST /cases/{id}/turns` takes to answer (the turn
 * ceiling of the chat provider in force, plus the commit reserve and the
 * auto-title bound). It is nominal, not a guarantee, so the client adds a
 * network margin. It moves when an operator switches the chat provider, so it
 * is read per session (the capabilities manager's lifetime), never baked in.
 *
 *   requestTimeoutMs = (bound + TURN_NETWORK_MARGIN_SECONDS + upload allowance) * 1000
 *   deadlineMs       = 2 * requestTimeoutMs
 *
 * The server binds its deadline AFTER reading the multipart body, so the time
 * a large file takes to upload is not inside the bound or the margin. The
 * upload allowance is ceil(body bytes / 125 000) seconds: a 1 Mbps link
 * (a 10 MB file adds 80 s).
 *
 * The request timeout is one attempt's patience. The recovery deadline is the
 * wall clock for getting one keyed turn answered across attempts: a first
 * attempt may use its whole timeout (a lost response), and the retry that
 * follows must still be allowed to start and to wait out the server's
 * in-flight claim, itself bounded by the same response bound. Two request
 * timeouts hold both.
 *
 * A published bound is accepted only if it is finite and within
 * [MIN_PUBLISHED_BOUND_SECONDS, MAX_PUBLISHED_BOUND_SECONDS] (the backend's
 * real range is 48.5-618.5 s). Without one (capabilities unreachable, a cached
 * payload from before 12.4.0, a fabricated fallback, an out-of-range value) the
 * policy constants below apply, plus the same upload allowance: the numbers
 * this client used before the API published any.
 */

/** Slowest upload link the allowance assumes: 1 Mbps = 125 000 bytes per second. */
export const UPLOAD_BYTES_PER_SECOND = 125_000;

export const MIN_PUBLISHED_BOUND_SECONDS = 30;
export const MAX_PUBLISHED_BOUND_SECONDS = 1200;

/** Slack over the nominal bound: lookups before the deadline binds, the commit's real duration, latency. */
export const TURN_NETWORK_MARGIN_SECONDS = 60;

/** Fallback request timeout when no bound is published (the pre-12.4.0 client value). */
export const FALLBACK_TURN_REQUEST_TIMEOUT_MS = 300_000;

/** Fallback recovery deadline when no bound is published (the pre-12.4.0 policy value). */
export const FALLBACK_KEYED_TURN_DEADLINE_MS = 660_000;

export interface TurnTiming {
  /** Abort one turn request after this long. */
  readonly requestTimeoutMs: number;
  /** Stop STARTING recovery attempts for one keyed turn this long after the first. */
  readonly deadlineMs: number;
  /** `published`: derived from the API's bound. `fallback`: the constants above. */
  readonly source: 'published' | 'fallback';
}

/** Seconds a body of `bodyBytes` needs on the assumed link. */
export function uploadAllowanceSeconds(bodyBytes: number): number {
  return Number.isFinite(bodyBytes) && bodyBytes > 0 ? Math.ceil(bodyBytes / UPLOAD_BYTES_PER_SECOND) : 0;
}

/** Whether a published bound is one this client trusts. */
export function isUsableBound(bound: unknown): bound is number {
  return (
    typeof bound === 'number' &&
    Number.isFinite(bound) &&
    bound >= MIN_PUBLISHED_BOUND_SECONDS &&
    bound <= MAX_PUBLISHED_BOUND_SECONDS
  );
}

/** The timing for a published `turnResponseBoundSeconds` (or the fallback), for a body of `bodyBytes`. */
export function deriveTurnTiming(turnResponseBoundSeconds: unknown, bodyBytes = 0): TurnTiming {
  const allowanceMs = uploadAllowanceSeconds(bodyBytes) * 1000;
  if (!isUsableBound(turnResponseBoundSeconds)) {
    return {
      requestTimeoutMs: FALLBACK_TURN_REQUEST_TIMEOUT_MS + allowanceMs,
      deadlineMs: FALLBACK_KEYED_TURN_DEADLINE_MS + 2 * allowanceMs,
      source: 'fallback',
    };
  }
  const requestTimeoutMs = Math.round((turnResponseBoundSeconds + TURN_NETWORK_MARGIN_SECONDS) * 1000) + allowanceMs;
  return { requestTimeoutMs, deadlineMs: 2 * requestTimeoutMs, source: 'published' };
}
