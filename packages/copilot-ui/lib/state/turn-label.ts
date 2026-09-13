/**
 * Which turn number the UI SHOWS, as distinct from the one it ADDRESSES.
 *
 * The backend keeps two counters and they are not interchangeable (API
 * contract 3.5.0, FaultMaven/faultmaven#1387):
 *
 * - `turn_number` / `current_turn` — the MESSAGE clock. Every persisted
 *   exchange advances it, asides included: small talk, trivia, a question
 *   about FaultMaven itself. It is the key evidence `uploaded_at_turn` and
 *   the conversation anchors are expressed in, so it is what ADDRESSES a turn.
 * - `investigation_turn` — how far the INVESTIGATION has got. An aside leaves
 *   it alone, which is what makes "Turn 7" stay "Turn 7" after a haiku
 *   (FaultMaven/faultmaven#1329).
 *
 * Display the second; keep addressing with the first. `data-turn` and
 * `scrollToTurn` in particular must stay on the message clock — they are fed
 * `uploaded_at_turn` from the evidence surfaces, and re-basing the anchor to
 * match the label would break jump-to-turn with no error and no failing test.
 */

/** The two turn fields a conversation row can carry. */
export interface TurnLabelled {
  turn_number?: number;
  /** Absent on a row fetched from a server older than contract 3.5.0. */
  investigation_turn?: number | null;
}

/**
 * The number to print beside a conversation row, or `undefined` for no label.
 *
 * Falls back to the message clock when the server did not supply an
 * investigation turn — an older backend, or a row this client minted and has
 * not yet reconciled. `??` rather than `||` because 0 is a real answer: an
 * aside before the investigation has had a turn sits at investigation turn 0,
 * and the caller renders no label for it, which is the honest reading.
 *
 * ⚠️ Do not call this on a NOTICE row. The server sends null there too — a
 * notice owns no turn, being stamped with whichever turn was open when its
 * background job finished — and null is indistinguishable from "old server",
 * so the fallback would print the very number the notice must not claim.
 * `ChatWindow` renders notices through `formatTimestampWithTurn` with no turn
 * at all, which is the rule; keep it that way rather than routing them here.
 */
export function displayedTurn(item: TurnLabelled): number | undefined {
  return item.investigation_turn ?? item.turn_number;
}

/**
 * The investigation turn an optimistic row should claim while its turn is in
 * flight, or `undefined` when this client cannot tell.
 *
 * Predicting is the lesser of two wrongs, not a guess for its own sake. The
 * alternative — leaving it unset — falls back to the message clock, so on any
 * case that has ever carried an aside the in-flight bubble shows a number one
 * or more too high and then visibly corrects when the response lands. The
 * prediction is exact for a normal investigation turn, which is nearly all of
 * them, and the response overwrites it either way.
 *
 * `undefined` when no local row carries an investigation turn at all: a store
 * persisted before this field existed would otherwise make the highest look
 * like 0 and the prediction like 1, which is a far bigger jump than the
 * fallback it replaces. A case with no messages also returns `undefined`, and
 * there the clock fallback is right by construction — turn 1 of a case with no
 * asides yet IS investigation turn 1.
 */
export function predictedInvestigationTurn(
  messages: readonly TurnLabelled[]
): number | undefined {
  let highest = -1;
  for (const msg of messages) {
    if (typeof msg.investigation_turn === 'number') {
      highest = Math.max(highest, msg.investigation_turn);
    }
  }
  return highest >= 0 ? highest + 1 : undefined;
}

/**
 * The investigation turn of whichever loaded row sits on `messageTurn`, or
 * `undefined` when this client holds no such row.
 *
 * For surfaces that name a turn they do not themselves render — evidence
 * "Uploaded at Turn N", the file list's "→ TN". Those carry
 * `uploaded_at_turn`, which is the MESSAGE clock, so without this they print
 * a different number than the conversation prints for the same exchange, on
 * the same screen, on any case with an aside.
 *
 * ⚠️ The DISPLAY only. Keep passing `uploaded_at_turn` itself to
 * `scrollToTurn` — the anchor is the clock, and the two differ here by design.
 *
 * `undefined` rather than a guess when the row is not loaded: the persisted
 * conversation is capped to a recent suffix, so a file uploaded early in a
 * long case has no local row to read, and the caller falls back to the clock.
 * Reading other rows is sound here in a way it is not for labelling a row —
 * this answers "what is that turn called", which is a lookup, not a count.
 */
export function investigationTurnFor(
  messageTurn: number,
  rows: readonly TurnLabelled[] | undefined
): number | undefined {
  if (!Array.isArray(rows)) return undefined;
  for (const row of rows) {
    if (row.turn_number === messageTurn && typeof row.investigation_turn === 'number') {
      return row.investigation_turn;
    }
  }
  return undefined;
}
