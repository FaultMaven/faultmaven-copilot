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
 *   requestTimeoutMs = (bound + TURN_NETWORK_MARGIN_SECONDS) * 1000
 *   deadlineMs       = 2 * requestTimeoutMs
 *
 * The request timeout is one attempt's patience. The recovery deadline is the
 * wall clock for getting one keyed turn answered across attempts: a first
 * attempt may use its whole timeout (a lost response), and the retry that
 * follows must still be allowed to start and to wait out the server's
 * in-flight claim, itself bounded by the same response bound. Two request
 * timeouts hold both.
 *
 * Without a published bound (capabilities unreachable, a cached payload from
 * before 12.4.0, a fabricated fallback) the policy constants below apply:
 * the numbers this client used before the API published any.
 */

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

export const FALLBACK_TURN_TIMING: TurnTiming = {
  requestTimeoutMs: FALLBACK_TURN_REQUEST_TIMEOUT_MS,
  deadlineMs: FALLBACK_KEYED_TURN_DEADLINE_MS,
  source: 'fallback',
};

/** The timing for a published `turnResponseBoundSeconds`, or the fallback when it is not a usable number. */
export function deriveTurnTiming(turnResponseBoundSeconds: unknown): TurnTiming {
  if (
    typeof turnResponseBoundSeconds !== 'number' ||
    !Number.isFinite(turnResponseBoundSeconds) ||
    turnResponseBoundSeconds <= 0
  ) {
    return FALLBACK_TURN_TIMING;
  }
  const requestTimeoutMs = Math.round((turnResponseBoundSeconds + TURN_NETWORK_MARGIN_SECONDS) * 1000);
  return { requestTimeoutMs, deadlineMs: 2 * requestTimeoutMs, source: 'published' };
}
