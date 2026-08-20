/**
 * Give a locally-minted turn its backend identity (#213).
 *
 * The delta merge in `cases-slice` dedups by `message_id`. Turns the client
 * submitted itself never carry one: `useMessageSubmission` mints `opt_msg_*`
 * ids, and `TurnResponse` carries no ids for it to adopt instead. Those rows are
 * therefore invisible to the dedup for the life of the conversation, and any
 * fetch that re-reads them appends a DUPLICATE rather than recognising them.
 *
 * That is not a rare path. The delta offset is a count of local rows used as an
 * INDEX into the backend list, so it stays exact only while every local row
 * corresponds to a backend row. Wherever that correspondence breaks — a skipped
 * blank row, a notice written between backend-sourced and locally-submitted rows
 * — the fetch over-reads into locally-submitted turns, which is precisely where
 * the dedup cannot see.
 *
 * So: reconcile rather than dedup. An incoming backend row that matches a local
 * committed row still carrying an `opt_` id, on **turn number AND slot**, IS
 * that row — adopt its `message_id` and content instead of appending a second
 * copy.
 *
 * Three properties make this safe where a blanket turn-number match would not
 * be:
 *
 *  - **Narrow.** Only rows the client minted and cannot match by id are
 *    eligible. Anything already carrying a backend id is untouched, as is
 *    anything still in flight (`isCommittedMessage`), which the submission
 *    hook still owns.
 *  - **Slot-matched.** A notice shares a turn number with the exchange it landed
 *    during but never its slot, so notices are still appended rather than
 *    swallowed — the failure that would have quietly undone #209. Two notices in
 *    one turn are likewise unaffected, since neither can match a `question` or
 *    `response` row.
 *  - **Self-healing.** After the first delta fetch following a turn, that row
 *    carries a backend id and dedups by id forever after. The reconciliation is
 *    a one-time repair per row, not a permanent compensation.
 *
 * Ambiguity is refused rather than guessed: if a `(turn, slot)` key has more
 * than one local candidate, no adoption happens for it and the caller's normal
 * append path runs. That reintroduces the duplicate for that one row — the
 * status quo — which is strictly better than adopting an id onto the wrong turn.
 */

import type { OptimisticConversationItem } from '../optimistic';
import { isOptimisticId } from '../utils/data-integrity';
import { isCommittedMessage } from '../utils/memory-manager';

/** Which of the three content slots a row occupies. */
export type MessageSlot = 'question' | 'response' | 'notice';

/**
 * The slot a row occupies, or `null` if it has no renderable content.
 *
 * Checked in a fixed order rather than assuming exactly one field is set: the
 * optimistic items created by `useMessageSubmission` carry `response: ''`
 * alongside a real `question` (and vice versa), so truthiness — not presence —
 * is what identifies the slot.
 */
export function slotOf(row: {
  question?: string;
  response?: string;
  notice?: string;
}): MessageSlot | null {
  if (row.question) return 'question';
  if (row.response) return 'response';
  if (row.notice) return 'notice';
  return null;
}

const keyOf = (turn: number, slot: MessageSlot) => `${turn}|${slot}`;

export interface ReconcileResult {
  /** `existing`, with any adopted row rewritten to its backend identity. */
  rows: OptimisticConversationItem[];
  /** Backend `message_id`s that were adopted — the caller must NOT append these. */
  adopted: Set<string>;
}

/**
 * Adopt backend identities onto locally-minted rows.
 *
 * Returns `existing` unchanged (by reference) when nothing matched, so the
 * caller's no-op path stays a no-op.
 *
 * @param existing local conversation rows, in order
 * @param incoming rows just fetched from the backend, already mapped to slots
 */
export function reconcileOptimisticIds(
  existing: OptimisticConversationItem[],
  incoming: OptimisticConversationItem[]
): ReconcileResult {
  const adopted = new Set<string>();
  if (existing.length === 0 || incoming.length === 0) {
    return { rows: existing, adopted };
  }

  const existingIds = new Set(existing.map((m) => m.id));

  // Index the eligible local rows by (turn, slot). A key holding more than one
  // row is ambiguous and is dropped from the index entirely rather than
  // resolved by position — see the module comment.
  const byKey = new Map<string, OptimisticConversationItem[]>();
  for (const row of existing) {
    if (!isCommittedMessage(row) || !isOptimisticId(row.id)) continue;
    const slot = slotOf(row);
    if (!slot || typeof row.turn_number !== 'number') continue;
    const key = keyOf(row.turn_number, slot);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  if (byKey.size === 0) return { rows: existing, adopted };

  // localId -> the backend row that claims it.
  const claims = new Map<string, OptimisticConversationItem>();
  const consumed = new Set<string>();

  for (const row of incoming) {
    // Already present by id: the dedup handles it, nothing to reconcile.
    if (existingIds.has(row.id)) continue;
    const slot = slotOf(row);
    if (!slot || typeof row.turn_number !== 'number') continue;

    const candidates = byKey.get(keyOf(row.turn_number, slot));
    if (!candidates || candidates.length !== 1) continue;

    const target = candidates[0];
    // One backend row per local row: a second incoming row with the same key
    // falls through to the append path rather than overwriting the adoption.
    if (consumed.has(target.id)) continue;

    consumed.add(target.id);
    claims.set(target.id, row);
    adopted.add(row.id);
  }

  if (claims.size === 0) return { rows: existing, adopted };

  const rows = existing.map((row) => {
    const claim = claims.get(row.id);
    if (!claim) return row;
    return {
      ...row,
      id: claim.id,
      originalId: claim.id,
      // The backend copy is authoritative for both: content may have been
      // redacted server-side, and the local turn_number was a client-side
      // prediction for the user row.
      turn_number: claim.turn_number,
      question: claim.question,
      response: claim.response,
      notice: claim.notice
    };
  });

  return { rows, adopted };
}
