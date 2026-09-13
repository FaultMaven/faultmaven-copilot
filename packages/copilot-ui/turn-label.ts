/**
 * Which turn a surface SHOWS, as distinct from the one it ADDRESSES — the
 * cross-repo door.
 *
 * WHY A ROOT MODULE AND NOT THE ENTRY. The Dashboard displays turns too (a
 * read-only transcript, the case header, a markdown export), and it is
 * forbidden from importing this package's entry: `index.ts` pulls the panel,
 * the host store, the transport and the persistence internals into the
 * consumer's eager graph. That is measured, not feared — +200 kB in the
 * Dashboard's entry chunk for every signed-out visitor, which ADR-016 D3
 * forbids. `contract.ts` is the existing exception precisely because it
 * imports nothing (+196 bytes by the same measurement); this module imports
 * nothing either, and exists so these rules can travel the same cheap way.
 *
 * The reasoning for each rule lives with the code in `lib/state/turn-label.ts`
 * and `lib/state/message-kind.ts`. This file is the door, not a second copy of
 * the argument.
 */

export {
  displayedTurn,
  predictedInvestigationTurn,
  serverSuppliesInvestigationTurn,
  investigationTurnFor,
} from './lib/state/turn-label';
export type { TurnLabelled } from './lib/state/turn-label';

/**
 * Exported because {@link displayedTurn} carries a precondition a host
 * otherwise cannot satisfy: never call it on a NOTICE row. The server sends a
 * null investigation turn there, null is indistinguishable from "old server",
 * and the fallback would then print the very number a notice must not claim.
 * Shipping the dangerous function without its classifier left the host to
 * re-implement the classification or get it wrong.
 */
export { messageKind } from './lib/state/message-kind';
export type { MessageKind } from './lib/state/message-kind';

import { displayedTurn, type TurnLabelled } from './lib/state/turn-label';
import { messageKind } from './lib/state/message-kind';

/**
 * The number to PRINT beside a row, or `undefined` for no label at all.
 *
 * TWO DIFFERENT QUESTIONS, and the package answered only the first. What the
 * turn IS uses `??`, because 0 is a real answer — an aside before the
 * investigation has had a turn sits at investigation turn 0. Whether to PRINT
 * it is a separate decision, and the answer at 0 is no: "Turn 0" names a turn
 * the investigation has not reached.
 *
 * `ChatWindow` already applied that rule inline (`turnNumber ? … : ''`) while
 * the Dashboard's transcript guarded on `!== null` and printed `Turn 0` — two
 * surfaces on one screen disagreeing about the same row, which is the whole
 * defect this release is about. The rule belongs here rather than in each
 * renderer.
 *
 * Pass `role` and a notice is suppressed too, which is `displayedTurn`'s
 * precondition made structural instead of documentary. Omit it only for a row
 * already known not to be a notice.
 */
export function turnLabelFor(row: TurnLabelled & { role?: string }): number | undefined {
  if (row.role !== undefined && messageKind(row.role) === 'notice') return undefined;
  const turn = displayedTurn(row);
  // Falsy on purpose, and NOT `??`: 0 and "no answer" are different values that
  // reach the same rendering decision.
  return turn ? turn : undefined;
}
