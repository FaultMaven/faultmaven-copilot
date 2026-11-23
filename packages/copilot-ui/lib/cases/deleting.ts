/**
 * A case being deleted (contract 14.15.0, #401). While a delete of a case runs,
 * `GET /cases/{case_id}` reads `deleting: true`: the case is shown read-only and
 * read again on the backoff below until it is gone (404) or `deleting` clears.
 * Past the cap it stays read-only until the user's next action reads it again
 * (opening the case re-reads it).
 *
 * The flag is best-effort (a stale `true` can stand for up to 30 s with no
 * delete running), so the 409 `CASE_DELETE_IN_PROGRESS` and 404 handling stay
 * as they are; this only closes the window in which a read made during the
 * delete found the case live and nothing read it again.
 */

/** The line shown where the composer would be. The owner's ruled sentence (faultmaven#2341). */
export const CASE_DELETING_NOTICE = 'This case is being deleted, so nothing more can be added to it.';

/** First re-read, after this long. */
export const DELETING_REREAD_FIRST_MS = 2_000;
/** Re-reads back off by doubling, to at most this interval. */
export const DELETING_REREAD_MAX_MS = 10_000;
/**
 * No re-read starts later than this, counted on the WALL CLOCK from the read
 * that first saw `deleting` (request time included, as `POLL_MAX_TOTAL_MS`:
 * counting only the sleeps would let slow reads stretch it without bound).
 */
export const DELETING_REREAD_CAP_MS = 60_000;

/**
 * The wait before the next re-read, or null when it would start past the cap.
 * `previousDelayMs` is the last wait (null before the first re-read);
 * `elapsedMs` is the wall-clock time since the first read saw `deleting`.
 * Waits run 2 s, 4 s, 8 s, then every 10 s.
 */
export function nextDeletingReread(previousDelayMs: number | null, elapsedMs: number): number | null {
  const delay = previousDelayMs == null
    ? DELETING_REREAD_FIRST_MS
    : Math.min(previousDelayMs * 2, DELETING_REREAD_MAX_MS);
  return elapsedMs + delay <= DELETING_REREAD_CAP_MS ? delay : null;
}
