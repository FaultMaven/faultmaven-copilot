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
 * persisted before this field existed, a server older than 3.5.0, or a case
 * with no messages. There the caller falls back to the clock, which is the
 * same thing every row around it is showing.
 *
 * On a BRAND-NEW case that fallback prints "Turn 1" for the in-flight bubble,
 * and the server can still answer 0 — a whole-message greeting is classified
 * out-of-band, so the first exchange can be an aside and the label then
 * disappears when the response lands. That is a real one-step correction on
 * the opening turn, and it is not avoidable client-side: nothing here can know
 * how the message will be classified until the server says.
 */
export function predictedInvestigationTurn(
  messages: readonly TurnLabelled[]
): number | undefined {
  const highest = highestInvestigationTurn(messages);
  return highest === undefined ? undefined : highest + 1;
}

/**
 * Whether the server this conversation came from populates
 * `Message.investigation_turn` — i.e. is on API contract 3.5.0 or later.
 *
 * `TurnResponse.investigation_turn` shipped in **2.7.0** and the per-row field
 * only in **3.5.0**, so against any server in between one channel answers and
 * the other does not. Taking the label from both would number one conversation
 * two ways: history rows fall back to the clock while the row just submitted
 * takes the investigation count, so the new row can repeat the number above it
 * and then change when the panel is reopened. Asking the rows themselves is
 * the check that needs no new endpoint — `/v1/meta/capabilities` advertises
 * features and limits, not a contract version.
 *
 * False on a case with no committed rows yet, which is the honest answer: this
 * client has seen no evidence either way, and falling back to the clock
 * everywhere is at least self-consistent until the first delta fetch.
 */
export function serverSuppliesInvestigationTurn(
  messages: readonly TurnLabelled[] | undefined
): boolean {
  return Array.isArray(messages) && highestInvestigationTurn(messages) !== undefined;
}

/** The largest investigation turn any row carries, or `undefined` if none does. */
function highestInvestigationTurn(
  messages: readonly TurnLabelled[]
): number | undefined {
  let highest: number | undefined;
  for (const msg of messages) {
    if (typeof msg.investigation_turn === 'number') {
      highest = highest === undefined ? msg.investigation_turn : Math.max(highest, msg.investigation_turn);
    }
  }
  return highest;
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
 * ⚠️ SUPERSEDED BY THE SERVER, and kept until the callers move. Contract 3.7.0
 * (faultmaven#1391) puts `investigation_turn` on the evidence and file rows
 * themselves, so the row now answers directly and this scan is no longer the
 * only way to get the number — it is also the WORSE way, because it returns
 * `undefined` whenever the conversation has been trimmed past the row being
 * labelled, which the served field never does. Callers should read the field;
 * this stays for rows from a server below 3.7.0.
 *
 * ⚠️ The DISPLAY only. Keep passing `uploaded_at_turn` itself to
 * `scrollToTurn` — the anchor is the clock, and the two differ here by design.
 *
 * `undefined` rather than a guess when the row is not loaded: the persisted
 * conversation is capped to a recent suffix, so a file uploaded early in a
 * long case has no local row to read. Reading other rows is sound here in a
 * way it is not for labelling a row — this answers "what is that turn called",
 * which is a lookup, not a count, and it fails visibly rather than silently.
 *
 * ⚠️ Callers must render NOTHING on `undefined`, not the clock. Falling back
 * would print the other counter without saying so, and — because the files
 * list can render before the conversation delta fetch resolves — the number
 * would then change in place once the rows arrive. A label that appears is
 * fine; a label that renumbers itself is the defect this whole release is
 * about.
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
